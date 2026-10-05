// One design of one site -> key figures. Mirrors evaluate() in src/model.py for the
// configurator case: a chosen standard connection, judged against a grid-only
// baseline with unmanaged charging on the connection that baseline would need.
import { Params, CONN, Connection, smallestConnection } from "./params";
import { HOURS, sum, npsum, max } from "./profiles";
import { simulate, smartChargeMinPeak, autoPeakTarget, SimResult } from "./simulate";
import * as ec from "./economics";

export type Series = {
  load: Float64Array; pv1: Float64Array; ev: Float64Array; pmaxH: Float64Array;
  flex: number; price: Float64Array; evUnserved: number;
};

export type Design = { conn: string; pv: number; batt: number; nAc: number; nDc: number };

export type Ctx = {
  p: Params;
  series: Series;              // for this design's socket set
  chargerCapexRef: number | null;
  baselineEv: Float64Array | null;
  baselineSockets: number | null;
  baseCache: Map<string, { base: ec.AnnualCost; bstats: BaseStats }>;
  smartCache: Map<string, [Float64Array, number]>;
};

type BaseStats = {
  import_kwh: number; wtd: number; peak: number; summonth: number; contracted: number;
  conn: string; conn_kw: number; network: number; public_kwh: number; pk: number;
};

export type Row = Record<string, number | string | boolean | null>;

// Rounding as Python's round(): on the exact binary value, halves to even.
function r0(x: number) {
  const f = Math.floor(x), diff = x - f;
  return diff > 0.5 ? f + 1 : diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
}
const rn = (x: number, d: number) => Number(x.toFixed(d));

function pkShare(flow: Float64Array) {
  const t = sum(flow);
  if (t <= 0) return 0;
  const pk = ec.isPeakHour();
  const f = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) f[i] = pk[i] ? flow[i] : 0;
  return npsum(f) / t;
}
function wtd(flow: Float64Array, price: Float64Array) {
  const t = sum(flow);
  if (t <= 0) return 0;
  const f = new Float64Array(HOURS);
  for (let i = 0; i < HOURS; i++) f[i] = flow[i] * price[i];
  return npsum(f) / t;
}

