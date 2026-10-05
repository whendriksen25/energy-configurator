"use client";
import type { Dict } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import type { Row } from "@/lib/engine/model";

const n = (r: Row, k: string) => Number(r[k] ?? 0);
type Kind = "charge" | "solar" | "battery" | "both";

function kindOf(r: Row): Kind {
  const pv = n(r, "pv_kwp") > 0, b = n(r, "battery_kwh") > 0;
  return pv && b ? "both" : pv ? "solar" : b ? "battery" : "charge";
}

/** Best design per package (from the designs already calculated). */
export function bestPerPackage(rows: Row[], feasible: number[]): Record<Kind, number> {
  const best: Record<Kind, number> = { charge: -1, solar: -1, battery: -1, both: -1 };
  for (const i of feasible) {
    const k = kindOf(rows[i]);
    if (best[k] < 0 || n(rows[i], "npv_eur") > n(rows[best[k]], "npv_eur")) best[k] = i;
  }
  return best;
}

export default function Packages({ rows, feasible, sel, onSelect, t, eur, nf, hasEv }: {
  rows: Row[]; feasible: number[]; sel: number; onSelect: (i: number) => void;
  t: Dict; eur: (v: number) => string; nf: Intl.NumberFormat; hasEv: boolean;
}) {
  const best = bestPerPackage(rows, feasible);
  const names = hasEv ? t.res.pk : t.res.pkNoEv;
  const order: Kind[] = ["charge", "solar", "battery", "both"];
  const npvs = order.map((k) => (best[k] >= 0 ? n(rows[best[k]], "npv_eur") : 0));
  const maxAbs = Math.max(1, ...npvs.map(Math.abs));
  const solarAdds = best.solar >= 0 && best.charge >= 0 ? n(rows[best.solar], "npv_eur") - n(rows[best.charge], "npv_eur") : null;
  const battAdds = best.both >= 0 && best.solar >= 0 ? n(rows[best.both], "npv_eur") - n(rows[best.solar], "npv_eur") : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm num">
          <thead>
            <tr className="text-left text-xs text-ink2">
              <th className="py-2 pr-3 font-medium">{t.res.colPackage}</th>
              <th className="py-2 pr-3 font-medium">{t.res.colDesign}</th>
              <th className="py-2 pr-3 text-right font-medium">{t.res.cols.capex}</th>
              <th className="py-2 pr-3 text-right font-medium">{t.res.cols.saving}</th>
              <th className="py-2 pr-3 font-medium" style={{ width: "22%" }}>{t.res.cols.npv}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((k, j) => {
              const i = best[k];
              if (i < 0) {
                return (
                  <tr key={k} className="border-t border-line text-muted">
                    <td className="py-2 pr-3">{names[k]}</td><td className="py-2 pr-3" colSpan={4}>{t.res.notAvailable}</td>
                  </tr>
                );
              }
              const r = rows[i];
              const v = npvs[j];
              const on = i === sel;
              const design = `${r.connection_label} · ${nf.format(n(r, "pv_kwp"))} kWp · ${nf.format(n(r, "battery_kwh"))} kWh · ` +
                `${n(r, "n_ac_chargers")} AC${n(r, "n_dc_chargers") ? ` + ${n(r, "n_dc_chargers")} DC` : ""}`;
              return (
                <tr key={k} onClick={() => onSelect(i)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(i)} aria-selected={on}
                  className={`cursor-pointer border-t border-line hover:bg-raised ${on ? "bg-accent-soft" : ""}`}>
                  <td className="py-2 pr-3 font-medium">{names[k]}</td>
                  <td className="py-2 pr-3 text-ink2">{design}</td>
                  <td className="py-2 pr-3 text-right">{eur(n(r, "capex_eur"))}</td>
                  <td className="py-2 pr-3 text-right">{eur(n(r, "annual_saving_eur"))}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="relative h-3 flex-1" aria-hidden="true">
                        <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--axis)" }} />
                        <span className="absolute inset-y-0 rounded-sm" style={{
                          background: "var(--s1)", width: `${(50 * Math.abs(v)) / maxAbs}%`,
                          left: v >= 0 ? "50%" : `${50 - (50 * Math.abs(v)) / maxAbs}%`,
                        }} />
                      </div>
                      <span className="w-24 text-right font-semibold">{eur(v)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {solarAdds !== null && battAdds !== null && (
        <p className="mt-3 text-sm text-ink2">{fmt(t.res.adds, { solar: eur(solarAdds), batt: eur(battAdds) })}</p>
      )}
    </div>
  );
}
