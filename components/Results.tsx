"use client";
import { useEffect, useMemo, useState } from "react";
import type { Dict, Locale } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import type { Inputs } from "@/lib/engine/configurator";
import type { Row } from "@/lib/engine/model";
import { CONN } from "@/lib/engine/params";
import { detail as fetchDetail, Detail, RunResult } from "@/lib/runner";
import ConnectionsChart, { ConnItem } from "./charts/ConnectionsChart";
import CostChart from "./charts/CostChart";
import ProfileChart from "./charts/ProfileChart";

const n = (r: Row, k: string) => Number(r[k]);

export default function Results({ run, inputs, locale, t }: { run: RunResult; inputs: Inputs; locale: Locale; t: Dict }) {
  const loc = locale === "nl" ? "nl-NL" : "en-GB";
  const eurF = useMemo(() => new Intl.NumberFormat(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }), [loc]);
  const nf = useMemo(() => new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }), [loc]);
  const nf1 = useMemo(() => new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }), [loc]);
  const eur = (v: number) => eurF.format(v);
  const { rows, packed } = run;

  const [sel, setSel] = useState(packed.best_npv_idx);
  const [det, setDet] = useState<Detail | null>(null);
  const [month, setMonth] = useState(5);
  const [table, setTable] = useState(false);
  const r = rows[sel];

  useEffect(() => {
    let alive = true;
    setDet(null);
    const d = run.designs[sel];
    fetchDetail(inputs, d).then((x) => alive && setDet(x)).catch(() => alive && setDet(null));
    return () => { alive = false; };
  }, [sel, inputs, run.designs]);

  const connItems: ConnItem[] = run.options.connections.map((c) => {
    let best = -1;
    rows.forEach((x, i) => {
      if (x.connection_id === c && x.feasible && (best < 0 || n(x, "npv_eur") > n(rows[best], "npv_eur"))) best = i;
    });
    return { id: c, label: CONN[c].label, npv: best >= 0 ? n(rows[best], "npv_eur") : null, summary: best >= 0 ? short(rows[best]) : "", idx: best } as ConnItem & { idx: number };
  });

  function chargers(x: Row) {
    const ac = n(x, "n_ac_chargers"), dc = n(x, "n_dc_chargers");
    if (ac + dc === 0) return "";
    return dc ? fmt(t.res.chargersDc, { ac, dc }) : fmt(t.res.chargers, { ac });
  }
  function short(x: Row) {
    const b = n(x, "battery_kwh");
    return `${nf.format(n(x, "pv_kwp"))} kWp · ${b ? `${nf.format(b)} kWh` : t.res.noBattery} · ${chargers(x) || "–"}`;
  }

  const top = useMemo(() => packed.feasible_idx.slice().sort((a, b) => n(rows[b], "npv_eur") - n(rows[a], "npv_eur")).slice(0, 15), [packed, rows]);

  const payback = r.payback_yr === null ? t.res.never : fmt(t.res.years, { n: nf1.format(n(r, "payback_yr")) });
  const tiles = [
    { label: t.res.npv, value: eur(n(r, "npv_eur")), strong: true },
    { label: t.res.capex, value: eur(n(r, "capex_eur")) },
    { label: t.res.saving, value: eur(n(r, "annual_saving_eur")) },
    { label: t.res.payback, value: payback },
    { label: t.res.selfcons, value: n(r, "pv_kwp") > 0 ? `${nf.format(n(r, "self_consumption_pct"))}%` : "–" },
    { label: t.res.peak, value: `${nf.format(n(r, "peak_import_kw"))} kW`, sub: `${t.res.baseline}: ${nf.format(n(r, "base_peak_kw"))} kW` },
  ];
  const batt = n(r, "battery_kwh") ? fmt(t.res.batteryKwh, { n: nf.format(n(r, "battery_kwh")) }) : t.res.noBattery;
  const sentence = fmt(t.res.recommend, { pv: nf.format(n(r, "pv_kwp")), batt, chargers: chargers(r) || t.res.noChargers, conn: String(r.connection_label) });

  const lines = det ? [
    { key: "building", label: t.res.series.building, color: "var(--s1)", values: det.days.building[month] },
    { key: "ev", label: t.res.series.ev, color: "var(--s2)", values: det.days.ev[month] },
    { key: "import", label: t.res.series.import, color: "var(--s3)", values: det.days.import[month] },
    { key: "solar", label: t.res.series.solar, color: "var(--s4)", values: det.days.solar[month] },
    { key: "baseImport", label: t.res.series.baseImport, color: "var(--s-ref)", values: det.days.baseImport[month], dashed: true },
  ].filter((l) => l.key !== "ev" || l.values.some((v) => v > 0)).filter((l) => l.key !== "solar" || l.values.some((v) => v > 0)) : [];

  return (
    <section className="mt-10" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold">{t.res.title}</h2>
        <p className="text-sm text-muted">{fmt(t.res.designs, { n: nf.format(rows.length), s: nf1.format(run.seconds) })}</p>
      </div>

      {!packed.any_feasible && <p role="alert" className="card mt-4 border-bad p-4 text-bad">{t.res.noFeasible}</p>}

      <div className="card mt-4 p-4 sm:p-5">
        <p className="text-lg font-medium">{sentence}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {tiles.map((x) => (
            <div key={x.label} className="rounded-xl border border-line bg-raised p-3">
              <div className="text-xs text-ink2">{x.label}</div>
              <div className={`mt-1 ${x.strong ? "text-2xl font-bold" : "text-xl font-semibold"}`}>{x.value}</div>
              {x.sub && <div className="mt-0.5 text-xs text-muted">{x.sub}</div>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t.res.npvHint}</p>
        {n(r, "public_kwh") > 0 && (
          <p className="mt-2 text-sm text-ink2">{fmt(t.res.public, { kwh: nf.format(n(r, "public_kwh")), eur: eur(n(r, "public_cost_eur_yr")) })}</p>
        )}
        {n(r, "upgrade_avoided_kw") > 0 && (
          <p className="mt-2 text-sm text-ink2">{fmt(t.res.upgrade, { base: CONN[String(r.base_connection_id)]?.label ?? String(r.base_connection_id), kw: nf.format(n(r, "upgrade_avoided_kw")) })}</p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {connItems.length > 1 && (
          <div className="card p-4 sm:p-5 lg:col-span-2">
            <h3 className="font-semibold">{t.res.compare}</h3>
            <p className="mb-3 text-sm text-ink2">{t.res.compareHint}</p>
            <ConnectionsChart items={connItems} selected={String(r.connection_id)} eur={eur} notPossible={t.res.notPossible} title={t.res.compare}
              onSelect={(id) => { const it = connItems.find((c) => c.id === id) as (ConnItem & { idx: number }) | undefined; if (it && it.idx >= 0) setSel(it.idx); }} />
          </div>
        )}

        <div className="card p-4 sm:p-5">
          <h3 className="mb-3 font-semibold">{t.res.costs}</h3>
          <CostChart title={t.res.costs} eur={eur} exportLabel={t.res.costParts.export}
            partLabels={[t.res.costParts.energy, t.res.costParts.network, t.res.costParts.public, t.res.costParts.opex]}
            bars={[
              { label: t.res.baseline, parts: [n(r, "b_energy"), n(r, "b_network"), n(r, "b_public"), n(r, "b_opex")], export: n(r, "b_export") },
              { label: t.res.design, parts: [n(r, "p_energy"), n(r, "p_network"), n(r, "p_public"), n(r, "p_opex")], export: n(r, "p_export") },
            ]} />
        </div>

        <div className="card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t.res.profile}</h3>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="month">{t.res.month}</label>
              <select id="month" className="input w-auto py-1.5 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {t.res.months.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <button type="button" className="btn btn-ghost whitespace-nowrap py-1.5 text-sm" onClick={() => setTable(!table)}>{table ? t.res.hideTable : t.res.showTable}</button>
            </div>
          </div>
          {det ? (
            <ProfileChart lines={lines} title={t.res.profile} hourLabel={t.res.hour} showTable={table} tableLabels={{ hour: t.res.hour }}
              kw={(v) => `${nf1.format(v)} kW`} />
          ) : (
            <div className="h-[290px] animate-pulse rounded-lg bg-raised" />
          )}
        </div>

        <div className="card p-4 sm:p-5 lg:col-span-2">
          <h3 className="font-semibold">{t.res.table}</h3>
          <p className="mb-3 text-sm text-ink2">{t.res.tableHint}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm num">
              <thead>
                <tr className="text-left text-xs text-ink2">
                  <th className="py-2 pr-3 font-medium">{t.res.cols.conn}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.res.cols.pv}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.res.cols.batt}</th>
                  <th className="py-2 pr-3 font-medium">{t.res.cols.chargers}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.res.cols.capex}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.res.cols.saving}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.res.cols.sc}</th>
                  <th className="py-2 text-right font-medium">{t.res.cols.npv}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((i) => {
                  const x = rows[i];
                  const on = i === sel;
                  return (
                    <tr key={i} onClick={() => setSel(i)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(i)}
                      className={`cursor-pointer border-t border-line hover:bg-raised ${on ? "bg-accent-soft" : ""}`} aria-selected={on}>
                      <td className="py-2 pr-3">{String(x.connection_label)}{on && <span className="ml-2 text-xs text-accent">● {t.res.selected}</span>}</td>
                      <td className="py-2 pr-3 text-right">{nf.format(n(x, "pv_kwp"))}</td>
                      <td className="py-2 pr-3 text-right">{nf.format(n(x, "battery_kwh"))}</td>
                      <td className="py-2 pr-3">{n(x, "n_ac_chargers")} AC{n(x, "n_dc_chargers") ? ` + ${n(x, "n_dc_chargers")} DC` : ""}</td>
                      <td className="py-2 pr-3 text-right">{eur(n(x, "capex_eur"))}</td>
                      <td className="py-2 pr-3 text-right">{eur(n(x, "annual_saving_eur"))}</td>
                      <td className="py-2 pr-3 text-right">{n(x, "pv_kwp") > 0 ? `${nf.format(n(x, "self_consumption_pct"))}%` : "–"}</td>
                      <td className="py-2 text-right font-semibold">{eur(n(x, "npv_eur"))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
