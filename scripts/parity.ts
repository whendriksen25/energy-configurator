// Parity test: browser engine vs the Python reference (CLAUDE.md rule 4).
// Cases come from energy/src/parity_cases.py. Run: npm run parity
import * as fs from "fs";
import * as path from "path";
import { prepare, runDesigns, pack, Inputs } from "../lib/engine/configurator";

const file = path.join(__dirname, "parity_cases.json");
const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/\bNaN\b/g, "null"));
const ENERGY = ["import_mwh", "export_mwh", "pv_mwh", "load_mwh", "ev_delivered_mwh"];
let worstNpv = 0, worstEnergy = 0, optionMismatch = 0, fails = 0;

for (const [i, c] of data.cases.entries()) {
  const prep = prepare(c.inputs as Inputs);
  const o = prep.options, po = c.options;
  const same = JSON.stringify([o.pv, o.battery, o.chargers, o.connections]) ===
    JSON.stringify([po.pv, po.battery, po.chargers, po.connections]);
  if (!same) { optionMismatch++; console.log(`case ${i}: options differ`, o, po); }
  const [row] = runDesigns(prep, [c.design]);
  const dNpv = Math.abs(Number(row.npv_eur) - c.row.npv_eur);
  let dE = 0;
  for (const k of ENERGY) {
    const a = Number(row[k]), b = c.row[k];
    // values are rounded to 0.1 MWh; a difference of one rounding step on a
    // value that sits exactly on a .x5 boundary is a display artefact, not a model difference
    if (Math.abs(a - b) > 0.1 + 1e-9 && Math.abs(b) > 0.5) dE = Math.max(dE, Math.abs(a - b) / Math.abs(b));
  }
  worstNpv = Math.max(worstNpv, dNpv);
  worstEnergy = Math.max(worstEnergy, dE);
  const ok = dNpv <= 100 && dE <= 0.005 && row.feasible === c.row.feasible;
  if (!ok) fails++;
  console.log(`${String(i).padStart(2)} ${c.inputs.site_type.padEnd(9)} ${c.design.conn.padEnd(7)} NPV js ${row.npv_eur} py ${c.row.npv_eur} diff ${dNpv.toFixed(0)}  energy ${(dE * 100).toFixed(3)}%  ${ok ? "OK" : "FAIL"}`);
}

for (const f of data.full) {
  const t0 = Date.now();
  const prep = prepare(f.inputs as Inputs);
  const rows = runDesigns(prep, prep.designs);
  const ms = Date.now() - t0;
  const pk = pack(rows);
  let maxd = 0;
  rows.forEach((r, i) => { maxd = Math.max(maxd, Math.abs(Number(r.npv_eur) - f.npvs[i])); });
  const b = rows[pk.best_npv_idx];
  console.log(`full ${f.inputs.site_type}: ${rows.length} designs in ${(ms / 1000).toFixed(1)} s (python ${f.seconds} s); ` +
    `max NPV diff ${maxd}; best js ${b.connection_id} ${b.pv_kwp} kWp ${b.battery_kwh} kWh EUR ${b.npv_eur} / py ` +
    `${f.best.connection_id} ${f.best.pv_kwp} kWp ${f.best.battery_kwh} kWh EUR ${f.best.npv_eur}; same pick ${pk.best_npv_idx === f.best_idx}`);
  if (maxd > 100 || pk.best_npv_idx !== f.best_idx) fails++;
}

console.log(`\nworst NPV diff EUR ${worstNpv.toFixed(0)} (limit 100); worst energy diff ${(worstEnergy * 100).toFixed(3)}% (limit 0.5%); ` +
  `option mismatches ${optionMismatch}; failures ${fails}`);
process.exit(fails || optionMismatch ? 1 : 0);
