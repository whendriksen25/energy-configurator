// All model parameters. Mirrors src/params.py of the Python reference model.
// All prices EXCLUDING VAT (households: the model adds VAT where it applies).

export type Band = {
  name: string; lo: number; upto: number; vastrecht: number; kw_contract: number;
  kwmax: number; kwh: number | null; kwh_peak: number | null; kwh_offpeak: number | null;
};

export type Connection = {
  id: string; label: string; kw: number; cls: "kv" | "gv";
  fee_yr?: number; aansluit_month?: number; group: string;
};

export const LIANDER_2026_BANDS: Band[] = [
  { name: "LS t/m 50 kW", lo: 0, upto: 50, vastrecht: 18.0, kw_contract: 17.88, kwmax: 0.0, kwh: null, kwh_peak: 0.0806, kwh_offpeak: 0.043 },
  { name: "MS/LS 50-136 kW", lo: 50, upto: 136, vastrecht: 441.0, kw_contract: 44.88, kwmax: 3.57, kwh: 0.0226, kwh_peak: null, kwh_offpeak: null },
  { name: "MS 136-2,000 kW", lo: 136, upto: 2000, vastrecht: 441.0, kw_contract: 27.48, kwmax: 3.57, kwh: 0.0226, kwh_peak: null, kwh_offpeak: null },
  { name: "TS/MS > 2,000 kW", lo: 2000, upto: Infinity, vastrecht: 2760.0, kw_contract: 47.88, kwmax: 6.24, kwh: 0.0, kwh_peak: null, kwh_offpeak: null },
];

const KV = "Kleinverbruik";
const LV = "Grootverbruik, low voltage";
const TR = "Grootverbruik, transformer";
export const CONNECTIONS: Connection[] = [
  { id: "3x25A", label: "3 x 25 A", kw: 17.3, cls: "kv", fee_yr: 357.0, group: KV },
  { id: "3x35A", label: "3 x 35 A", kw: 24.2, cls: "kv", fee_yr: 1562.05, group: KV },
  { id: "3x40A", label: "3 x 40 A", kw: 27.6, cls: "kv", fee_yr: 1562.05, group: KV },
  { id: "3x50A", label: "3 x 50 A", kw: 34.5, cls: "kv", fee_yr: 2306.65, group: KV },
  { id: "3x63A", label: "3 x 63 A", kw: 43.5, cls: "kv", fee_yr: 3058.26, group: KV },
  { id: "3x80A", label: "3 x 80 A", kw: 55.2, cls: "kv", fee_yr: 3802.86, group: KV },
  { id: "3x100A", label: "3 x 100 A", kw: 69.0, cls: "gv", aansluit_month: 5.15, group: LV },
  { id: "3x125A", label: "3 x 125 A", kw: 86.3, cls: "gv", aansluit_month: 5.15, group: LV },
  { id: "3x160A", label: "3 x 160 A", kw: 110.4, cls: "gv", aansluit_month: 24.79, group: LV },
  { id: "3x200A", label: "3 x 200 A", kw: 138.0, cls: "gv", aansluit_month: 24.79, group: LV },
  { id: "3x250A", label: "3 x 250 A", kw: 172.5, cls: "gv", aansluit_month: 24.79, group: LV },
  { id: "250kVA", label: "250 kVA", kw: 250.0, cls: "gv", aansluit_month: 88.62, group: TR },
  { id: "400kVA", label: "400 kVA", kw: 400.0, cls: "gv", aansluit_month: 88.62, group: TR },
  { id: "630kVA", label: "630 kVA", kw: 630.0, cls: "gv", aansluit_month: 88.62, group: TR },
  { id: "1000kVA", label: "1,000 kVA", kw: 1000.0, cls: "gv", aansluit_month: 88.62, group: TR },
  { id: "1600kVA", label: "1,600 kVA", kw: 1600.0, cls: "gv", aansluit_month: 162.17, group: TR },
];
export const CONN: Record<string, Connection> = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c]));

