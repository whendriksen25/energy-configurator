// Hourly (8,760) series: building load, solar, EV demand, prices.
// Mirrors src/profiles.py; random draws come from the numpy-compatible Rng.
import { Rng } from "./rng";

export const HOURS = 8760;
export const SEED = 42;

export const DOY = new Int32Array(HOURS);
export const HOD = new Int32Array(HOURS);
export const IS_WEEKEND = new Uint8Array(HOURS);
export const MONTH = new Int32Array(HOURS);
(function calendar() {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let h = 0;
  days.forEach((d, m) => {
    for (let i = 0; i < d * 24; i++) MONTH[h++] = m + 1;
  });
  for (let t = 0; t < HOURS; t++) {
    DOY[t] = Math.floor(t / 24);
    HOD[t] = t % 24;
    IS_WEEKEND[t] = (DOY[t] + 3) % 7 >= 5 ? 1 : 0; // 1 Jan 2026 is a Thursday
  }
})();

export const ARCHETYPES: Record<string, { weekday: number[]; weekend_factor: number; summer_factor: number; winter_factor: number; baseload_frac: number }> = {
  office: { weekday: [.22, .20, .20, .20, .21, .25, .38, .62, .88, .97, 1.0, .99, .95, .97, 1.0, .98, .90, .72, .52, .38, .30, .26, .24, .23], weekend_factor: 0.28, summer_factor: 1.10, winter_factor: 1.06, baseload_frac: 0.20 },
  warehouse: { weekday: [.30, .28, .28, .30, .45, .72, .92, .98, 1.0, 1.0, .99, .97, .95, .98, 1.0, 1.0, .97, .92, .85, .72, .55, .42, .34, .31], weekend_factor: 0.42, summer_factor: 1.04, winter_factor: 1.12, baseload_frac: 0.28 },
  industry: { weekday: [.62, .60, .60, .61, .66, .80, .93, .99, 1.0, 1.0, 1.0, .98, .96, .99, 1.0, 1.0, .99, .94, .86, .78, .72, .68, .65, .63], weekend_factor: 0.62, summer_factor: 1.02, winter_factor: 1.05, baseload_frac: 0.55 },
  residential: { weekday: [.35, .32, .30, .30, .32, .40, .62, .75, .60, .48, .45, .46, .48, .46, .46, .50, .62, .85, 1.0, .95, .85, .72, .55, .42], weekend_factor: 1.10, summer_factor: 0.70, winter_factor: 1.70, baseload_frac: 0.30 },
  retail: { weekday: [.55, .52, .51, .51, .55, .66, .80, .90, .95, .97, .98, 1.0, 1.0, .99, .98, .99, 1.0, .98, .92, .80, .68, .60, .57, .56], weekend_factor: 0.88, summer_factor: 1.18, winter_factor: 1.00, baseload_frac: 0.48 },
};

// Random series are fixed for the seed; draw once and keep.
let _noise: {
  load: Float64Array; pvDaily: Float64Array; pvHourly: Float64Array; ev: Float64Array;
  sunny: Float64Array; walk: Float64Array; priceNoise: Float64Array;
} | null = null;
function noise() {
  if (_noise) return _noise;
  const r1 = new Rng(SEED);
  const load = r1.normal(0, 0.06, HOURS);
  const r2 = new Rng(SEED + 7);
  const pvDaily = r2.beta(2.4, 2.0, 365);
  const pvHourly = r2.beta(5, 2, HOURS);
  const r3 = new Rng(SEED + 13);
  const ev = r3.normal(0, 0.22, HOURS);
  const r4 = new Rng(SEED + 21);
  const sunny = r4.beta(2.2, 2.0, 365);
  const walk = r4.normal(0, 3.0, 365);
  const priceNoise = r4.normal(0, 13.0, HOURS);
  _noise = { load, pvDaily, pvHourly, ev, sunny, walk, priceNoise };
  return _noise;
}