export function evaluate(ctx: Ctx, d: Design, detail = false): { row: Row; sim?: SimResult; baseSim?: SimResult; cf?: number[] } {
  const { p, series } = ctx;
  const { load, pv1, ev: evRaw, pmaxH, flex, price, evUnserved } = series;
  const pvEff = Math.min(d.pv, p.site.roof_area_m2 / Math.max(p.site.pv_m2_per_kwp, 0.1));
  const pv = pv1.map((v) => v * pvEff);
  const bkwh = d.batt;
  const bkw = bkwh * p.battery.c_rate;

  const evBase = ctx.baselineEv ?? evRaw;
  const conn: Connection = CONN[d.conn];
  const limit = conn.kw * (1 - p.grid.hard_limit_margin_pct / 100);
  const impLim = new Float64Array(HOURS).fill(limit);
  const expLim = new Float64Array(HOURS).fill(limit);

  let ev: Float64Array, shifted: number;
  if (p.site.smart_charging && sum(evRaw) > 0) {
    const key = `${d.nAc},${d.nDc}|${pvEff}|${d.conn}`;
    let hit = ctx.smartCache.get(key);
    if (!hit) {
      const [e, sh] = smartChargeMinPeak(evRaw, flex, pv, load, price, pmaxH, impLim);
      hit = [e, sh];
      ctx.smartCache.set(key, hit);
    }
    [ev, shifted] = hit;
  } else {
    ev = evRaw.slice();
    shifted = 0;
  }

  const impP = ec.importPrice(p.prices, price);
  const expP = ec.exportPrice(p.prices, price);
  let target: Float64Array;
  if (p.battery.peak_target_kw > 0) target = new Float64Array(HOURS).fill(p.battery.peak_target_kw);
  else {
    const net = new Float64Array(HOURS);
    for (let t = 0; t < HOURS; t++) net[t] = load[t] + ev[t] - pv[t];
    target = autoPeakTarget(net, (bkwh * p.battery.depth_of_discharge_pct) / 100, bkw);
  }
  for (let t = 0; t < HOURS; t++) target[t] = Math.min(target[t], impLim[t]);

  const sim = simulate(load, pv, ev, price, {
    battKwh: bkwh, battKw: bkw, rtePct: p.battery.round_trip_efficiency_pct, dodPct: p.battery.depth_of_discharge_pct,
    minSocPct: p.battery.min_soc_pct, importLimit: impLim, exportLimit: expLim, peakTarget: target,
    strategy: p.battery.strategy, reservePct: p.battery.reserve_for_peak_pct, curtailBelow: p.prices.curtail_below_eur_kwh,
    maxCycles: p.battery.max_cycles_per_year, sell: expP, buy: impP,
  });

  const nChg = d.nAc + d.nDc;
  const cx = ec.buildCapex(p, pvEff, bkwh, bkw, d.nAc, d.nDc);
  const opex = ec.buildOpex(p, cx, pvEff, bkwh, nChg);
  const publicKwh = sim.ev_curtailed_kwh + evUnserved;
  const proj = ec.annualCost(sim, p, opex, sim.pv_generation_kwh, conn, publicKwh);
  proj.fuel_savings_eur = (sum(evRaw) + evUnserved) * p.site.ev_fuel_savings_eur_kwh;

  // Baseline: same site and fleet, grid only, unmanaged charging, on the
  // connection it would need.
  const evBaseSum = sum(evBase);
  const bkey = `${p.scenario}|${evBaseSum.toFixed(1)}`;
  let cached = ctx.baseCache.get(bkey);
  let baseSim: SimResult | undefined;
  if (!cached || detail) {
    baseSim = simulate(load, new Float64Array(HOURS), evBase, price, { sell: expP, buy: impP });
    const bill = baseSim.peak_import_kw * p.grid.qh_peak_factor * (1 + p.grid.contract_headroom_pct / 100);
    const baseConn = smallestConnection(bill);
    const nb = ctx.baselineSockets ?? nChg;
    const base = ec.annualCost(baseSim, p, nb * p.costs.charger_opex_eur_yr_each, 0, baseConn, baseSim.ev_curtailed_kwh);
    base.fuel_savings_eur = evBaseSum * p.site.ev_fuel_savings_eur_kwh;
    const bstats: BaseStats = {
      import_kwh: baseSim.grid_import_kwh, wtd: wtd(baseSim.grid_import_kw, price), peak: baseSim.peak_import_kw,
      summonth: npsum(baseSim.monthly_peak_kw), contracted: bill,
      conn: baseConn.id, conn_kw: baseConn.kw, network: ec.networkCost(base),
      public_kwh: baseSim.ev_curtailed_kwh, pk: pkShare(baseSim.grid_import_kw),
    };
    cached = { base, bstats };
    ctx.baseCache.set(bkey, cached);
  }
  const { base, bstats } = cached;

  const chgInc = ctx.chargerCapexRef !== null ? Math.max(0, cx.charger_eur - ctx.chargerCapexRef) : 0;
  const pcx: ec.Capex = { pv_eur: cx.pv_eur, battery_eur: cx.battery_eur, charger_eur: chgInc, ems_eur: cx.ems_eur, hub_eur: 0, soft_eur: 0 };
  pcx.soft_eur = (ec.hardware(pcx) * (p.costs.engineering_pct_capex + p.costs.contingency_pct_capex)) / 100;

  const feasible = sim.unserved_kwh <= 0.0001 * Math.max(sum(load), 1);
  const upgradeKw = Math.max(0, bstats.conn_kw - conn.kw);
  const upgradeEur = feasible ? upgradeKw * p.grid.connection_upgrade_eur_kw : 0;
  const [cf, eia] = ec.cashflow(p, pcx, base, proj, upgradeEur);
  const npv = ec.npv(cf, p.finance.discount_rate_pct);
  const irr = ec.irr(cf);
  const pb = ec.paybackYears(cf);
  const evDelivered = sum(sim.ev_kw);

  const row: Row = {
    scenario: p.scenario, pv_kwp: rn(pvEff, 1), battery_kwh: rn(bkwh, 1), battery_kw: rn(bkw, 1),
    n_ac_chargers: d.nAc, n_dc_chargers: d.nDc,
    connection_kw: rn(limit, 1), connection_id: conn.id, connection_label: conn.label, conn_cls: conn.cls,
    conn_rated_kw: conn.kw, conn_fee_yr: conn.fee_yr ?? 0, conn_aansluit_month: conn.aansluit_month ?? 0,
    contracted_kw: rn(proj.contracted_kw, 1), tariff_band: proj.band,
    network_cost_eur_yr: r0(ec.networkCost(proj)), base_network_cost_eur_yr: r0(bstats.network),
    base_connection_id: bstats.conn, base_connection_kw: bstats.conn_kw,
    public_kwh: r0(publicKwh), public_cost_eur_yr: r0(proj.public_charging_eur),
    onsite_price_eur_kwh: rn((proj.commodity_eur + proj.energy_tax_eur + proj.transport_kwh_eur) / Math.max(sim.grid_import_kwh, 1), 4),
    load_mwh: rn(sim.total_load_kwh / 1000, 1), ev_delivered_mwh: rn(evDelivered / 1000, 1),
    pv_mwh: rn(sim.pv_generation_kwh / 1000, 1), import_mwh: rn(sim.grid_import_kwh / 1000, 1),
    export_mwh: rn(sim.grid_export_kwh / 1000, 1), curtailed_mwh: rn(sim.pv_curtailed_kwh / 1000, 2),
    self_consumption_pct: rn(sim.self_consumption_pct, 1), self_sufficiency_pct: rn(sim.self_sufficiency_pct, 1),
    peak_import_kw: rn(sim.peak_import_kw, 1), sum_monthly_peak_kw: rn(npsum(sim.monthly_peak_kw), 1),
    peak_reduction_pct: rn(100 * (1 - sim.peak_import_kw / Math.max(bstats.peak, 1e-9)), 1),
    battery_cycles: r0(sim.battery_cycles), battery_throughput_mwh: rn(sim.battery_throughput_kwh / 1000, 1),
    unserved_kwh: rn(sim.unserved_kwh, 1), ev_unserved_kwh: r0(evUnserved), feasible,
    base_import_mwh: rn(bstats.import_kwh / 1000, 2), base_peak_kw: rn(bstats.peak, 1),
    upgrade_avoided_kw: rn(upgradeKw, 1), upgrade_avoided_eur: r0(upgradeEur),
    capex_eur: r0(ec.capexTotal(pcx)), capex_pv_eur: r0(cx.pv_eur), capex_batt_eur: r0(cx.battery_eur),
    capex_charger_eur: r0(cx.charger_eur), capex_charger_incremental_eur: r0(chgInc), capex_ems_eur: r0(cx.ems_eur),
    eia_benefit_eur: r0(eia), opex_eur_yr: r0(opex),
    baseline_cost_eur_yr: r0(ec.totalCost(base)), project_cost_eur_yr: r0(ec.totalCost(proj)),
    annual_saving_eur: r0(ec.totalCost(base) - ec.totalCost(proj)),
    export_revenue_eur_yr: r0(proj.export_revenue_eur), energy_tax_eur_yr: r0(proj.energy_tax_eur),
    npv_eur: r0(npv), irr_pct: Number.isFinite(irr) ? rn(irr, 1) : null,
    payback_yr: Number.isFinite(pb) ? rn(pb, 1) : null, ev_shifted_mwh: rn(shifted / 1000, 1),
    // cost breakdown (EUR/yr) for the charts
    b_energy: r0(base.commodity_eur + base.energy_tax_eur), b_network: r0(ec.networkCost(base)),
    b_public: r0(base.public_charging_eur), b_opex: r0(base.opex_eur), b_export: r0(base.export_revenue_eur),
    p_energy: r0(proj.commodity_eur + proj.energy_tax_eur), p_network: r0(ec.networkCost(proj)),
    p_public: r0(proj.public_charging_eur), p_opex: r0(proj.opex_eur), p_export: r0(proj.export_revenue_eur),
  };
  void max;
  return detail ? { row, sim, baseSim, cf } : { row };
}