export function smallestConnection(kw: number, atLeast?: string): Connection {
  const floor = atLeast ? CONN[atLeast].kw : 0;
  for (const c of CONNECTIONS) if (c.kw >= kw - 1e-6 && c.kw >= floor) return c;
  return { id: "custom", label: `${kw.toFixed(0)} kW (custom MV)`, kw, cls: "gv", aansluit_month: 162.17, group: TR };
}

export function defaultParams() {
  return {
    prices: {
      wholesale_base_eur_mwh: 87.0,
      supplier_markup_eur_kwh: 0.015,
      fixed_contract_eur_kwh: 0.105,
      contract_type: "dynamic" as "dynamic" | "fixed",
      price_volatility_factor: 1.0,
      energy_tax_brackets: [[10000, 0.09161], [50000, 0.06671], [10000000, 0.03735], [Infinity, 0.0031]] as [number, number][],
      energy_tax_flat_eur_kwh: 0.0,
      ode_eur_kwh: 0.0,
      feedin_mode: "market" as "market" | "fixed" | "none",
      feedin_fixed_eur_kwh: 0.04,
      feedin_fee_eur_kwh: 0.01,
      feedin_penalty_eur_kwh: 0.0,
      curtail_below_eur_kwh: 0.0,
      net_metering: false,
      public_charging_eur_kwh: 0.37,
      public_charging_time_cost_eur_kwh: 0.0,
      commodity_escalation_pct: 2.0,
      tax_escalation_pct: 2.0,
      grid_tariff_escalation_pct: 4.5,
      feedin_escalation_pct: 1.0,
    },
    grid: {
      auto_band: true,
      bands: LIANDER_2026_BANDS.map((b) => ({ ...b })),
      vastrecht_eur_yr: 441.0,
      kw_contract_eur_kw_yr: 44.88,
      kwmax_eur_kw_month: 3.57,
      kwh_transport_eur_kwh: 0.0226,
      aansluitvergoeding_eur_month: 22.09,
      contracted_kw: 0.0,
      contract_headroom_pct: 10.0,
      contracted_cap_pct: 0.0,
      qh_peak_factor: 1.0,
      hard_limit_margin_pct: 10.0,
      non_firm_ato: false,
      non_firm_discount_pct: 35.0,
      non_firm_curtail_hours: [16, 21] as [number, number],
      non_firm_curtail_to_pct: 40.0,
      connection_upgrade_eur_kw: 120.0,
      connection_upgrade_blocked: false,
    },
    costs: {
      pv_eur_kwp: 650.0,
      pv_eur_kwp_small_adder: 150.0,
      pv_scale_break_kwp: 100.0,
      pv_opex_pct_capex_yr: 1.2,
      pv_inverter_replace_year: 13,
      pv_inverter_replace_pct_capex: 12.0,
      pv_degradation_pct_yr: 0.5,
      roof_reinforcement_eur_kwp: 0.0,
      battery_eur_kwh: 320.0,
      battery_eur_kw: 180.0,
      battery_fixed_eur: 15000.0,
      battery_opex_pct_capex_yr: 1.5,
      battery_opex_eur_kwh_yr: 0.0,
      battery_replace_year: 0,
      battery_replace_cost_pct: 60.0,
      battery_degradation_pct_yr: 2.0,
      charger_ac_22kw_eur: 3200.0,
      charger_dc_60kw_eur: 32000.0,
      charger_dc_150kw_eur: 68000.0,
      charger_truck_350kw_eur: 165000.0,
      charger_civil_eur_each: 1800.0,
      charger_opex_eur_yr_each: 350.0,
      smart_charging_eur_yr_per_charger: 120.0,
      ems_fixed_eur: 12000.0,
      ems_opex_eur_yr: 1800.0,
      engineering_pct_capex: 4.0,
      contingency_pct_capex: 5.0,
    },
    finance: {
      horizon_years: 15,
      discount_rate_pct: 6.0,
      inflation_pct: 2.0,
      corporate_tax_pct: 25.8,
      eia_enabled: true,
      eia_deduction_pct: 40.0,
      eia_applies_pv: true,
      eia_applies_battery: true,
      eia_applies_charger: false,
      sde_eur_kwh: 0.0,
      sde_years: 15,
      residual_value_pct: 5.0,
    },
    site: {
      name: "Site",
      archetype: "office",
      annual_load_mwh: 250.0,
      latitude: 52.1,
      roof_area_m2: 2500.0,
      pv_m2_per_kwp: 5.0,
      specific_yield_kwh_kwp: 950.0,
      pv_orientation_mix: "east_west",
      ev_annual_kwh: 90000.0,
      n_ev_ac: 8,
      n_ev_dc: 1,
      ac_socket_kw: 22.0,
      dc_socket_kw: 60.0,
      ev_fuel_savings_eur_kwh: 0.0,
      household: false,
      vat_pct: 21.0,
      pv_vat_pct: 0.0,
      smart_charging: true,
      smart_charging_shift_hours: 4.0,
    },
    battery: {
      c_rate: 0.5,
      round_trip_efficiency_pct: 88.0,
      depth_of_discharge_pct: 90.0,
      min_soc_pct: 5.0,
      max_cycles_per_year: 500.0,
      strategy: "blended",
      peak_target_kw: 0.0,
      reserve_for_peak_pct: 30.0,
    },
    scenario: "base",
  };
}
export type Params = ReturnType<typeof defaultParams>;
export type Overrides = Record<string, number | string | boolean>;

