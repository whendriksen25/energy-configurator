// Hourly energy flows -> euros (Dutch cost stack). Mirrors src/economics.py.
import { Params, Connection, Band, smallestConnection } from "./params";
import { HOURS, HOD, IS_WEEKEND, sum, npsum, max } from "./profiles";
import type { SimResult } from "./simulate";

export function energyTax(kwh: number, prices: Params["prices"]): number {
  if (prices.energy_tax_flat_eur_kwh > 0) return kwh * (prices.energy_tax_flat_eur_kwh + prices.ode_eur_kwh);
  let total = 0, prev = 0;
  for (const [upper, rate] of prices.energy_tax_brackets) {
    if (kwh <= prev) break;
    total += (Math.min(kwh, upper) - prev) * (rate + prices.ode_eur_kwh);
    prev = upper;
  }
  return total;
}

export function importPrice(prices: Params["prices"], curve: Float64Array): Float64Array {
  if (prices.contract_type === "fixed") return new Float64Array(curve.length).fill(prices.fixed_contract_eur_kwh);
  return curve.map((v) => v + prices.supplier_markup_eur_kwh);
}

export function exportPrice(prices: Params["prices"], curve: Float64Array): Float64Array {
  if (prices.feedin_mode === "none") return new Float64Array(curve.length);
  return curve.map((v) => (prices.feedin_mode === "fixed" ? prices.feedin_fixed_eur_kwh : v - prices.feedin_fee_eur_kwh)
    - prices.feedin_penalty_eur_kwh);
}

export type AnnualCost = {
  commodity_eur: number; energy_tax_eur: number; transport_kwh_eur: number; kw_contract_eur: number;
  kwmax_eur: number; fixed_eur: number; export_revenue_eur: number; opex_eur: number; sde_revenue_eur: number;
  fuel_savings_eur: number; public_charging_eur: number; contracted_kw: number; band: string;
};
export const gridCost = (a: AnnualCost) => a.commodity_eur + a.energy_tax_eur + a.transport_kwh_eur + a.kw_contract_eur
  + a.kwmax_eur + a.fixed_eur - a.export_revenue_eur + a.public_charging_eur;
export const totalCost = (a: AnnualCost) => gridCost(a) + a.opex_eur - a.sde_revenue_eur - a.fuel_savings_eur;
export const networkCost = (a: AnnualCost) => a.transport_kwh_eur + a.kw_contract_eur + a.kwmax_eur + a.fixed_eur;

const vat = (p: Params) => (p.site.household ? 1 + p.site.vat_pct / 100 : 1.0);

function tariffBand(g: Params["grid"], contracted: number): Band {
  if (!g.auto_band) {
    return { name: "manual", lo: 0, upto: Infinity, vastrecht: g.vastrecht_eur_yr, kw_contract: g.kw_contract_eur_kw_yr,
      kwmax: g.kwmax_eur_kw_month, kwh: g.kwh_transport_eur_kwh, kwh_peak: null, kwh_offpeak: null };
  }
  for (const b of g.bands) if (contracted <= b.upto) return b;
  return g.bands[g.bands.length - 1];
}

let _isPk: Uint8Array | null = null;
export function isPeakHour(): Uint8Array {
  if (!_isPk) {
    _isPk = new Uint8Array(HOURS);
    for (let t = 0; t < HOURS; t++) _isPk[t] = !IS_WEEKEND[t] && HOD[t] >= 7 && HOD[t] < 23 ? 1 : 0;
  }
  return _isPk;
}