/** numpy's pairwise summation, so totals match the Python model to the last bit. */
export function npsum(a: ArrayLike<number>, off = 0, n = a.length - off): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[off + i];
    return res;
  }
  if (n <= 128) {
    let r0 = a[off], r1 = a[off + 1], r2 = a[off + 2], r3 = a[off + 3];
    let r4 = a[off + 4], r5 = a[off + 5], r6 = a[off + 6], r7 = a[off + 7];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      const o = off + i;
      r0 += a[o]; r1 += a[o + 1]; r2 += a[o + 2]; r3 += a[o + 3];
      r4 += a[o + 4]; r5 += a[o + 5]; r6 += a[o + 6]; r7 += a[o + 7];
    }
    let res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (; i < n; i++) res += a[off + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return npsum(a, off, n2) + npsum(a, off + n2, n - n2);
}
export const sum = (a: ArrayLike<number>) => npsum(a);
export function max(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}

function seasonal(t: number, summerF: number, winterF: number) {
  const phase = (2 * Math.PI * (DOY[t] - 172)) / 365.0;
  const summer = (Math.cos(phase) + 1) / 2;
  return summer * summerF + (1 - summer) * winterF;
}

const HOLIDAYS = new Set([0, 92, 93, 116, 124, 134, 135, 358, 359]);

export function buildingLoad(archetype: string, annualMwh: number): Float64Array {
  const a = ARCHETYPES[archetype];
  const z = noise().load;
  const bf = a.baseload_frac, wf = a.weekend_factor;
  const out = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) {
    let s = a.weekday[HOD[t]];
    if (IS_WEEKEND[t]) s = bf + (s - bf) * wf;
    s = s * seasonal(t, a.summer_factor, a.winter_factor);
    if (HOLIDAYS.has(DOY[t])) s = bf + (s - bf) * wf;
    out[t] = Math.max(s * (1 + z[t]), 0.02);
  }
  const tot = sum(out), e = annualMwh * 1000.0;
  for (let t = 0; t < HOURS; t++) out[t] = (out[t] * e) / tot;
  return out;
}

const MONTHLY_KT = [0.34, 0.39, 0.44, 0.51, 0.53, 0.52, 0.51, 0.51, 0.47, 0.40, 0.33, 0.30];

/** kWh per kWp per hour; sums to specificYield before the inverter cap (kW per kWp), above which output is lost. */
export function pvProfile(specificYield = 950.0, orientation = "east_west", latitude = 52.1, inverterCap = 0): Float64Array {
  const { pvDaily, pvHourly } = noise();
  const rad = Math.PI / 180;
  const lat = latitude * rad;
  let expo = 0.66, peakGain = 1.0, shoulder = 1.0;
  if (orientation === "south") { expo = 0.78; peakGain = 1.12; shoulder = 0.92; }
  else if (orientation === "east_west") { expo = 0.55; peakGain = 0.86; shoulder = 1.18; }
  const out = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) {
    const decl = 23.45 * rad * Math.sin((2 * Math.PI * (284 + DOY[t])) / 365.0);
    const ha = 15.0 * (HOD[t] + 0.5 - 12) * rad;
    const cz = Math.max(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha), 0);
    const plane = Math.pow(cz, expo);
    const dev = Math.abs(HOD[t] + 0.5 - 12.7);
    const raw = plane * peakGain * Math.exp(-((dev / (4.6 * shoulder)) ** 2));
    const kt = MONTHLY_KT[MONTH[t] - 1];
    const clear = Math.min(Math.max(kt * (0.45 + 1.35 * pvDaily[DOY[t]]) * (0.6 + 0.7 * pvHourly[t]), 0.03), 1.0);
    out[t] = cz <= 0 ? 0.0 : raw * clear;
  }
  const tot = sum(out);
  for (let t = 0; t < HOURS; t++) {
    out[t] = (out[t] * specificYield) / tot;
    if (inverterCap > 0) out[t] = Math.min(out[t], inverterCap);
  }
  return out;
}