export function applyOverrides(p: Params, ov: Overrides | null | undefined): Params {
  const q: Params = structuredClone(p);
  if (!ov) return q;
  for (const [path, value] of Object.entries(ov)) {
    if (path.startsWith("_")) continue;
    const [section, attr] = path.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sec = (q as any)[section];
    if (sec && attr in sec) sec[attr] = value;
  }
  return q;
}

export const SCENARIOS: Record<string, Overrides & { _label: string; _label_nl: string }> = {
  base: { _label: "Base case 2026", _label_nl: "Basis 2026" },
  low_price: { _label: "Low energy price", _label_nl: "Lage energieprijs",
    "prices.wholesale_base_eur_mwh": 55.0, "prices.fixed_contract_eur_kwh": 0.072,
    "prices.commodity_escalation_pct": 0.5, "prices.feedin_fee_eur_kwh": 0.015 },
  high_price: { _label: "High energy price", _label_nl: "Hoge energieprijs",
    "prices.wholesale_base_eur_mwh": 130.0, "prices.fixed_contract_eur_kwh": 0.155,
    "prices.commodity_escalation_pct": 4.0 },
  volatile: { _label: "Volatile prices", _label_nl: "Sterk wisselende prijzen",
    "prices.price_volatility_factor": 1.9, "prices.feedin_penalty_eur_kwh": 0.01 },
  no_subsidy: { _label: "No subsidy", _label_nl: "Geen subsidie",
    "finance.eia_enabled": false, "finance.sde_eur_kwh": 0.0 },
  full_subsidy: { _label: "Maximum support", _label_nl: "Maximale steun",
    "finance.eia_enabled": true, "finance.eia_applies_charger": true, "finance.sde_eur_kwh": 0.02 },
  cheap_battery: { _label: "Cheap batteries (2030)", _label_nl: "Goedkope batterijen (2030)",
    "costs.battery_eur_kwh": 190.0, "costs.battery_eur_kw": 120.0 },
};

export function applyScenario(p: Params, name: string): Params {
  const q = applyOverrides(p, SCENARIOS[name] ?? {});
  q.scenario = name;
  return q;
}

