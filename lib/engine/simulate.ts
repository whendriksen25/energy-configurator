// Hourly dispatch engine. Mirrors src/simulate.py.
// Battery priorities: hard connection limit (building first), daily peak
// ceiling, storing solar, arbitrage.
import { HOURS, MONTH, sum, npsum, max } from "./profiles";

export type SimResult = {
  load_kw: Float64Array; pv_kw: Float64Array; ev_kw: Float64Array;
  batt_charge_kw: Float64Array; batt_discharge_kw: Float64Array; soc_kwh: Float64Array;
  grid_import_kw: Float64Array; grid_export_kw: Float64Array; curtailed_kw: Float64Array;
  unserved_kw: Float64Array; price_eur_kwh: Float64Array; ev_curtailed_kw: Float64Array;
  total_load_kwh: number; pv_generation_kwh: number; pv_self_consumed_kwh: number;
  pv_exported_kwh: number; pv_curtailed_kwh: number; grid_import_kwh: number; grid_export_kwh: number;
  battery_throughput_kwh: number; battery_cycles: number; peak_import_kw: number; peak_export_kw: number;
  monthly_peak_kw: number[]; self_consumption_pct: number; self_sufficiency_pct: number;
  unserved_kwh: number; ev_curtailed_kwh: number;
};

/** numpy.percentile (linear) of 24 values */
function pct(sorted: number[], q: number) {
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const t = pos - lo, a = sorted[lo], b = sorted[hi], diff = b - a;
  return t >= 0.5 ? b - diff * (1 - t) : a + diff * t; // numpy's _lerp
}

function dailyThresholds(price: Float64Array, loPct = 25, hiPct = 72) {
  const lo = new Float64Array(HOURS), hi = new Float64Array(HOURS);
  for (let d = 0; d < 365; d++) {
    const s = Array.from(price.subarray(d * 24, d * 24 + 24)).sort((a, b) => a - b);
    const l = pct(s, loPct), h = pct(s, hiPct);
    for (let k = 0; k < 24; k++) { lo[d * 24 + k] = l; hi[d * 24 + k] = h; }
  }
  return [lo, hi];
}

/** Per-day grid ceiling the battery can hold and refill that day. */
export function autoPeakTarget(net: Float64Array, usableKwh: number, powerKw: number, safety = 0.8, eff = 0.94): Float64Array {
  const out = new Float64Array(HOURS);
  if (usableKwh <= 0 || powerKw <= 0) {
    let m = 0;
    for (let t = 0; t < HOURS; t++) m = Math.max(m, Math.max(net[t], 0));
    out.fill(m);
    return out;
  }
  const rf = new Float64Array(24), ab = new Float64Array(24);
  for (let d = 0; d < 365; d++) {
    let lo = 0, hi = 0;
    for (let h = 0; h < 24; h++) hi = Math.max(hi, Math.max(net[d * 24 + h], 0));
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2;
      let aboveMax = 0;
      for (let h = 0; h < 24; h++) {
        const v = Math.max(net[d * 24 + h], 0);
        const above = Math.max(v - mid, 0), below = Math.max(mid - v, 0);
        rf[h] = Math.min(below, powerKw);
        ab[h] = above;
        if (above > aboveMax) aboveMax = above;
      }
      const refill = npsum(rf) * eff * eff;
      const need = npsum(ab);
      const ok = need <= usableKwh * safety && need <= refill * safety && aboveMax <= powerKw;
      if (ok) hi = mid; else lo = mid;
    }
    for (let h = 0; h < 24; h++) out[d * 24 + h] = hi;
  }
  return out;
}

