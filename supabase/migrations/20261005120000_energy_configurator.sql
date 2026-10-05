-- Phase 4b: energy configurator -> Bridge CRM (additive only; no existing table, policy or function is changed)
-- Approved by Wim and applied to the live Bridge CRM database on 5 Oct 2026 (migration "energy_configurator").

-- 1. Reference data (tariffs, connections, defaults). Public read; written only by migrations.
create table public.energy_reference (
  version     text primary key,                 -- model version, e.g. 2026.10-5
  valid_from  date not null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.energy_reference enable row level security;
create policy energy_reference_public_read on public.energy_reference
  for select to anon, authenticated using (true);
revoke insert, update, delete, truncate, references, trigger on public.energy_reference from anon, authenticated;

-- 2. Per-tenant settings: which products, board, stage and owner new leads get.
create table public.energy_tenant_settings (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  enabled          boolean not null default false,  -- the save route refuses tenants that are not enabled
  board_id         uuid not null references public.kanban_boards(id),
  stage_id         uuid not null references public.kanban_stages(id),
  owner_id         uuid references public.users(id),
  product_map      jsonb not null default '{}'::jsonb,  -- {"solar": <product id>, "battery": ..., "chargers": ..., "ems": ..., "engineering": ...}
  price_overrides  jsonb not null default '{}'::jsonb,  -- reserved for 4c (tenant prices as model defaults)
  max_saves_per_ip_per_hour integer not null default 5,
  max_saves_per_day         integer not null default 200,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.energy_tenant_settings enable row level security;
create policy energy_tenant_settings_tenant on public.energy_tenant_settings
  for all to authenticated
  using (tenant_id = (select public.get_user_tenant_id()))
  with check (tenant_id = (select public.get_user_tenant_id()));
revoke all on public.energy_tenant_settings from anon;

-- 3. Saved configurations. Tenant users can read; only the save function (service role) writes.
create table public.energy_configurations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  created_at      timestamptz not null default now(),
  model_version   text not null references public.energy_reference(version),
  locale          text not null default 'nl',
  inputs          jsonb not null,          -- form inputs; meter data itself is NOT stored (only has_meter_data + annual MWh)
  result          jsonb not null,          -- chosen design row + packages summary
  site_label      text,
  npv_eur         numeric,
  capex_eur       numeric,
  checked_on_server boolean not null default false,  -- true when the server re-ran the design and agreed
  consent_at      timestamptz not null,
  consent_version text not null,
  ip_hash         text,                    -- salted SHA-256 of the IP, only for the rate limit
  contact_id      uuid references public.contacts(id) on delete set null,
  company_id      uuid references public.companies(id) on delete set null,
  deal_id         uuid references public.deals(id) on delete set null,
  quote_id        uuid references public.quotes(id) on delete set null
);
create index energy_configurations_tenant_created on public.energy_configurations (tenant_id, created_at desc);
create index energy_configurations_ip_created on public.energy_configurations (ip_hash, created_at desc);
create index energy_configurations_contact on public.energy_configurations (contact_id);
create index energy_configurations_deal on public.energy_configurations (deal_id);
alter table public.energy_configurations enable row level security;
create policy energy_configurations_tenant_read on public.energy_configurations
  for select to authenticated using (tenant_id = (select public.get_user_tenant_id()));
revoke all on public.energy_configurations from anon;
revoke insert, update, delete, truncate on public.energy_configurations from authenticated;

-- 4. One save = contact + company + deal + draft quote + configuration, in one transaction.
--    Callable only by the service role (the Vercel server route). Not callable by visitors.
create or replace function public.energy_save_configuration(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  s            public.energy_tenant_settings;
  v_tenant     uuid := (p->>'tenant_id')::uuid;
  v_email      text := lower(trim(p->'contact'->>'email'));
  v_company    text := nullif(trim(p->'contact'->>'company'), '');
  v_contact    uuid;
  v_company_id uuid;
  v_deal       uuid;
  v_quote      uuid;
  v_conf       uuid;
  v_capex      numeric := round((p->>'capex_eur')::numeric, 2);
  v_subtotal   numeric := 0;
  v_tax        numeric := 0;
  line         jsonb;
  i            integer := 0;
  v_net        numeric;
begin
  select * into s from public.energy_tenant_settings where tenant_id = v_tenant and enabled;
  if not found then raise exception 'tenant not enabled for the energy configurator'; end if;

  -- rate limits
  if (select count(*) from public.energy_configurations
        where ip_hash = p->>'ip_hash' and created_at > now() - interval '1 hour') >= s.max_saves_per_ip_per_hour then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.energy_configurations
        where tenant_id = v_tenant and created_at > now() - interval '1 day') >= s.max_saves_per_day then
    raise exception 'rate_limited';
  end if;

  -- company (not for households): match on name, case-insensitive
  if v_company is not null then
    select id into v_company_id from public.companies
      where tenant_id = v_tenant and lower(name) = lower(v_company) limit 1;
    if v_company_id is null then
      insert into public.companies (tenant_id, name, owner_id, tags)
        values (v_tenant, v_company, s.owner_id, array['energy-configurator'])
        on conflict (tenant_id, name) do nothing
        returning id into v_company_id;
      if v_company_id is null then
        select id into v_company_id from public.companies where tenant_id = v_tenant and name = v_company;
      end if;
    end if;
  end if;

  -- contact: match on e-mail so a returning visitor is not duplicated
  select id into v_contact from public.contacts where tenant_id = v_tenant and lower(email) = v_email limit 1;
  if v_contact is null then
    insert into public.contacts (tenant_id, first_name, last_name, email, phone, company_id, stage, source,
                                 lead_source, owner_id, tags)
      values (v_tenant, p->'contact'->>'first_name', coalesce(p->'contact'->>'last_name', ''), v_email,
              nullif(p->'contact'->>'phone', ''), v_company_id, 'lead', 'energy-configurator',
              'Energy configurator', s.owner_id, array['energy-configurator'])
      returning id into v_contact;
  elsif v_company_id is not null then
    update public.contacts set company_id = v_company_id, updated_at = now()
      where id = v_contact and company_id is null;
  end if;

  -- deal: value = total investment, first stage of the tenant's board
  insert into public.deals (tenant_id, title, value, company_id, contact_id, owner_id, board_id, stage_id,
                            custom_fields, segment)
    values (v_tenant, 'Energy configuration - ' || coalesce(p->>'site_label', 'site'), v_capex, v_company_id,
            v_contact, s.owner_id, s.board_id, s.stage_id,
            jsonb_build_object('source', 'energy-configurator', 'npv_eur', (p->>'npv_eur')::numeric,
                               'model_version', p->>'model_version'),
            p->>'segment')
    returning id into v_deal;

  -- draft quote; lines carry the visitor's calculated amounts, so the quote total matches the deal value
  insert into public.quotes (tenant_id, deal_id, contact_id, company_id, quote_number, title, status,
                             valid_until, notes, created_by)
    values (v_tenant, v_deal, v_contact, v_company_id,
            'QO-' || (extract(epoch from clock_timestamp()) * 1000)::bigint,
            'Energy configuration - ' || coalesce(p->>'site_label', 'site'), 'draft',
            (now() + interval '30 days')::date,
            'Draft from the energy configurator (planning model, not checked on site).', s.owner_id)
    returning id into v_quote;

  for line in select * from jsonb_array_elements(coalesce(p->'quote_lines', '[]'::jsonb)) loop
    v_net := round((line->>'quantity')::numeric * (line->>'unit_price')::numeric, 2);
    insert into public.quote_items (quote_id, product_id, description, quantity, unit_price, tax_rate, total, sort_order)
      values (v_quote, nullif(s.product_map->>(line->>'part'), '')::uuid, line->>'description',
              (line->>'quantity')::numeric, (line->>'unit_price')::numeric, (line->>'tax_rate')::numeric,
              v_net, i);
    v_subtotal := v_subtotal + v_net;
    v_tax := v_tax + round(v_net * (line->>'tax_rate')::numeric / 100, 2);
    i := i + 1;
  end loop;
  update public.quotes set subtotal = v_subtotal, tax_amount = v_tax, total = v_subtotal + v_tax where id = v_quote;

  insert into public.energy_configurations (tenant_id, model_version, locale, inputs, result, site_label, npv_eur,
      capex_eur, checked_on_server, consent_at, consent_version, ip_hash, contact_id, company_id, deal_id, quote_id)
    values (v_tenant, p->>'model_version', coalesce(p->>'locale', 'nl'), p->'inputs', p->'result', p->>'site_label',
      (p->>'npv_eur')::numeric, v_capex, coalesce((p->>'checked_on_server')::boolean, false), now(),
      p->>'consent_version', p->>'ip_hash', v_contact, v_company_id, v_deal, v_quote)
    returning id into v_conf;

  return jsonb_build_object('configuration_id', v_conf, 'contact_id', v_contact, 'company_id', v_company_id,
                            'deal_id', v_deal, 'quote_id', v_quote);
end
$fn$;
revoke all on function public.energy_save_configuration(jsonb) from public, anon, authenticated;
grant execute on function public.energy_save_configuration(jsonb) to service_role;

-- 5. Seed: reference data for model version 2026.10-5
insert into public.energy_reference (version, valid_from, data)
values ('2026.10-5', date '2026-10-05', $ref${"model_version":"2026.10-5","connections":[{"id":"3x25A","label":"3 x 25 A","kw":17.3,"cls":"kv","fee_yr":357,"group":"Kleinverbruik"},{"id":"3x35A","label":"3 x 35 A","kw":24.2,"cls":"kv","fee_yr":1562.05,"group":"Kleinverbruik"},{"id":"3x40A","label":"3 x 40 A","kw":27.6,"cls":"kv","fee_yr":1562.05,"group":"Kleinverbruik"},{"id":"3x50A","label":"3 x 50 A","kw":34.5,"cls":"kv","fee_yr":2306.65,"group":"Kleinverbruik"},{"id":"3x63A","label":"3 x 63 A","kw":43.5,"cls":"kv","fee_yr":3058.26,"group":"Kleinverbruik"},{"id":"3x80A","label":"3 x 80 A","kw":55.2,"cls":"kv","fee_yr":3802.86,"group":"Kleinverbruik"},{"id":"3x100A","label":"3 x 100 A","kw":69,"cls":"gv","aansluit_month":5.15,"group":"Grootverbruik, low voltage"},{"id":"3x125A","label":"3 x 125 A","kw":86.3,"cls":"gv","aansluit_month":5.15,"group":"Grootverbruik, low voltage"},{"id":"3x160A","label":"3 x 160 A","kw":110.4,"cls":"gv","aansluit_month":24.79,"group":"Grootverbruik, low voltage"},{"id":"3x200A","label":"3 x 200 A","kw":138,"cls":"gv","aansluit_month":24.79,"group":"Grootverbruik, low voltage"},{"id":"3x250A","label":"3 x 250 A","kw":172.5,"cls":"gv","aansluit_month":24.79,"group":"Grootverbruik, low voltage"},{"id":"250kVA","label":"250 kVA","kw":250,"cls":"gv","aansluit_month":88.62,"group":"Grootverbruik, transformer"},{"id":"400kVA","label":"400 kVA","kw":400,"cls":"gv","aansluit_month":88.62,"group":"Grootverbruik, transformer"},{"id":"630kVA","label":"630 kVA","kw":630,"cls":"gv","aansluit_month":88.62,"group":"Grootverbruik, transformer"},{"id":"1000kVA","label":"1,000 kVA","kw":1000,"cls":"gv","aansluit_month":88.62,"group":"Grootverbruik, transformer"},{"id":"1600kVA","label":"1,600 kVA","kw":1600,"cls":"gv","aansluit_month":162.17,"group":"Grootverbruik, transformer"}],"grid_bands":[{"name":"LS t/m 50 kW","lo":0,"upto":50,"vastrecht":18,"kw_contract":17.88,"kwmax":0,"kwh":null,"kwh_peak":0.0806,"kwh_offpeak":0.043},{"name":"MS/LS 50-136 kW","lo":50,"upto":136,"vastrecht":441,"kw_contract":44.88,"kwmax":3.57,"kwh":0.0226,"kwh_peak":null,"kwh_offpeak":null},{"name":"MS 136-2,000 kW","lo":136,"upto":2000,"vastrecht":441,"kw_contract":27.48,"kwmax":3.57,"kwh":0.0226,"kwh_peak":null,"kwh_offpeak":null},{"name":"TS/MS > 2,000 kW","lo":2000,"upto":null,"vastrecht":2760,"kw_contract":47.88,"kwmax":6.24,"kwh":0,"kwh_peak":null,"kwh_offpeak":null}],"defaults":{"prices":{"wholesale_base_eur_mwh":87,"supplier_markup_eur_kwh":0.015,"fixed_contract_eur_kwh":0.105,"contract_type":"dynamic","price_volatility_factor":1,"energy_tax_brackets":[[10000,0.09161],[50000,0.06671],[10000000,0.03735],[null,0.0031]],"energy_tax_flat_eur_kwh":0,"ode_eur_kwh":0,"feedin_mode":"market","feedin_fixed_eur_kwh":0.04,"feedin_fee_eur_kwh":0.01,"feedin_penalty_eur_kwh":0,"curtail_below_eur_kwh":0,"net_metering":false,"public_charging_eur_kwh":0.37,"public_charging_time_cost_eur_kwh":0,"commodity_escalation_pct":2,"tax_escalation_pct":2,"grid_tariff_escalation_pct":4.5,"feedin_escalation_pct":1},"grid":{"auto_band":true,"bands":[{"name":"LS t/m 50 kW","lo":0,"upto":50,"vastrecht":18,"kw_contract":17.88,"kwmax":0,"kwh":null,"kwh_peak":0.0806,"kwh_offpeak":0.043},{"name":"MS/LS 50-136 kW","lo":50,"upto":136,"vastrecht":441,"kw_contract":44.88,"kwmax":3.57,"kwh":0.0226,"kwh_peak":null,"kwh_offpeak":null},{"name":"MS 136-2,000 kW","lo":136,"upto":2000,"vastrecht":441,"kw_contract":27.48,"kwmax":3.57,"kwh":0.0226,"kwh_peak":null,"kwh_offpeak":null},{"name":"TS/MS > 2,000 kW","lo":2000,"upto":null,"vastrecht":2760,"kw_contract":47.88,"kwmax":6.24,"kwh":0,"kwh_peak":null,"kwh_offpeak":null}],"vastrecht_eur_yr":441,"kw_contract_eur_kw_yr":44.88,"kwmax_eur_kw_month":3.57,"kwh_transport_eur_kwh":0.0226,"aansluitvergoeding_eur_month":22.09,"contracted_kw":0,"contract_headroom_pct":10,"contracted_cap_pct":0,"qh_peak_factor":1,"hard_limit_margin_pct":10,"non_firm_ato":false,"non_firm_discount_pct":35,"non_firm_curtail_hours":[16,21],"non_firm_curtail_to_pct":40,"connection_upgrade_eur_kw":120,"connection_upgrade_blocked":false},"costs":{"pv_eur_kwp":650,"pv_eur_kwp_small_adder":150,"pv_scale_break_kwp":100,"pv_opex_pct_capex_yr":1.2,"pv_inverter_replace_year":13,"pv_inverter_replace_pct_capex":12,"pv_degradation_pct_yr":0.5,"roof_reinforcement_eur_kwp":0,"battery_eur_kwh":320,"battery_eur_kw":180,"battery_fixed_eur":15000,"battery_opex_pct_capex_yr":1.5,"battery_opex_eur_kwh_yr":0,"battery_replace_year":0,"battery_replace_cost_pct":60,"battery_degradation_pct_yr":2,"charger_ac_22kw_eur":3200,"charger_dc_60kw_eur":32000,"charger_dc_150kw_eur":68000,"charger_truck_350kw_eur":165000,"charger_civil_eur_each":1800,"charger_opex_eur_yr_each":350,"smart_charging_eur_yr_per_charger":120,"ems_fixed_eur":12000,"ems_opex_eur_yr":1800,"engineering_pct_capex":4,"contingency_pct_capex":5},"finance":{"horizon_years":15,"discount_rate_pct":6,"inflation_pct":2,"corporate_tax_pct":25.8,"eia_enabled":true,"eia_deduction_pct":40,"eia_applies_pv":true,"eia_applies_battery":true,"eia_applies_charger":false,"sde_eur_kwh":0,"sde_years":15,"residual_value_pct":5},"site":{"name":"Site","archetype":"office","annual_load_mwh":250,"latitude":52.1,"roof_area_m2":2500,"pv_m2_per_kwp":5,"specific_yield_kwh_kwp":0,"pv_yield_by_orientation":{"south":950,"east_west":850,"flat":880},"pv_inverter_kw_per_kwp":0.87,"pv_orientation_mix":"east_west","ev_annual_kwh":90000,"n_ev_ac":8,"n_ev_dc":1,"ac_socket_kw":22,"dc_socket_kw":60,"ev_fuel_savings_eur_kwh":0,"household":false,"vat_pct":21,"pv_vat_pct":0,"smart_charging":true,"smart_charging_shift_hours":4},"battery":{"c_rate":0.5,"round_trip_efficiency_pct":88,"depth_of_discharge_pct":90,"min_soc_pct":5,"max_cycles_per_year":500,"strategy":"blended","peak_target_kw":0,"reserve_for_peak_pct":30},"scenario":"base"},"scenarios":{"base":{"_label":"Base case 2026","_label_nl":"Basis 2026"},"low_price":{"_label":"Low energy price","_label_nl":"Lage energieprijs","prices.wholesale_base_eur_mwh":55,"prices.fixed_contract_eur_kwh":0.072,"prices.commodity_escalation_pct":0.5,"prices.feedin_fee_eur_kwh":0.015},"high_price":{"_label":"High energy price","_label_nl":"Hoge energieprijs","prices.wholesale_base_eur_mwh":130,"prices.fixed_contract_eur_kwh":0.155,"prices.commodity_escalation_pct":4},"volatile":{"_label":"Volatile prices","_label_nl":"Sterk wisselende prijzen","prices.price_volatility_factor":1.9,"prices.feedin_penalty_eur_kwh":0.01},"no_subsidy":{"_label":"No subsidy","_label_nl":"Geen subsidie","finance.eia_enabled":false,"finance.sde_eur_kwh":0},"full_subsidy":{"_label":"Maximum support","_label_nl":"Maximale steun","finance.eia_enabled":true,"finance.eia_applies_charger":true,"finance.sde_eur_kwh":0.02},"cheap_battery":{"_label":"Cheap batteries (2030)","_label_nl":"Goedkope batterijen (2030)","costs.battery_eur_kwh":190,"costs.battery_eur_kw":120}},"site_types":{"house":{"archetype":"residential","mwh":7,"roof":60,"ev_kwh":6000,"ac_kw":11,"overrides":{"site.household":true,"costs.pv_eur_kwp":1000,"costs.pv_eur_kwp_small_adder":0,"costs.pv_opex_pct_capex_yr":1,"costs.battery_eur_kwh":450,"costs.battery_eur_kw":150,"costs.battery_fixed_eur":1000,"costs.battery_opex_pct_capex_yr":1,"costs.charger_ac_22kw_eur":1200,"costs.charger_civil_eur_each":400,"costs.charger_opex_eur_yr_each":40,"costs.smart_charging_eur_yr_per_charger":0,"costs.ems_fixed_eur":300,"costs.ems_opex_eur_yr":0,"costs.engineering_pct_capex":0,"costs.contingency_pct_capex":0,"finance.eia_enabled":false,"finance.discount_rate_pct":4,"prices.supplier_markup_eur_kwh":0.02,"prices.feedin_fee_eur_kwh":0.03}},"shop":{"archetype":"retail","mwh":80,"roof":500,"ev_kwh":14000,"ac_kw":22,"overrides":{"costs.ems_fixed_eur":3000,"costs.ems_opex_eur_yr":300,"costs.battery_fixed_eur":3000}},"office":{"archetype":"office","mwh":250,"roof":2500,"ev_kwh":90000,"ac_kw":22,"overrides":null},"warehouse":{"archetype":"warehouse","mwh":600,"roof":9000,"ev_kwh":210000,"ac_kw":22,"overrides":null},"industry":{"archetype":"industry","mwh":900,"roof":6000,"ev_kwh":45000,"ac_kw":22,"overrides":null},"retail":{"archetype":"retail","mwh":300,"roof":2000,"ev_kwh":30000,"ac_kw":22,"overrides":null}},"sources":[{"key":"energy_tax_2026","text":"Vattenfall Grootzakelijk - Tarieven energiebelasting per 1-1-2026"},{"key":"grid_tariffs_2026","text":"Liander - Tarieven voor aansluiting en transport elektriciteit 2026 (grootzakelijk)"},{"key":"kleinverbruik_2026","text":"Liander - Jaarlijkse netwerkkosten stroom 2026 (capaciteitstarief per aansluiting, excl. btw)"},{"key":"wholesale_2025","text":"TenneT annual market update 2025: NL day-ahead avg EUR 87/MWh, 584 negative hours"},{"key":"pv_capex","text":"NL commercial rooftop pricing 2026: EUR 0.50-0.90/Wp installed"},{"key":"public_charging","text":"Athlon kennisbank, Tarieven elektrisch opladen (May 2025): public AC EUR 0.25-0.55/kWh"},{"key":"upgrade_cost","text":"ASSUMPTION - connection upgrade EUR 120/kW; not in Liander's tariff sheet"},{"key":"pv_yield","text":"ASSUMPTION - typical NL solar yield per kWp: south 950, flat/mixed 880, east-west 850 kWh per year"},{"key":"pv_inverter","text":"ASSUMPTION - inverter sized at DC/AC 1.15: at most 0.87 kW per kWp of panels"}]}$ref$::jsonb);

-- 6. Seed: Demo tenant only (99cc77f3-...). Five products for the quote lines, then the settings row.
--    Board "Sales Pipeline", stage "New Lead", owner whendriksen25@gmail.com.
with p as (
  insert into public.products (tenant_id, name, description, sku, unit_price, unit, tax_rate, category)
  values
    ('99cc77f3-e2dc-4406-8fbd-3676508aa006', 'Solar panels (installed)', 'Rooftop PV incl. inverter and mounting', 'EC-PV-KWP', 650, 'kWp', 21, 'Energy configurator'),
    ('99cc77f3-e2dc-4406-8fbd-3676508aa006', 'Battery storage (installed)', 'Battery system incl. inverter and installation', 'EC-BATT-KWH', 320, 'kWh', 21, 'Energy configurator'),
    ('99cc77f3-e2dc-4406-8fbd-3676508aa006', 'Extra charge points', 'Charge points above the set the fleet needs anyway, incl. civil works', 'EC-CHARGE', 3200, 'piece', 21, 'Energy configurator'),
    ('99cc77f3-e2dc-4406-8fbd-3676508aa006', 'Energy management system (EMS)', 'Control of battery, solar and smart charging', 'EC-EMS', 12000, 'piece', 21, 'Energy configurator'),
    ('99cc77f3-e2dc-4406-8fbd-3676508aa006', 'Engineering and contingency', 'Design, permits, project management and contingency', 'EC-ENG', 0, 'project', 21, 'Energy configurator')
  returning id, sku
)
insert into public.energy_tenant_settings (tenant_id, enabled, board_id, stage_id, owner_id, product_map)
select '99cc77f3-e2dc-4406-8fbd-3676508aa006', true,
       '12bc9e5c-89b6-4029-8702-1506ba6a277a', '712d0e6f-12e2-4a68-89a3-796bf1e93079',
       '37c09cab-427b-4d8d-8d94-59dbea73d21c',
       jsonb_build_object(
         'solar',       (select id from p where sku = 'EC-PV-KWP'),
         'battery',     (select id from p where sku = 'EC-BATT-KWH'),
         'chargers',    (select id from p where sku = 'EC-CHARGE'),
         'ems',         (select id from p where sku = 'EC-EMS'),
         'engineering', (select id from p where sku = 'EC-ENG'));
