"use client";
import { useMemo, useRef, useState } from "react";
import type { Dict, Locale } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import { CONNECTIONS, SCENARIOS, SITE_TYPES, SiteTypeId, Overrides, pvYield } from "@/lib/engine/params";
import { buildParams, Inputs } from "@/lib/engine/configurator";
import { parseMeterCsv, MeterResult, MeterUnit } from "@/lib/csv";
import { optimise, RunResult } from "@/lib/runner";
import Results from "./Results";

type Form = {
  site_type: SiteTypeId; annual_mwh: string; roof_m2: string; orientation: "east_west" | "south" | "flat";
  fleetMode: "energy" | "cars"; ev_kwh: string; cars: string; km: string; kwhPerKm: string;
  ac_kw: "11" | "22"; pattern: string; connection: string;
  scenario: string; contract: "" | "dynamic" | "fixed"; wholesale: string; fixedPrice: string; publicPrice: string;
  pvPrice: string; battPrice: string; chargerPrice: string; discount: string; escalation: string; eia: "" | "on" | "off";
  yieldKwh: string; lvlSolar: Level; lvlBattery: Level; lvlChargers: Level;
};
type Level = "low" | "base" | "high";

const ADV_EMPTY = { scenario: "base", contract: "" as const, wholesale: "", fixedPrice: "", publicPrice: "", pvPrice: "", battPrice: "",
  chargerPrice: "", discount: "", escalation: "", eia: "" as const, yieldKwh: "",
  lvlSolar: "base" as Level, lvlBattery: "base" as Level, lvlChargers: "base" as Level };

function defaultsFor(st: SiteTypeId): Form {
  const t = SITE_TYPES[st];
  return {
    site_type: st, annual_mwh: String(t.mwh), roof_m2: String(t.roof), orientation: "east_west",
    fleetMode: "energy", ev_kwh: String(t.ev_kwh), cars: st === "house" ? "2" : String(Math.round(t.ev_kwh / 3000)),
    km: st === "house" ? "15000" : "16000", kwhPerKm: "0.18", ac_kw: t.ac_kw === 11 ? "11" : "22", pattern: "auto",
    connection: "auto", ...ADV_EMPTY,
  };
}