// Site types offered to visitors (configurator_ref.SITE_TYPES).
const SMALL_BIZ: Overrides = { "costs.ems_fixed_eur": 3000.0, "costs.ems_opex_eur_yr": 300.0, "costs.battery_fixed_eur": 3000.0 };
const HOUSE: Overrides = {
  "site.household": true, "costs.pv_eur_kwp": 1000.0, "costs.pv_eur_kwp_small_adder": 0.0,
  "costs.pv_opex_pct_capex_yr": 1.0, "costs.battery_eur_kwh": 450.0, "costs.battery_eur_kw": 150.0,
  "costs.battery_fixed_eur": 1000.0, "costs.battery_opex_pct_capex_yr": 1.0, "costs.charger_ac_22kw_eur": 1200.0,
  "costs.charger_civil_eur_each": 400.0, "costs.charger_opex_eur_yr_each": 40.0,
  "costs.smart_charging_eur_yr_per_charger": 0.0, "costs.ems_fixed_eur": 300.0, "costs.ems_opex_eur_yr": 0.0,
  "costs.engineering_pct_capex": 0.0, "costs.contingency_pct_capex": 0.0, "finance.eia_enabled": false,
  "finance.discount_rate_pct": 4.0, "prices.supplier_markup_eur_kwh": 0.02, "prices.feedin_fee_eur_kwh": 0.03,
};

export type SiteTypeId = "house" | "shop" | "office" | "warehouse" | "industry" | "retail";
export const SITE_TYPES: Record<SiteTypeId, { archetype: string; mwh: number; roof: number; ev_kwh: number; ac_kw: number; overrides: Overrides | null }> = {
  house: { archetype: "residential", mwh: 7, roof: 60, ev_kwh: 6000, ac_kw: 11, overrides: HOUSE },
  shop: { archetype: "retail", mwh: 80, roof: 500, ev_kwh: 14000, ac_kw: 22, overrides: SMALL_BIZ },
  office: { archetype: "office", mwh: 250, roof: 2500, ev_kwh: 90000, ac_kw: 22, overrides: null },
  warehouse: { archetype: "warehouse", mwh: 600, roof: 9000, ev_kwh: 210000, ac_kw: 22, overrides: null },
  industry: { archetype: "industry", mwh: 900, roof: 6000, ev_kwh: 45000, ac_kw: 22, overrides: null },
  retail: { archetype: "retail", mwh: 300, roof: 2000, ev_kwh: 30000, ac_kw: 22, overrides: null },
};

export function sizeOverrides(mwh: number): Overrides {
  if (mwh < 150) return { "costs.ems_fixed_eur": 6000.0, "costs.battery_fixed_eur": 8000.0 };
  if (mwh > 600) return { "costs.ems_fixed_eur": 20000.0, "costs.battery_fixed_eur": 25000.0 };
  return {};
}

export const PATTERN: Record<string, string> = {
  office: "office", warehouse: "depot", industry: "office", ev_hub: "public",
  truck_depot: "depot", retail: "public", residential: "residential",
};

export const SOURCES = [
  { key: "energy_tax_2026", text: "Vattenfall Grootzakelijk - Tarieven energiebelasting per 1-1-2026" },
  { key: "grid_tariffs_2026", text: "Liander - Tarieven voor aansluiting en transport elektriciteit 2026 (grootzakelijk)" },
  { key: "kleinverbruik_2026", text: "Liander - Jaarlijkse netwerkkosten stroom 2026 (capaciteitstarief per aansluiting, excl. btw)" },
  { key: "wholesale_2025", text: "TenneT annual market update 2025: NL day-ahead avg EUR 87/MWh, 584 negative hours" },
  { key: "pv_capex", text: "NL commercial rooftop pricing 2026: EUR 0.50-0.90/Wp installed" },
  { key: "public_charging", text: "Athlon kennisbank, Tarieven elektrisch opladen (May 2025): public AC EUR 0.25-0.55/kWh" },
  { key: "upgrade_cost", text: "ASSUMPTION - connection upgrade EUR 120/kW; not in Liander's tariff sheet" },
];

export const MODEL_VERSION = "2026.10-4a";