export function connectionCost(importKw: Float64Array, importKwh: number, monthlyPeaks: number[], p: Params, conn: Connection) {
  const g = p.grid;
  if (conn.cls === "kv") {
    return { transport: 0, kw_contract: 0, kwmax: 0, fixed: conn.fee_yr ?? 0, contracted_kw: conn.kw, band: `Kleinverbruik ${conn.label}` };
  }
  const qh = g.qh_peak_factor;
  let need = Math.min(max(importKw) * qh * (1 + g.contract_headroom_pct / 100), conn.kw);
  if (g.contracted_kw > 0) need = Math.min(g.contracted_kw, conn.kw);
  const summ = npsum(monthlyPeaks) * qh;
  const pk = isPeakHour();
  const nf = g.non_firm_ato ? 1 - g.non_firm_discount_pct / 100 : 1.0;
  const bands = g.auto_band ? g.bands : [tariffBand(g, need)];
  let best: { tot: number; d: ReturnType<typeof mk> } | null = null;
  function mk(b: Band, c: number) {
    let transport: number;
    if (b.kwh === null || b.kwh === undefined) {
      const tr = new Float64Array(HOURS);
      for (let t = 0; t < HOURS; t++) tr[t] = importKw[t] * (pk[t] ? (b.kwh_peak ?? 0) : (b.kwh_offpeak ?? 0));
      transport = npsum(tr);
    } else transport = importKwh * b.kwh;
    return { transport, kw_contract: c * b.kw_contract * nf, kwmax: summ * b.kwmax,
      fixed: b.vastrecht + 12 * (conn.aansluit_month ?? 0), contracted_kw: c, band: `${conn.label}, ${b.name}` };
  }
  for (const b of bands) {
    if (b.upto < need) continue;
    const c = g.auto_band ? Math.max(need, b.lo + 0.01) : need;
    if (c > conn.kw + 1e-6) continue;
    const d = mk(b, c);
    const tot = d.transport + d.kw_contract + d.kwmax + d.fixed;
    if (best === null || tot < best.tot) best = { tot, d };
  }
  return best!.d;
}

export function annualCost(sim: SimResult, p: Params, opex = 0, pvKwh = 0, conn: Connection | null = null, publicKwh = 0): AnnualCost {
  const curve = sim.price_eur_kwh;
  const v = vat(p);
  const ip = importPrice(p.prices, curve), ep = exportPrice(p.prices, curve);
  const cm = new Float64Array(HOURS), rv = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) { cm[t] = sim.grid_import_kw[t] * ip[t]; rv[t] = sim.grid_export_kw[t] * ep[t]; }
  const com = npsum(cm), rev = npsum(rv);
  const c = conn ?? smallestConnection(sim.peak_import_kw * p.grid.qh_peak_factor * (1 + p.grid.contract_headroom_pct / 100));
  const cc = connectionCost(sim.grid_import_kw, sim.grid_import_kwh, sim.monthly_peak_kw, p, c);
  return {
    commodity_eur: com * v,
    energy_tax_eur: energyTax(sim.grid_import_kwh, p.prices) * v,
    transport_kwh_eur: cc.transport * v, kw_contract_eur: cc.kw_contract * v, kwmax_eur: cc.kwmax * v, fixed_eur: cc.fixed * v,
    contracted_kw: cc.contracted_kw, band: cc.band,
    export_revenue_eur: rev,
    opex_eur: opex,
    sde_revenue_eur: pvKwh * p.finance.sde_eur_kwh,
    fuel_savings_eur: 0,
    public_charging_eur: publicKwh * (p.prices.public_charging_eur_kwh * v + p.prices.public_charging_time_cost_eur_kwh),
  };
}

export type Capex = { pv_eur: number; battery_eur: number; charger_eur: number; ems_eur: number; hub_eur: number; soft_eur: number };
export const hardware = (c: Capex) => c.pv_eur + c.battery_eur + c.charger_eur + c.ems_eur + c.hub_eur;
export const capexTotal = (c: Capex) => hardware(c) + c.soft_eur;

export function buildCapex(p: Params, pvKwp: number, battKwh: number, battKw: number, nAc: number, nDc: number): Capex {
  const c = p.costs;
  const cx: Capex = { pv_eur: 0, battery_eur: 0, charger_eur: 0, ems_eur: 0, hub_eur: 0, soft_eur: 0 };
  if (pvKwp > 0) {
    const rate = c.pv_eur_kwp + (pvKwp < c.pv_scale_break_kwp ? c.pv_eur_kwp_small_adder : 0.0);
    cx.pv_eur = pvKwp * (rate + c.roof_reinforcement_eur_kwp);
  }
  if (battKwh > 0) cx.battery_eur = battKwh * c.battery_eur_kwh + battKw * c.battery_eur_kw + c.battery_fixed_eur;
  const n = nAc + nDc;
  if (n > 0) cx.charger_eur = nAc * c.charger_ac_22kw_eur + nDc * c.charger_dc_60kw_eur + n * c.charger_civil_eur_each;
  if (pvKwp > 0 || battKwh > 0 || n > 0) cx.ems_eur = c.ems_fixed_eur;
  if (p.site.household) {
    cx.pv_eur *= 1 + p.site.pv_vat_pct / 100;
    const f = 1 + p.site.vat_pct / 100;
    cx.battery_eur *= f; cx.charger_eur *= f; cx.ems_eur *= f;
  }
  cx.soft_eur = (hardware(cx) * (c.engineering_pct_capex + c.contingency_pct_capex)) / 100.0;
  return cx;
}