export const EV_PATTERNS: Record<string, number[]> = {
  office: [.02, .01, .01, .01, .01, .03, .10, .30, .62, .78, .70, .55, .42, .40, .38, .34, .28, .18, .10, .06, .05, .04, .03, .02],
  public: [.18, .12, .09, .08, .10, .18, .36, .55, .62, .55, .50, .52, .58, .56, .52, .58, .72, .90, 1.0, .92, .76, .58, .40, .26],
  depot: [.88, .92, .96, 1.0, .92, .66, .32, .14, .08, .06, .06, .08, .12, .12, .10, .10, .16, .30, .50, .68, .78, .84, .88, .90],
  residential: [.30, .26, .22, .20, .20, .22, .26, .22, .14, .10, .09, .09, .10, .11, .12, .18, .34, .60, .82, .94, 1.0, .86, .62, .42],
};

export const EV_AVAILABILITY: Record<string, number[]> = {
  office: [0, 0, 0, 0, 0, 0, .05, .30, .65, .85, .92, .92, .88, .90, .90, .85, .70, .45, .20, .08, .03, 0, 0, 0],
  public: [.15, .10, .08, .08, .08, .12, .25, .40, .50, .50, .50, .50, .55, .55, .50, .55, .65, .80, .85, .80, .65, .50, .35, .22],
  depot: [.95, .95, .95, .95, .90, .70, .35, .12, .05, .05, .05, .05, .08, .08, .08, .10, .20, .40, .65, .80, .88, .92, .95, .95],
  residential: [.85, .85, .85, .85, .85, .80, .60, .35, .20, .18, .18, .18, .18, .18, .20, .25, .35, .55, .70, .78, .82, .84, .85, .85],
};

const weekendScale = (pattern: string) => (pattern === "office" || pattern === "depot" ? 0.22 : 0.95);

export function evAvailability(pattern = "office"): Float64Array {
  const a = EV_AVAILABILITY[pattern] ?? EV_AVAILABILITY.office;
  const ws = weekendScale(pattern);
  const out = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) out[t] = IS_WEEKEND[t] ? a[HOD[t]] * ws : a[HOD[t]];
  return out;
}

export type EvDemand = { demand: Float64Array; maxPower: number; flex: number; unserved: number };