const num = (s: string) => {
  const v = Number(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

export default function Configurator({ locale, t }: { locale: Locale; t: Dict }) {
  const [f, setF] = useState<Form>(defaultsFor("office"));
  const [meter, setMeter] = useState<MeterResult | null>(null);
  const [meterName, setMeterName] = useState("");
  const [meterUnit, setMeterUnit] = useState<MeterUnit>("kw");
  const [meterText, setMeterText] = useState<string | null>(null);
  const [showAdv, setShowAdv] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ run: RunResult; inputs: Inputs } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const nf = useMemo(() => new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-GB", { maximumFractionDigits: 1 }), [locale]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const evKwh = f.fleetMode === "energy" ? num(f.ev_kwh) : Math.round(num(f.cars) * num(f.km) * num(f.kwhPerKm));

  function overrides(): Overrides {
    const o: Overrides = {};
    // price level per part, applied on top of the scenario's prices; exact prices below win
    const d = defaults;
    if (d) {
      const k = (l: Level) => (l === "low" ? 0.8 : l === "high" ? 1.2 : 1);
      if (f.lvlSolar !== "base") {
        o["costs.pv_eur_kwp"] = d.costs.pv_eur_kwp * k(f.lvlSolar);
        o["costs.pv_eur_kwp_small_adder"] = d.costs.pv_eur_kwp_small_adder * k(f.lvlSolar);
      }
      if (f.lvlBattery !== "base") {
        const low = f.lvlBattery === "low"; // 2030 cost curve: EUR 190/kWh + 120/kW vs 320 + 180
        o["costs.battery_eur_kwh"] = d.costs.battery_eur_kwh * (low ? 190 / 320 : 1.2);
        o["costs.battery_eur_kw"] = d.costs.battery_eur_kw * (low ? 120 / 180 : 1.2);
      }
      if (f.lvlChargers !== "base") {
        o["costs.charger_ac_22kw_eur"] = d.costs.charger_ac_22kw_eur * k(f.lvlChargers);
        o["costs.charger_dc_60kw_eur"] = d.costs.charger_dc_60kw_eur * k(f.lvlChargers);
        o["costs.charger_civil_eur_each"] = d.costs.charger_civil_eur_each * k(f.lvlChargers);
      }
    }
    const put = (k: string, s: string, scale = 1) => { const v = num(s); if (s.trim() !== "" && Number.isFinite(v)) o[k] = v * scale; };
    if (f.contract) o["prices.contract_type"] = f.contract;
    put("prices.wholesale_base_eur_mwh", f.wholesale);
    put("prices.fixed_contract_eur_kwh", f.fixedPrice);
    put("prices.public_charging_eur_kwh", f.publicPrice);
    put("costs.pv_eur_kwp", f.pvPrice);
    put("costs.battery_eur_kwh", f.battPrice);
    put("costs.charger_ac_22kw_eur", f.chargerPrice);
    put("finance.discount_rate_pct", f.discount);
    put("prices.grid_tariff_escalation_pct", f.escalation);
    put("site.specific_yield_kwh_kwp", f.yieldKwh);
    if (f.eia) o["finance.eia_enabled"] = f.eia === "on";
    return o;
  }

  function baseInputs(): Inputs {
    return {
      site_type: f.site_type, annual_mwh: meter?.ok ? meter.annualMwh : num(f.annual_mwh), roof_m2: num(f.roof_m2),
      orientation: f.orientation, ev_annual_kwh: Math.max(0, evKwh || 0), ac_kw: Number(f.ac_kw),
      pattern: f.pattern === "auto" ? null : f.pattern, connection: f.connection, scenario: f.scenario,
      overrides: {}, load_kw: meter?.ok ? meter.load : null,
    };
  }
  const inputs = (): Inputs => ({ ...baseInputs(), overrides: overrides() });

  // model defaults for the current site type, roof and scenario: shown as placeholders, base for price levels
  const defaults = useMemo(() => {
    try {
      return buildParams(baseInputs());
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.site_type, f.annual_mwh, f.scenario, f.orientation]);

  async function run() {
    setError(null);
    const inp = inputs();
    if (!(inp.annual_mwh > 0) || !(inp.roof_m2 >= 0) || !Number.isFinite(inp.ev_annual_kwh)) {
      setError(locale === "nl" ? "Controleer de ingevulde getallen." : "Please check the numbers you entered.");
      return;
    }
    setProgress({ done: 0, total: 1 });
    try {
      const run = await optimise(inp, (done, total) => setProgress({ done, total }));
      setResult({ run, inputs: inp });
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setMeterName(file.name);
    setMeterText(text);
    setMeter(parseMeterCsv(text, meterUnit));
  }
  function changeUnit(u: MeterUnit) {
    setMeterUnit(u);
    if (meterText) setMeter(parseMeterCsv(meterText, u));
  }
  function clearMeter() {
    setMeter(null); setMeterName(""); setMeterText(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const meterMsg = meter && (meter.ok
    ? fmt(t.meter.loaded, { rows: nf.format(meter.rows), step: meter.step === "hour" ? t.meter.hour : t.meter.quarter, mwh: nf.format(meter.annualMwh) })
    : fmt(t.meter.errors[meter.error], { rows: nf.format(meter.rows ?? 0), line: meter.line ?? "" }));

  const running = progress !== null;
  const sitesOrder: SiteTypeId[] = ["house", "shop", "office", "retail", "warehouse", "industry"];
  const ph = (v: number | undefined, d = 2) => (v === undefined ? "" : String(Number(v.toFixed(d))));

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <section className="py-8 sm:py-10">
        <h1 className="max-w-3xl text-2xl font-bold leading-tight sm:text-3xl">{t.hero.title}</h1>
        <p className="mt-3 max-w-3xl text-ink2">{t.hero.lead}</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          {t.hero.privacy}
        </p>
      </section>

      <form className="grid grid-cols-1 gap-4 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        {/* 1. building */}
        <fieldset className="card p-4 sm:p-5">
          <legend className="sr-only">{t.steps.site}</legend>
          <h2 className="mb-4 text-lg font-semibold">{t.steps.site}</h2>
          <span className="field-label">{t.site.type}</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sitesOrder.map((st) => (
              <button key={st} type="button" className="chip" aria-pressed={f.site_type === st}
                onClick={() => setF({ ...defaultsFor(st), connection: "auto" })}>
                {t.site.types[st]}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="field-label">{t.site.annual}</span>
              <div className="flex items-center gap-2">
                <input className="input num" inputMode="decimal" value={meter?.ok ? nf.format(meter.annualMwh) : f.annual_mwh}
                  disabled={!!meter?.ok} onChange={(e) => set("annual_mwh", e.target.value)} />
                <span className="text-sm text-ink2">{t.units.mwh}</span>
              </div>
              <span className="hint block">{t.site.annualHint}</span>
            </label>
            <label>
              <span className="field-label">{t.site.roof}</span>
              <div className="flex items-center gap-2">
                <input className="input num" inputMode="decimal" value={f.roof_m2} onChange={(e) => set("roof_m2", e.target.value)} />
                <span className="text-sm text-ink2">m²</span>
              </div>
              <span className="hint block">{t.site.roofHint}</span>
            </label>
          </div>
          <span className="field-label mt-4">{t.site.orientation}</span>
          <div className="seg" role="group" aria-label={t.site.orientation}>
            {(["east_west", "south", "flat"] as const).map((o) => (
              <button key={o} type="button" aria-pressed={f.orientation === o} onClick={() => set("orientation", o)}>{t.site.orientations[o]}</button>
            ))}
          </div>
        </fieldset>

        {/* 2. fleet */}
        <fieldset className="card p-4 sm:p-5">
          <legend className="sr-only">{t.steps.fleet}</legend>
          <h2 className="mb-4 text-lg font-semibold">{t.steps.fleet}</h2>
          <span className="field-label">{t.fleet.mode}</span>
          <div className="seg" role="group" aria-label={t.fleet.mode}>
            <button type="button" aria-pressed={f.fleetMode === "energy"} onClick={() => set("fleetMode", "energy")}>{t.fleet.modeEnergy}</button>
            <button type="button" aria-pressed={f.fleetMode === "cars"} onClick={() => set("fleetMode", "cars")}>{t.fleet.modeCars}</button>
          </div>
          {f.fleetMode === "energy" ? (
            <label className="mt-4 block">
              <span className="field-label">{t.fleet.energy}</span>
              <div className="flex items-center gap-2">
                <input className="input num" inputMode="numeric" value={f.ev_kwh} onChange={(e) => set("ev_kwh", e.target.value)} />
                <span className="text-sm text-ink2">{t.units.kwh}</span>
              </div>
              <span className="hint block">{t.fleet.none}</span>
            </label>
          ) : (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <label><span className="field-label">{t.fleet.cars}</span><input className="input num" inputMode="numeric" value={f.cars} onChange={(e) => set("cars", e.target.value)} /></label>
              <label><span className="field-label">{t.fleet.km}</span><input className="input num" inputMode="numeric" value={f.km} onChange={(e) => set("km", e.target.value)} /></label>
              <label><span className="field-label">{t.fleet.kwhPerKm}</span><input className="input num" inputMode="decimal" value={f.kwhPerKm} onChange={(e) => set("kwhPerKm", e.target.value)} /></label>
              <p className="hint col-span-3 num">{fmt(t.fleet.result, { kwh: Number.isFinite(evKwh) ? nf.format(evKwh) : "–" })}</p>
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <span className="field-label">{t.fleet.socket}</span>
              <div className="seg" role="group" aria-label={t.fleet.socket}>
                {(["11", "22"] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={f.ac_kw === k} onClick={() => set("ac_kw", k)}>{k} kW</button>
                ))}
              </div>
            </div>
            <label>
              <span className="field-label">{t.fleet.pattern}</span>
              <select className="input" value={f.pattern} onChange={(e) => set("pattern", e.target.value)}>
                {(["auto", "office", "public", "depot", "residential"] as const).map((p) => <option key={p} value={p}>{t.fleet.patterns[p]}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        {/* 3. connection */}
        <fieldset className="card p-4 sm:p-5">
          <legend className="sr-only">{t.steps.grid}</legend>
          <h2 className="mb-4 text-lg font-semibold">{t.steps.grid}</h2>
          <label className="block">
            <span className="field-label">{t.grid.connection}</span>
            <select className="input" value={f.connection} onChange={(e) => set("connection", e.target.value)}>
              <option value="auto">{t.grid.auto}</option>
              <optgroup label={t.grid.kv}>
                {CONNECTIONS.filter((c) => c.cls === "kv").map((c) => <option key={c.id} value={c.id}>{c.label} ({nf.format(c.kw)} kW)</option>)}
              </optgroup>
              <optgroup label={t.grid.gv}>
                {CONNECTIONS.filter((c) => c.cls === "gv").map((c) => <option key={c.id} value={c.id}>{c.label} ({nf.format(c.kw)} kW)</option>)}
              </optgroup>
            </select>
            <span className="hint block">{t.grid.hint}</span>
          </label>
        </fieldset>

        {/* 4. meter data */}
        <fieldset className="card p-4 sm:p-5">
          <legend className="sr-only">{t.steps.meter}</legend>
          <h2 className="mb-2 text-lg font-semibold">{t.steps.meter}</h2>
          <p className="text-sm text-ink2">{t.meter.lead}</p>
          <span className="field-label mt-3">{t.meter.unit}</span>
          <div className="seg" role="group" aria-label={t.meter.unit}>
            <button type="button" aria-pressed={meterUnit === "kw"} onClick={() => changeUnit("kw")}>{t.meter.unitKw}</button>
            <button type="button" aria-pressed={meterUnit === "kwh"} onClick={() => changeUnit("kwh")}>{t.meter.unitKwh}</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="btn btn-ghost cursor-pointer">
              {t.meter.choose}
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {meterName && <span className="min-w-0 truncate text-sm text-ink2">{meterName}</span>}
            {meter && <button type="button" className="text-sm text-ink2 underline" onClick={clearMeter}>{t.meter.remove}</button>}
          </div>
          {meterMsg && <p role="status" className={`mt-2 text-sm ${meter?.ok ? "text-good" : "text-bad"}`}>{meterMsg}</p>}
        </fieldset>

        {/* prices and assumptions */}
        <div className="card p-4 sm:p-5 lg:col-span-2">
          <button type="button" className="flex w-full items-center justify-between text-left font-semibold" aria-expanded={showAdv} onClick={() => setShowAdv(!showAdv)}>
            <span>{t.steps.advanced}</span>
            <svg viewBox="0 0 24 24" className={`h-5 w-5 transition-transform ${showAdv ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {showAdv && (
            <div className="mt-4">
              {defaults?.site.household && <p className="mb-3 text-sm text-ink2">{t.advanced.household}</p>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label><span className="field-label">{t.advanced.scenario}</span>
                  <select className="input" value={f.scenario} onChange={(e) => set("scenario", e.target.value)}>
                    {Object.entries(SCENARIOS).map(([k, s]) => <option key={k} value={k}>{locale === "nl" ? s._label_nl : s._label}</option>)}
                  </select>
                </label>
                <label><span className="field-label">{t.advanced.contract}</span>
                  <select className="input" value={f.contract || defaults?.prices.contract_type} onChange={(e) => set("contract", e.target.value as Form["contract"])}>
                    <option value="dynamic">{t.advanced.dynamic}</option><option value="fixed">{t.advanced.fixed}</option>
                  </select>
                </label>
                <Num label={t.advanced.wholesale} v={f.wholesale} ph={ph(defaults?.prices.wholesale_base_eur_mwh, 0)} on={(v) => set("wholesale", v)} />
                <Num label={t.advanced.fixedPrice} v={f.fixedPrice} ph={ph(defaults?.prices.fixed_contract_eur_kwh, 3)} on={(v) => set("fixedPrice", v)} />
                <Num label={t.advanced.publicPrice} v={f.publicPrice} ph={ph(defaults?.prices.public_charging_eur_kwh)} on={(v) => set("publicPrice", v)} />
                <Num label={t.advanced.pv} v={f.pvPrice} ph={ph(defaults?.costs.pv_eur_kwp, 0)} on={(v) => set("pvPrice", v)} />
                <Num label={t.advanced.battery} v={f.battPrice} ph={ph(defaults?.costs.battery_eur_kwh, 0)} on={(v) => set("battPrice", v)} />
                <Num label={t.advanced.charger} v={f.chargerPrice} ph={ph(defaults?.costs.charger_ac_22kw_eur, 0)} on={(v) => set("chargerPrice", v)} />
                <Num label={t.advanced.discount} v={f.discount} ph={ph(defaults?.finance.discount_rate_pct, 1)} on={(v) => set("discount", v)} />
                <Num label={t.advanced.escalation} v={f.escalation} ph={ph(defaults?.prices.grid_tariff_escalation_pct, 1)} on={(v) => set("escalation", v)} />
                <Num label={t.advanced.yield} v={f.yieldKwh} ph={defaults ? ph(pvYield(defaults.site), 0) : ""} on={(v) => set("yieldKwh", v)} />
                {!defaults?.site.household && (
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" checked={f.eia ? f.eia === "on" : defaults?.finance.eia_enabled ?? true}
                      onChange={(e) => set("eia", e.target.checked ? "on" : "off")} className="h-4 w-4 accent-[var(--accent)]" />
                    {t.advanced.eia}
                  </label>
                )}
              </div>
              <span className="field-label mt-5">{t.advanced.levels}</span>
              <div className="grid gap-3 sm:grid-cols-3">
                {([["solar", "lvlSolar"], ["battery", "lvlBattery"], ["chargers", "lvlChargers"]] as const).map(([part, key]) => (
                  <div key={part}>
                    <span className="mb-1 block text-xs text-ink2">{t.advanced.levelParts[part]}</span>
                    <div className="seg" role="group" aria-label={`${t.advanced.levels}: ${t.advanced.levelParts[part]}`}>
                      {(["low", "base", "high"] as const).map((l) => (
                        <button key={l} type="button" aria-pressed={f[key] === l} onClick={() => set(key, l)}>
                          {l === "low" ? (part === "battery" ? t.advanced.lowBattery : t.advanced.low) : l === "high" ? t.advanced.high : t.advanced.base}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-ghost mt-4 text-sm" onClick={() => setF((x) => ({ ...x, ...ADV_EMPTY }))}>{t.advanced.reset}</button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <button type="submit" className="btn w-full sm:w-auto" disabled={running}>
            {running ? fmt(t.run.running, { done: progress!.done, total: progress!.total }) : result ? t.run.again : t.run.button}
          </button>
          {running && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={progress!.total} aria-valuenow={progress!.done}>
              <div className="h-full bg-accent transition-all" style={{ width: `${(100 * progress!.done) / Math.max(progress!.total, 1)}%` }} />
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
        </div>
      </form>

      <div ref={resultsRef} className="scroll-mt-4">
        {result && <Results key={result.run.seconds} run={result.run} inputs={result.inputs} locale={locale} t={t} />}
      </div>

      <p className="mt-10 max-w-3xl text-xs text-muted">{t.disclaimer}</p>
    </div>
  );
}

function Num({ label, v, ph, on }: { label: string; v: string; ph: string; on: (v: string) => void }) {
  return (
    <label>
      <span className="field-label">{label}</span>
      <input className="input num" inputMode="decimal" value={v} placeholder={ph} onChange={(e) => on(e.target.value)} />
    </label>
  );
}