/** Shift the flexible part of EV demand within each day; energy conserved. */
export function smartCharge(
  ev: Float64Array, flexFrac: number, pv: Float64Array, base: Float64Array, price: Float64Array,
  pmax: Float64Array, peakCap: number | null, hardCap: Float64Array | null,
): [Float64Array, number] {
  if (flexFrac <= 0 || sum(ev) <= 0) return [ev.slice(), 0];
  const fixed = new Float64Array(HOURS), flex = new Float64Array(HOURS), nw = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) { fixed[t] = ev[t] * (1 - flexFrac); flex[t] = ev[t] * flexFrac; }
  const pmaxMax = max(pmax);
  const wthr = 0.02 * Math.max(pmaxMax, 1e-9);
  const weight = new Float64Array(24);
  for (let d = 0; d < 365; d++) {
    const o = d * 24;
    let pmx = -Infinity, smx = 0;
    for (let h = 0; h < 24; h++) {
      pmx = Math.max(pmx, price[o + h]);
      smx = Math.max(smx, Math.max(pv[o + h] - base[o + h], 0));
    }
    let psmx = 0;
    for (let h = 0; h < 24; h++) psmx = Math.max(psmx, pmx - price[o + h]);
    for (let h = 0; h < 24; h++) {
      const t = o + h;
      const surplus = Math.max(pv[t] - base[t], 0);
      const ps = (pmx - price[t]) / Math.max(psmx, 1e-9);
      const w = (surplus / Math.max(smx, 1e-9)) * 2.0 + ps;
      weight[h] = pmax[t] > wthr ? w + 0.05 : 0.0;
    }
    const wsum = npsum(weight), daily = npsum(flex, o, 24);
    for (let h = 0; h < 24; h++) nw[o + h] = wsum > 0 ? (weight[h] / Math.max(wsum, 1e-9)) * daily : flex[o + h];
  }

  if (pmaxMax > 0) {
    const head = new Float64Array(HOURS);
    const hasCap = (peakCap !== null && peakCap > 0) || hardCap !== null;
    for (let t = 0; t < HOURS; t++) {
      let hr = Math.max(pmax[t] - fixed[t], 0);
      if (hasCap) {
        let cap = Infinity;
        if (peakCap !== null && peakCap > 0) cap = peakCap;
        if (hardCap !== null) cap = Math.min(cap, hardCap[t]);
        hr = Math.min(hr, Math.max(cap - (base[t] - pv[t]) - fixed[t], 0));
      }
      head[t] = hr;
    }
    const room = new Float64Array(24);
    const over = new Float64Array(HOURS);
    for (let it = 0; it < 15; it++) {
      for (let t = 0; t < HOURS; t++) over[t] = Math.max(nw[t] - head[t], 0);
      if (npsum(over) < 1e-6) break;
      for (let d = 0; d < 365; d++) {
        const o = d * 24;
        const spill = npsum(over, o, 24);
        for (let h = 0; h < 24; h++) nw[o + h] = Math.min(nw[o + h], head[o + h]);
        for (let h = 0; h < 24; h++) room[h] = Math.max(head[o + h] - nw[o + h], 0);
        const rsum = npsum(room);
        for (let h = 0; h < 24; h++) {
          nw[o + h] += rsum > 0 ? Math.min((room[h] / Math.max(rsum, 1e-9)) * spill, room[h]) : 0;
        }
      }
    }
    for (let t = 0; t < HOURS; t++) nw[t] = Math.min(nw[t], head[t]);
  }

  for (let d = 0; d < 365; d++) {
    const o = d * 24;
    const tot = npsum(flex, o, 24), ns = npsum(nw, o, 24);
    const deficit = Math.max(tot - ns, 0);
    if (tot > 0) for (let h = 0; h < 24; h++) nw[o + h] += (flex[o + h] / Math.max(tot, 1e-9)) * deficit;
  }
  const out = new Float64Array(HOURS);
  const dev = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) { out[t] = fixed[t] + nw[t]; dev[t] = Math.abs(nw[t] - flex[t]); }
  return [out, npsum(dev) / 2.0];
}

/** Smart charging that bisects on the grid ceiling to keep the peak minimal. */
export function smartChargeMinPeak(
  ev: Float64Array, flexFrac: number, pv: Float64Array, base: Float64Array, price: Float64Array,
  pmax: Float64Array, hardCap: Float64Array | null,
): [Float64Array, number, number] {
  let p0 = -Infinity;
  for (let t = 0; t < HOURS; t++) p0 = Math.max(p0, base[t] + ev[t]);
  const evSum = sum(ev);
  if (evSum <= 0 || flexFrac <= 0 || max(pmax) <= 0) return [ev.slice(), 0, p0];
  let best: [Float64Array, number, number] | null = null;
  let lo = 0, hi = p0;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    const [cand, sh] = smartCharge(ev, flexFrac, pv, base, price, pmax, mid, hardCap);
    let pk = -Infinity;
    for (let t = 0; t < HOURS; t++) pk = Math.max(pk, base[t] - pv[t] + cand[t]);
    const ok = Math.abs(sum(cand) - evSum) < 1e-3 * Math.max(evSum, 1.0) && pk <= mid * 1.001;
    if (ok) { best = [cand, sh, mid]; hi = mid; } else lo = mid;
  }
  if (best === null) {
    const [cand, sh] = smartCharge(ev, flexFrac, pv, base, price, pmax, p0, hardCap);
    return [cand, sh, p0];
  }
  return best;
}

