"use client";
import { useRef, useState } from "react";
import type { Dict, Locale } from "@/lib/i18n";
import { fmt } from "@/lib/i18n";
import type { Inputs } from "@/lib/engine/configurator";
import type { Design, Row } from "@/lib/engine/model";
import type { SaveRequest, SaveResponse } from "@/lib/save";

type Props = {
  inputs: Inputs; design: Design; row: Row; packages: SaveRequest["packages"];
  household: boolean; designText: string; locale: Locale; t: Dict;
};

/** "Save my result": nothing is sent until the visitor clicks the button. */
export default function SaveForm({ inputs, design, row, packages, household, designText, locale, t }: Props) {
  const opened = useRef(Date.now());
  const [c, setC] = useState({ first_name: "", last_name: "", email: "", phone: "", company: "" });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof c, v: string) => setC((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!c.first_name.trim() || !c.last_name.trim() || !/^\S+@\S+\.\S+$/.test(c.email.trim()) || !consent) {
      setError(t.save.errors.invalid);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { load_kw, ...rest } = inputs;
    const body: SaveRequest = {
      locale, inputs: rest, has_meter_data: !!load_kw, design, row, packages,
      contact: { ...c, company: household ? "" : c.company }, consent, website,
      elapsed_ms: Date.now() - opened.current,
    };
    setState("sending");
    try {
      const res = await fetch("/api/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({ ok: false, error: "server" }))) as SaveResponse;
      if (out.ok) { setState("done"); return; }
      setError(t.save.errors[out.error] ?? t.save.errors.server);
    } catch {
      setError(t.save.errors.server);
    }
    setState("idle");
  }

  if (state === "done") {
    return <p role="status" className="card mt-4 p-4 text-good sm:p-5">{t.save.success}</p>;
  }

  return (
    <form className="card mt-4 p-4 sm:p-5" onSubmit={submit} noValidate>
      <h3 className="text-lg font-semibold">{t.save.title}</h3>
      <p className="mt-1 text-sm text-ink2">{t.save.lead}</p>
      <p className="mt-2 text-sm text-muted num">{fmt(t.save.showing, { design: designText })}</p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label><span className="field-label">{t.save.firstName}</span>
          <input className="input" autoComplete="given-name" value={c.first_name} maxLength={80} onChange={(e) => set("first_name", e.target.value)} /></label>
        <label><span className="field-label">{t.save.lastName}</span>
          <input className="input" autoComplete="family-name" value={c.last_name} maxLength={80} onChange={(e) => set("last_name", e.target.value)} /></label>
        <label><span className="field-label">{t.save.email}</span>
          <input className="input" type="email" autoComplete="email" value={c.email} maxLength={200} onChange={(e) => set("email", e.target.value)} /></label>
        <label><span className="field-label">{t.save.phone}</span>
          <input className="input" type="tel" autoComplete="tel" value={c.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} /></label>
        {!household && (
          <label className="sm:col-span-2"><span className="field-label">{t.save.company}</span>
            <input className="input" autoComplete="organization" value={c.company} maxLength={160} onChange={(e) => set("company", e.target.value)} /></label>
        )}
      </div>
      {/* hidden spam trap: people never see or fill this */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t.save.consent}</span>
      </label>
      <p className="mt-2 text-xs text-muted">{t.save.privacy}</p>
      <button type="submit" className="btn mt-4 w-full sm:w-auto" disabled={state === "sending"}>
        {state === "sending" ? t.save.sending : t.save.button}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
    </form>
  );
}