export function buildOpex(p: Params, cx: Capex, pvKwp: number, battKwh: number, nChargers: number): number {
  const c = p.costs;
  let o = 0;
  if (pvKwp > 0) o += (cx.pv_eur * c.pv_opex_pct_capex_yr) / 100;
  if (battKwh > 0) o += (cx.battery_eur * c.battery_opex_pct_capex_yr) / 100 + battKwh * c.battery_opex_eur_kwh_yr;
  if (nChargers > 0) o += nChargers * (c.charger_opex_eur_yr_each + (p.site.smart_charging ? c.smart_charging_eur_yr_per_charger : 0));
  if (cx.ems_eur > 0) o += c.ems_opex_eur_yr;
  return o;
}

export function cashflow(p: Params, capex: Capex, base: AnnualCost, proj: AnnualCost, year0Extra = 0): [number[], number] {
  const f = p.finance;
  const n = f.horizon_years;
  const cf = new Array(n + 1).fill(0);
  cf[0] = -capexTotal(capex) + year0Extra;
  let eia = 0;
  if (f.eia_enabled) {
    const q = (f.eia_applies_pv ? capex.pv_eur : 0) + (f.eia_applies_battery ? capex.battery_eur : 0)
      + (f.eia_applies_charger ? capex.charger_eur : 0);
    eia = (((q * f.eia_deduction_pct) / 100) * f.corporate_tax_pct) / 100;
    cf[0] += eia;
  }
  const sEnergy = base.commodity_eur + base.energy_tax_eur + base.public_charging_eur
    - proj.commodity_eur - proj.energy_tax_eur - proj.public_charging_eur;
  const sGrid = networkCost(base) - networkCost(proj);
  const sExport = proj.export_revenue_eur - base.export_revenue_eur;
  const sSde = proj.sde_revenue_eur - base.sde_revenue_eur;
  const sFuel = proj.fuel_savings_eur - base.fuel_savings_eur;
  const xOpex = proj.opex_eur - base.opex_eur;
  const pr = p.prices;
  const eC = 1 + pr.commodity_escalation_pct / 100, eG = 1 + pr.grid_tariff_escalation_pct / 100;
  const eF = 1 + pr.feedin_escalation_pct / 100, eI = 1 + f.inflation_pct / 100;
  const pvDeg = 1 - p.costs.pv_degradation_pct_yr / 100, btDeg = 1 - p.costs.battery_degradation_pct_yr / 100;
  for (let y = 1; y <= n; y++) {
    const pf = pvDeg ** (y - 1), bf = btDeg ** (y - 1);
    cf[y] = sEnergy * eC ** (y - 1) * pf
      + sGrid * eG ** (y - 1) * (capex.battery_eur > 0 ? 0.5 + 0.5 * bf : 1.0)
      + sExport * eF ** (y - 1) * pf
      + sSde * (y <= f.sde_years ? 1.0 : 0.0) * pf
      + sFuel * eI ** (y - 1)
      - xOpex * eI ** (y - 1);
    if (y === p.costs.pv_inverter_replace_year && capex.pv_eur > 0) cf[y] -= (capex.pv_eur * p.costs.pv_inverter_replace_pct_capex) / 100;
    if (p.costs.battery_replace_year && y === p.costs.battery_replace_year && capex.battery_eur > 0) {
      cf[y] -= (capex.battery_eur * p.costs.battery_replace_cost_pct) / 100;
    }
  }
  cf[n] += (capexTotal(capex) * f.residual_value_pct) / 100;
  return [cf, eia];
}

export function npv(cf: number[], ratePct: number): number {
  const r = ratePct / 100;
  return cf.reduce((s, c, t) => s + c / (1 + r) ** t, 0);
}

export function irr(cf: number[], lo = -0.9, hi = 1.5): number {
  const f = (r: number) => cf.reduce((s, c, t) => s + c / (1 + r) ** t, 0);
  let flo = f(lo);
  const fhi = f(hi);
  if (flo * fhi > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-6) break;
    if (flo * fm < 0) hi = mid;
    else { lo = mid; flo = fm; }
  }
  return ((lo + hi) / 2) * 100;
}

export function paybackYears(cf: number[]): number {
  const cum: number[] = [];
  cf.reduce((s, c) => { cum.push(s + c); return s + c; }, 0);
  for (let t = 1; t < cum.length; t++) {
    if (cum[t] >= 0) return t - 1 + -cum[t - 1] / (cum[t] - cum[t - 1]);
  }
  return NaN;
}

export { sum };