export type SimOpts = {
  battKwh?: number; battKw?: number; rtePct?: number; dodPct?: number; minSocPct?: number;
  importLimit?: Float64Array | null; exportLimit?: Float64Array | null; peakTarget?: Float64Array | null;
  strategy?: string; reservePct?: number; curtailBelow?: number; maxCycles?: number;
  sell?: Float64Array; buy?: Float64Array;
};

export function simulate(base: Float64Array, pv: Float64Array, evIn: Float64Array, price: Float64Array, o: SimOpts = {}): SimResult {
  const n = HOURS;
  const strategy = o.strategy ?? "blended";
  const reservePct = o.reservePct ?? 30.0;
  const curtailBelow = o.curtailBelow ?? 0.0;
  const net = new Float64Array(n), bldNet = new Float64Array(n);
  for (let t = 0; t < n; t++) { net[t] = base[t] + evIn[t] - pv[t]; bldNet[t] = base[t] - pv[t]; }
  const impLim = o.importLimit ?? new Float64Array(n).fill(Infinity);
  const expLim = o.exportLimit ?? new Float64Array(n).fill(Infinity);
  const peakTarget = new Float64Array(n);
  for (let t = 0; t < n; t++) peakTarget[t] = o.peakTarget ? Math.min(impLim[t], o.peakTarget[t]) : impLim[t];
  const buy = o.buy ?? price, sell = o.sell ?? price;

  const cap = o.battKwh ?? 0;
  let pmaxB = o.battKw ?? 0;
  if (cap > 0 && pmaxB <= 0) pmaxB = cap * 0.5;
  const eff = Math.sqrt(Math.max(o.rtePct ?? 88.0, 1.0) / 100.0);
  const minSoc = o.minSocPct ?? 5.0, dod = o.dodPct ?? 90.0;
  const socMin = (cap * minSoc) / 100.0;
  const socMax = cap * Math.min(1.0, (minSoc + dod) / 100.0);
  let soc = socMin + (socMax - socMin) * 0.5;
  const reserve = socMin + ((socMax - socMin) * reservePct) / 100.0;
  const [loThr, hiThr] = cap > 0 ? dailyThresholds(buy) : [buy, buy];

  const doPeak = strategy === "peak_shaving" || strategy === "blended";
  const doSelf = strategy === "self_consumption" || strategy === "blended";
  const doArb = strategy === "arbitrage" || strategy === "blended";

  const ch = new Float64Array(n), dis = new Float64Array(n), socs = new Float64Array(n);
  const imp = new Float64Array(n), exp = new Float64Array(n), curt = new Float64Array(n), uns = new Float64Array(n);
  const budget = cap > 0 ? (o.maxCycles ?? 500.0) * cap * 2 : 0.0;
  let thru = 0.0;
  const dayNeed = new Float64Array(365);
  const hardAfter = new Float64Array(n);
  const dn = new Float64Array(24);
  for (let d = 0; d < 365; d++) {
    for (let h = 0; h < 24; h++) dn[h] = Math.max(net[d * 24 + h] - peakTarget[d * 24 + h], 0);
    dayNeed[d] = npsum(dn);
    let cum = 0; // numpy: cumsum from the end of the day, minus the hour itself
    for (let h = 23; h >= 0; h--) {
      const t = d * 24 + h;
      const hard = Math.max(bldNet[t] - impLim[t], 0);
      cum = h === 23 ? hard : cum + hard;
      hardAfter[t] = cum - hard;
    }
  }
  let remaining = 0.0;

  for (let t = 0; t < n; t++) {
    if (t % 24 === 0) remaining = dayNeed[t / 24];
    let c = 0.0, d = 0.0;
    const nt = net[t];
    if (cap > 0) {
      const room = Math.max(0.0, socMax - soc);
      const avail = Math.max(0.0, soc - socMin);
      const keep = hardAfter[t] / eff;
      const availRes = Math.max(0.0, soc - Math.max(reserve, socMin + keep));
      const ok = thru < budget;
      if (nt < 0) {
        const surplus = -nt;
        if (doSelf && ok) c = Math.min(surplus, pmaxB, room / eff);
        if (doArb && ok && buy[t] <= loThr[t] && buy[t] < hiThr[t] * 0.55) {
          const extra = Math.max(0.0, room - c * eff) / eff;
          const head = Math.max(0.0, peakTarget[t] * 0.85 - (nt + c));
          c += Math.min(pmaxB - c, extra, head);
        }
      } else {
        const hardBld = Math.max(0.0, bldNet[t] - impLim[t]);
        const over = Math.max(0.0, nt - Math.min(peakTarget[t], impLim[t]));
        d = Math.min(hardBld, pmaxB, avail);
        const rest = doPeak ? over - d : Math.max(0.0, nt - impLim[t]) - d;
        if (rest > 0) d += Math.min(rest, pmaxB - d, Math.max(0.0, avail - d - keep));
        const rem = nt - d;
        if (doSelf && rem > 0 && ok) {
          const want = !doArb || buy[t] >= hiThr[t] ? rem : 0.0;
          if (want > 0) d += Math.min(want, pmaxB - d, Math.max(0.0, availRes - d));
        }
        if (doPeak && ok && d === 0 && (remaining > 0 || keep > 0)) {
          const short = Math.max(remaining, hardAfter[t]) / eff - Math.max(0.0, soc - socMin);
          if (short > 0) c = Math.min(pmaxB, room / eff, Math.max(0.0, peakTarget[t] - nt), short);
        }
        if (doArb && ok && d === 0 && c === 0 && buy[t] <= loThr[t]) {
          const head = Math.max(0.0, peakTarget[t] * 0.85 - nt);
          c = Math.min(pmaxB, room / eff, head);
        }
      }
      c = Math.max(0.0, c); d = Math.max(0.0, d);
      remaining = Math.max(0.0, remaining - d);
      soc = Math.min(Math.max(soc + c * eff - d / eff, socMin), socMax);
      thru += c * eff + d / eff;
    }
    ch[t] = c; dis[t] = d; socs[t] = soc;
    const flow = nt + c - d;
    if (flow >= 0) {
      const i = Math.min(flow, impLim[t]);
      uns[t] = flow - i;
      imp[t] = i;
    } else {
      let e = -flow;
      if (sell[t] < curtailBelow) { curt[t] = e; e = 0.0; }
      else if (e > expLim[t]) { curt[t] = e - expLim[t]; e = expLim[t]; }
      exp[t] = e;
    }
  }

  // Dynamic load balancing: charge points are throttled first.
  const evCut = new Float64Array(n), load = new Float64Array(n), ev = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    evCut[t] = Math.min(uns[t], evIn[t]);
    uns[t] -= evCut[t];
    load[t] = base[t] + evIn[t] - evCut[t];
    ev[t] = evIn[t] - evCut[t];
  }
  const monthly = new Array(12).fill(-Infinity);
  for (let t = 0; t < n; t++) monthly[MONTH[t] - 1] = Math.max(monthly[MONTH[t] - 1], imp[t]);
  const r: SimResult = {
    load_kw: load, pv_kw: pv, ev_kw: ev, batt_charge_kw: ch, batt_discharge_kw: dis, soc_kwh: socs,
    grid_import_kw: imp, grid_export_kw: exp, curtailed_kw: curt, unserved_kw: uns, price_eur_kwh: price,
    ev_curtailed_kw: evCut, ev_curtailed_kwh: sum(evCut),
    total_load_kwh: sum(load), pv_generation_kwh: sum(pv), grid_import_kwh: sum(imp), grid_export_kwh: sum(exp),
    pv_curtailed_kwh: sum(curt), pv_exported_kwh: 0, pv_self_consumed_kwh: 0,
    battery_throughput_kwh: sum(dis), battery_cycles: cap > 0 ? sum(ch) / cap : 0,
    peak_import_kw: max(imp), peak_export_kw: max(exp), unserved_kwh: sum(uns), monthly_peak_kw: monthly,
    self_consumption_pct: 0, self_sufficiency_pct: 0,
  };
  r.pv_exported_kwh = r.grid_export_kwh;
  r.pv_self_consumed_kwh = Math.max(0.0, r.pv_generation_kwh - r.pv_exported_kwh - r.pv_curtailed_kwh);
  r.self_consumption_pct = r.pv_generation_kwh ? (100 * r.pv_self_consumed_kwh) / r.pv_generation_kwh : 0;
  r.self_sufficiency_pct = r.total_load_kwh
    ? (100 * (r.total_load_kwh - r.grid_import_kwh - r.unserved_kwh)) / r.total_load_kwh : 0;
  return r;
}
