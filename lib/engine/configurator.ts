// The configurator: visitor inputs -> design options -> evaluated designs -> best picks.
// Mirrors src/configurator_ref.py.
import {
  Params, Overrides, SiteTypeId, SITE_TYPES, CONNECTIONS, PATTERN,
  defaultParams, applyOverrides, applyScenario, sizeOverrides, smallestConnection,
} from "./params";
import { HOURS, buildingLoad, pvProfile, evDemand, priceCurve, evAvailability, sum, max } from "./profiles";
import { evaluate, Ctx, Design, Row, Series } from "./model";
import { buildCapex } from "./economics";

export type Inputs = {
  site_type: SiteTypeId;
  annual_mwh: number;
  roof_m2: number;
  orientation: "east_west" | "south" | "flat";
  ev_annual_kwh: number;
  ac_kw?: number;
  pattern?: string | null;
  connection: string; // id or "auto"
  scenario?: string;
  overrides?: Overrides;
  load_kw?: number[] | Float64Array | null; // 8,760 hourly kW from meter data
};

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function buildParams(inp: Inputs): Params {
  const t = SITE_TYPES[inp.site_type];
  let p = applyOverrides(defaultParams(), t.overrides ?? sizeOverrides(inp.annual_mwh));
  p.site.archetype = t.archetype;
  p.site.annual_load_mwh = Number(inp.annual_mwh);
  p.site.roof_area_m2 = Number(inp.roof_m2);
  p.site.pv_orientation_mix = inp.orientation ?? "east_west";
  p.site.ev_annual_kwh = Number(inp.ev_annual_kwh);
  p.site.ac_socket_kw = Number(inp.ac_kw ?? t.ac_kw);
  p = applyScenario(p, inp.scenario ?? "base");
  p = applyOverrides(p, inp.overrides ?? {});
  return p;
}

function nice(x: number) {
  const step = x < 20 ? 1 : x < 200 ? 5 : x < 2000 ? 10 : 50;
  return Math.max(step, pyRound(x / step) * step);
}

export function pvOptions(p: Params): number[] {
  const mx = p.site.roof_area_m2 / Math.max(p.site.pv_m2_per_kwp, 0.1);
  const s = new Set<number>([0, ...[0.2, 0.4, 0.6, 0.8].map((f) => nice(mx * f)), Math.floor(mx)]);
  return Array.from(s).sort((a, b) => a - b);
}

export function batteryOptions(p: Params): number[] {
  const avg = (p.site.annual_load_mwh * 1000) / 8760;
  const s = new Set<number>([0]);
  for (const m of [1, 2.5, 5, 10, 20]) {
    const v = Math.max(5, avg * m);
    const step = v < 100 ? 5 : v < 1000 ? 10 : 50;
    s.add(pyRound(v / step) * step);
  }
  return Array.from(s).sort((a, b) => a - b);
}

export function chargerOptions(p: Params, pattern: string): [number, number][] {
  const e = p.site.ev_annual_kwh;
  if (e <= 0) return [[0, 0]];
  let n0 = 300;
  for (let n = 1; n <= 300; n++) {
    const { unserved } = evDemand(n, 0, e, p.site.ac_socket_kw, p.site.dc_socket_kw, pattern);
    if (unserved <= 0.02 * e) { n0 = n; break; }
  }
  const opts: [number, number][] = [[n0, 0], [Math.max(n0 + 1, Math.ceil(n0 * 1.5)), 0]];
  if (e >= 50000) opts.push([Math.max(1, Math.ceil(n0 / 2)), 1]);
  return opts;
}

export function connectionOptions(p: Params, load: Float64Array, refEv: Float64Array | null): string[] {
  let raw = 0;
  for (let t = 0; t < HOURS; t++) raw = Math.max(raw, load[t] + (refEv ? refEv[t] : 0));
  const need = smallestConnection(raw * p.grid.qh_peak_factor * (1 + p.grid.contract_headroom_pct / 100));
  const floor = 0.5 * max(load);
  const m = 1 - p.grid.hard_limit_margin_pct / 100;
  const c = CONNECTIONS.filter((x) => x.kw * m >= floor && x.kw <= need.kw).map((x) => x.id);
  return c.length ? c.slice(-8) : [CONNECTIONS[CONNECTIONS.length - 1].id];
}

export type Prepared = {
  p: Params; pattern: string; load: Float64Array; chargers: [number, number][];
  ref: number | null; refEv: Float64Array | null; refSet: [number, number] | null;
  options: { pv: number[]; battery: number[]; chargers: [number, number][]; connections: string[]; pattern: string; ref_set: [number, number] | null };
  designs: Design[];
};

export function prepare(inp: Inputs): Prepared {
  const p = buildParams(inp);
  const pattern = inp.pattern || PATTERN[p.site.archetype] || "office";
  let load: Float64Array;
  if (inp.load_kw && inp.load_kw.length === HOURS) {
    load = Float64Array.from(inp.load_kw);
    p.site.annual_load_mwh = sum(load) / 1000;
  } else {
    load = buildingLoad(p.site.archetype, p.site.annual_load_mwh);
  }
  const chargers = chargerOptions(p, pattern);
  let ref: number | null = null, refEv: Float64Array | null = null, refSet: [number, number] | null = null;
  for (const [nAc, nDc] of chargers) {
    const r = evDemand(nAc, nDc, p.site.ev_annual_kwh, p.site.ac_socket_kw, p.site.dc_socket_kw, pattern);
    if (r.unserved <= 0.02 * Math.max(p.site.ev_annual_kwh, 1)) {
      const cap = buildCapex(p, 0, 0, 0, nAc, nDc).charger_eur;
      if (ref === null || cap < ref) { ref = cap; refEv = r.demand; refSet = [nAc, nDc]; }
    }
  }
  const conns = inp.connection && inp.connection !== "auto" ? [inp.connection] : connectionOptions(p, load, refEv);
  const options = { pv: pvOptions(p), battery: batteryOptions(p), chargers, connections: conns, pattern, ref_set: refSet };
  const designs: Design[] = [];
  for (const c of conns) for (const [nAc, nDc] of chargers) for (const pv of options.pv) for (const b of options.battery) {
    designs.push({ conn: c, pv, batt: b, nAc, nDc });
  }
  return { p, pattern, load, chargers, ref, refEv, refSet, options, designs };
}