export function evDemand(
  nAc: number, nDc: number, annualKwh: number, acKw = 22.0, dcKw = 60.0, pattern = "office",
  opts: { sessionKwhAc?: number; sessionKwhDc?: number; sessionsAc?: number; sessionsDc?: number; operatingDays?: number } = {},
): EvDemand {
  let sessionKwhAc = opts.sessionKwhAc ?? 25.0;
  const sessionKwhDc = opts.sessionKwhDc ?? 35.0;
  let sessionsAc = opts.sessionsAc ?? 1.4;
  const sessionsDc = opts.sessionsDc ?? 6.0;
  let operatingDays = opts.operatingDays ?? 250;

  const pat = EV_PATTERNS[pattern] ?? EV_PATTERNS.office;
  const ws = weekendScale(pattern);
  const z = noise().ev;
  const shape = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) {
    let s = pat[HOD[t]];
    if (IS_WEEKEND[t]) s *= ws;
    s = s * (1 + 0.12 * Math.cos((2 * Math.PI * (DOY[t] - 15)) / 365.0));
    shape[t] = Math.max(s * (1 + z[t]), 0);
  }
  const n = nAc + nDc;
  if (annualKwh <= 0 || n === 0) {
    return { demand: new Float64Array(HOURS), maxPower: 0, flex: 0, unserved: n === 0 ? annualKwh : 0 };
  }
  const shapeSum = sum(shape);
  const simult = n > 6 ? 0.55 : n > 3 ? 0.7 : 0.9;
  const maxPower = (nAc * acKw + nDc * dcKw) * simult;

  const d = new Float64Array(HOURS);
  const dd = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) { dd[t] = (shape[t] * annualKwh) / shapeSum; d[t] = Math.min(dd[t], maxPower); }
  const spill = new Float64Array(365);
  const presence = new Uint8Array(HOURS);
  const tmp = new Float64Array(24);
  for (let day = 0; day < 365; day++) {
    let m = -Infinity;
    for (let h = 0; h < 24; h++) { const t = day * 24 + h; tmp[h] = dd[t] - d[t]; if (dd[t] > m) m = dd[t]; }
    spill[day] = npsum(tmp);
    for (let h = 0; h < 24; h++) { const t = day * 24 + h; presence[t] = dd[t] > m * 0.05 ? 1 : 0; }
  }
  const room = new Float64Array(24), addv = new Float64Array(24);
  for (let it = 0; it < 8; it++) {
    if (sum(spill) < 1e-6) break;
    for (let day = 0; day < 365; day++) {
      for (let h = 0; h < 24; h++) {
        const t = day * 24 + h;
        room[h] = presence[t] ? Math.max(maxPower - d[t], 0) : 0;
      }
      const rsum = npsum(room);
      for (let h = 0; h < 24; h++) {
        const t = day * 24 + h;
        addv[h] = rsum > 0 ? Math.min((room[h] / Math.max(rsum, 1e-9)) * spill[day], room[h]) : 0;
        d[t] += addv[h];
      }
      spill[day] -= npsum(addv);
    }
  }
  let unserved = sum(spill);
  let demand = d;

  if (pattern === "public" || pattern === "depot") operatingDays = 350;
  if (pattern === "residential") { operatingDays = 365; sessionKwhAc = 12.0; sessionsAc = 1.5; }
  const sessKwh = (nAc * sessionKwhAc + nDc * sessionKwhDc) / n;
  const needed = annualKwh / sessKwh / operatingDays;
  const possible = nAc * sessionsAc + nDc * sessionsDc;
  if (possible < needed) {
    const frac = possible / needed;
    unserved += sum(demand) * (1 - frac);
    demand = demand.map((v) => v * frac);
  }
  const acShare = (nAc * acKw) / Math.max(nAc * acKw + nDc * dcKw, 1e-9);
  return { demand, maxPower, flex: acShare * 0.85, unserved };
}

const INTRADAY = [-8, -14, -17, -18, -16, -8, 6, 20, 12, -6, -20, -28, -32, -30, -24, -10, 12, 34, 46, 40, 26, 12, 2, -6];

/** Synthetic NL day-ahead price, EUR/kWh, with solar-driven negative hours. */
export function priceCurve(baseEurMwh = 87.0, volatility = 1.0): Float64Array {
  const { sunny, walk, priceNoise } = noise();
  const cum = new Float64Array(365);
  let c = 0;
  for (let i = 0; i < 365; i++) { c += walk[i]; cum[i] = c; }
  const wfull = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) wfull[t] = cum[DOY[t]];
  const wmean = npsum(wfull) / HOURS;
  const p = new Float64Array(HOURS);
  for (let t = 0; t < HOURS; t++) {
    const doy = DOY[t], hod = HOD[t];
    const midday = hod >= 9 && hod < 17;
    const solarSeason = 0.55 + (0.9 * (Math.cos((2 * Math.PI * (doy - 172)) / 365.0) + 1)) / 2;
    const intraday = midday ? INTRADAY[hod] * solarSeason : INTRADAY[hod];
    const springSummer = Math.exp(-(((doy - 150) / 95.0) ** 2));
    let collapse = -75.0 * (midday ? 1 : 0) * springSummer * Math.max(sunny[doy] - 0.3, 0) * 3.0;
    collapse *= IS_WEEKEND[t] ? 1.45 : 1.0;
    const seas = 16.0 * Math.cos((2 * Math.PI * doy) / 365.0);
    const wk = IS_WEEKEND[t] ? -11.0 : 1.5;
    const w = cum[doy] - wmean;
    const v = baseEurMwh + (intraday + collapse + seas + wk + w * 0.9 + priceNoise[t]) * volatility;
    p[t] = Math.min(Math.max(v, -100.0), 500.0);
  }
  const shift = sum(p) / HOURS - baseEurMwh;
  for (let t = 0; t < HOURS; t++) p[t] = (p[t] - shift) / 1000.0;
  return p;
}
