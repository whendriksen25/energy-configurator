"use client";
import type { Dict } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import type { Row } from "@/lib/engine/model";

const n = (r: Row, k: string) => Number(r[k] ?? 0);

/** What the investment of one design is made of: one bar per part. */
export default function InvestmentSplit({ row, t, eur }: { row: Row; t: Dict; eur: (v: number) => string }) {
  const parts = [
    { key: "solar", v: n(row, "capex_pv_eur") },
    { key: "battery", v: n(row, "capex_batt_eur") },
    { key: "chargers", v: n(row, "capex_charger_incremental_eur") },
    { key: "ems", v: n(row, "capex_ems_eur") },
    { key: "soft", v: n(row, "capex_soft_eur") },
  ] as const;
  const total = n(row, "capex_eur");
  const max = Math.max(1, ...parts.map((p) => p.v));
  return (
    <div>
      <ul className="space-y-2.5">
        {parts.map((p) => (
          <li key={p.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_auto]">
            <span className="truncate text-ink2">{t.res.splitParts[p.key]}</span>
            <span className="h-3 rounded-r" style={{ width: `${(100 * p.v) / max}%`, minWidth: p.v > 0 ? 3 : 0, background: "var(--s1)" }} aria-hidden="true" />
            <span className="num text-right font-medium">{eur(p.v)}</span>
          </li>
        ))}
        <li className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 border-t border-line pt-2.5 text-sm font-semibold sm:grid-cols-[12rem_1fr_auto]">
          <span>{t.res.splitTotal}</span><span /><span className="num text-right">{eur(total)}</span>
        </li>
      </ul>
      {n(row, "capex_charger_ref_eur") > 0 && (
        <p className="mt-3 text-xs text-muted">{fmt(t.res.splitNote, { eur: eur(n(row, "capex_charger_ref_eur")) })}</p>
      )}
    </div>
  );
}
