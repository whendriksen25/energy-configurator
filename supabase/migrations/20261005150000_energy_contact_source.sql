-- Fix (5 Oct, after the first live save with a NEW e-mail address failed): contacts.source only allows
-- manual/csv/import/scan/form/website, so new contacts now get source 'website' (lead_source and tag still
-- say 'Energy configurator'). Function body otherwise unchanged. Grants are unchanged.

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
              nullif(p->'contact'->>'phone', ''), v_company_id, 'lead', 'website',  -- contacts.source allows only manual/csv/import/scan/form/website
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