export function seriesFor(prep: Prepared, nAc: number, nDc: number): Series {
  const { p, pattern, load } = prep;
  const s = p.site;
  const pv1 = pvProfile(s.specific_yield_kwh_kwp, s.pv_orientation_mix, s.latitude);
  const e = evDemand(nAc, nDc, s.ev_annual_kwh, s.ac_socket_kw, s.dc_socket_kw, pattern);
  const price = priceCurve(p.prices.wholesale_base_eur_mwh, p.prices.price_volatility_factor);
  const avail = evAvailability(pattern);
  const pmaxH = avail.map((a) => a * e.maxPower);
  return { load, pv1, ev: e.demand, pmaxH, flex: e.flex, price, evUnserved: e.unserved };
}

/** Evaluate a list of designs (one worker's share). */
export function runDesigns(prep: Prepared, designs: Design[], onProgress?: (done: number) => void): Row[] {
  const seriesCache = new Map<string, Series>();
  const baseCache = new Map();
  const smartCache = new Map();
  const rows: Row[] = [];
  designs.forEach((d, i) => {
    const k = `${d.nAc},${d.nDc}`;
    let s = seriesCache.get(k);
    if (!s) { s = seriesFor(prep, d.nAc, d.nDc); seriesCache.set(k, s); }
    const ctx: Ctx = {
      p: { ...prep.p, site: { ...prep.p.site, n_ev_ac: d.nAc, n_ev_dc: d.nDc } },
      series: s, chargerCapexRef: prep.ref, baselineEv: prep.refEv,
      baselineSockets: prep.refSet ? prep.refSet[0] + prep.refSet[1] : null, baseCache, smartCache,
    };
    rows.push(evaluate(ctx, d).row);
    if (onProgress && (i % 5 === 4 || i === designs.length - 1)) onProgress(i + 1);
  });
  return rows;
}

/** Full detail (hourly series) for one design, for the charts. */
export function detailFor(prep: Prepared, d: Design) {
  const s = seriesFor(prep, d.nAc, d.nDc);
  const ctx: Ctx = {
    p: { ...prep.p, site: { ...prep.p.site, n_ev_ac: d.nAc, n_ev_dc: d.nDc } },
    series: s, chargerCapexRef: prep.ref, baselineEv: prep.refEv,
    baselineSockets: prep.refSet ? prep.refSet[0] + prep.refSet[1] : null, baseCache: new Map(), smartCache: new Map(),
  };
  return evaluate(ctx, d, true);
}

export type Packed = {
  feasible_idx: number[]; pareto_idx: number[]; best_npv_idx: number; best_selfcons_idx: number;
  best_peak_idx: number; balanced_idx: number; any_feasible: boolean;
};

const num = (r: Row, k: string) => Number(r[k]);

export function pack(rows: Row[]): Packed {
  const feas = rows.map((r, i) => (r.feasible ? i : -1)).filter((i) => i >= 0);
  const pool = feas.length ? feas
    : [rows.map((r, i) => [num(r, "unserved_kwh") + num(r, "ev_unserved_kwh"), i]).sort((a, b) => a[0] - b[0])[0][1]];
  const sub = pool.map((i) => rows[i]);
  const argmax = (v: number[]) => v.reduce((bi, x, i) => (x > v[bi] ? i : bi), 0);
  const argmin = (v: number[]) => v.reduce((bi, x, i) => (x < v[bi] ? i : bi), 0);
  const norm = (k: string, mx: boolean) => {
    const v = sub.map((r) => num(r, k));
    const lo = Math.min(...v), hi = Math.max(...v);
    return v.map((x) => (hi - lo > 0 ? (mx ? (x - lo) / (hi - lo) : 1 - (x - lo) / (hi - lo)) : mx ? 0 : 1));
  };
  const a = norm("npv_eur", true), b = norm("self_consumption_pct", true), c = norm("peak_import_kw", false);
  const score = a.map((x, i) => 0.5 * x + 0.25 * b[i] + 0.25 * c[i]);
  const keys = ["npv_eur", "self_consumption_pct", "peak_import_kw"];
  const vals = sub.map((r) => [num(r, keys[0]), num(r, keys[1]), -num(r, keys[2])]);
  const pareto = vals.map((v, i) => (vals.some((w) => w.every((x, j) => x >= v[j]) && w.some((x, j) => x > v[j])) ? -1 : i))
    .filter((i) => i >= 0).map((j) => pool[j]);
  return {
    feasible_idx: feas,
    pareto_idx: pareto,
    best_npv_idx: pool[argmax(sub.map((r) => num(r, "npv_eur")))],
    best_selfcons_idx: pool[argmax(sub.map((r) => num(r, "self_consumption_pct") * (num(r, "pv_kwp") > 0 ? 1 : 0)))],
    best_peak_idx: pool[argmin(sub.map((r) => num(r, "peak_import_kw")))],
    balanced_idx: pool[argmax(score)],
    any_feasible: feas.length > 0,
  };
}
