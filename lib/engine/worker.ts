// Background worker: runs a share of the designs so the page stays responsive.
import { prepare, runDesigns, detailFor, Inputs } from "./configurator";
import type { Design } from "./model";
import { HOURS, MONTH } from "./profiles";

type Msg =
  | { kind: "prepare"; id: number; inputs: Inputs }
  | { kind: "run"; id: number; inputs: Inputs; designs: Design[] }
  | { kind: "detail"; id: number; inputs: Inputs; design: Design };

const ctx = self as unknown as Worker;

/** Average day (24 h) per month, for the profile chart. */
function monthlyDays(a: Float64Array): number[][] {
  const out = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const cnt = new Array(12).fill(0);
  for (let t = 0; t < HOURS; t++) {
    const m = MONTH[t] - 1;
    out[m][t % 24] += a[t];
    if (t % 24 === 0) cnt[m]++;
  }
  return out.map((row, m) => row.map((v) => v / cnt[m]));
}

ctx.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.kind === "prepare") {
      const p = prepare(m.inputs);
      ctx.postMessage({ kind: "prepared", id: m.id, options: p.options, designs: p.designs, household: p.p.site.household });
    } else if (m.kind === "run") {
      const p = prepare(m.inputs);
      const rows = runDesigns(p, m.designs, (done) => ctx.postMessage({ kind: "progress", id: m.id, done }));
      ctx.postMessage({ kind: "rows", id: m.id, rows });
    } else if (m.kind === "detail") {
      const p = prepare(m.inputs);
      const r = detailFor(p, m.design);
      const s = r.sim!, b = r.baseSim!;
      const net = new Float64Array(HOURS);
      for (let t = 0; t < HOURS; t++) net[t] = s.batt_discharge_kw[t] - s.batt_charge_kw[t];
      ctx.postMessage({
        kind: "detail", id: m.id, row: r.row, cf: r.cf,
        days: {
          building: monthlyDays(p.load), ev: monthlyDays(s.ev_kw), solar: monthlyDays(s.pv_kw),
          import: monthlyDays(s.grid_import_kw), export: monthlyDays(s.grid_export_kw),
          battery: monthlyDays(net), baseImport: monthlyDays(b.grid_import_kw),
        },
        monthlyPeak: s.monthly_peak_kw, baseMonthlyPeak: b.monthly_peak_kw,
      });
    }
  } catch (err) {
    ctx.postMessage({ kind: "error", id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};
