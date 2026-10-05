// POST /api/save - "save my result": checks the request, re-runs the design on the server, then writes
// contact, company, deal, draft quote and configuration into Bridge CRM through one database function.
// The Supabase service-role key lives only in Vercel environment variables; the browser never sees it.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prepare, runDesigns, Inputs } from "@/lib/engine/configurator";
import { CONN, SCENARIOS, SITE_TYPES, MODEL_VERSION } from "@/lib/engine/params";
import type { Row } from "@/lib/engine/model";
import { CONSENT_VERSION, quoteLines, SaveRequest, SaveResponse } from "@/lib/save";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 50_000;
const MIN_FORM_MS = 3_000;
const NPV_TOLERANCE = 100; // EUR, same as the parity test

const OVERRIDE_NUM = new Set([
  "costs.pv_eur_kwp", "costs.pv_eur_kwp_small_adder", "costs.battery_eur_kwh", "costs.battery_eur_kw",
  "costs.charger_ac_22kw_eur", "costs.charger_dc_60kw_eur", "costs.charger_civil_eur_each",
  "prices.wholesale_base_eur_mwh", "prices.fixed_contract_eur_kwh", "prices.public_charging_eur_kwh",
  "finance.discount_rate_pct", "prices.grid_tariff_escalation_pct", "site.specific_yield_kwh_kwp",
]);

const reply = (body: SaveResponse, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fin = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const str = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;

function validInputs(i: SaveRequest["inputs"]): boolean {
  if (!i || typeof i !== "object") return false;
  if (!(i.site_type in SITE_TYPES)) return false;
  if (!fin(i.annual_mwh, 0.1, 100_000) || !fin(i.roof_m2, 0, 500_000) || !fin(i.ev_annual_kwh, 0, 20_000_000)) return false;
  if (!["east_west", "south", "flat"].includes(i.orientation)) return false;
  if (i.ac_kw !== undefined && i.ac_kw !== 11 && i.ac_kw !== 22) return false;
  if (i.pattern != null && !["office", "public", "depot", "residential"].includes(i.pattern)) return false;
  if (i.connection !== "auto" && !(i.connection in CONN)) return false;
  if (i.scenario !== undefined && !(i.scenario in SCENARIOS)) return false;
  for (const [k, v] of Object.entries(i.overrides ?? {})) {
    if (OVERRIDE_NUM.has(k)) { if (!fin(v, 0, 1_000_000)) return false; }
    else if (k === "prices.contract_type") { if (v !== "dynamic" && v !== "fixed") return false; }
    else if (k === "finance.eia_enabled") { if (typeof v !== "boolean") return false; }
    else return false;
  }
  return true;
}

function validRequest(b: SaveRequest): boolean {
  const c = b?.contact;
  if (!c || !str(c.first_name, 80) || !c.first_name.trim() || !str(c.last_name, 80) || !c.last_name.trim()) return false;
  if (!str(c.email, 200) || !EMAIL.test(c.email.trim())) return false;
  if (!str(c.phone ?? "", 40) || !str(c.company ?? "", 160)) return false;
  if (b.consent !== true) return false;
  if (b.locale !== "nl" && b.locale !== "en") return false;
  if (typeof b.has_meter_data !== "boolean") return false;
  const d = b.design;
  if (!d || !(d.conn in CONN) || !fin(d.pv, 0, 100_000) || !fin(d.batt, 0, 1_000_000) || !fin(d.nAc, 0, 1000) || !fin(d.nDc, 0, 1000)) return false;
  if (!b.row || typeof b.row !== "object" || !fin(Number(b.row.npv_eur), -1e9, 1e9) || !fin(Number(b.row.capex_eur), 0, 1e9)) return false;
  return validInputs(b.inputs);
}

/** Only the fields the CRM needs, never the visitor's free text. */
function pickRow(r: Row): Row {
  const keys = ["connection_id", "connection_label", "pv_kwp", "battery_kwh", "battery_kw", "n_ac_chargers", "n_dc_chargers",
    "npv_eur", "irr_pct", "payback_yr", "capex_eur", "capex_pv_eur", "capex_batt_eur", "capex_charger_incremental_eur",
    "capex_charger_ref_eur", "capex_ems_eur", "capex_soft_eur", "eia_benefit_eur", "annual_saving_eur", "baseline_cost_eur_yr",
    "project_cost_eur_yr", "self_consumption_pct", "self_sufficiency_pct", "peak_import_kw", "base_peak_kw", "pv_mwh",
    "import_mwh", "export_mwh", "public_kwh", "upgrade_avoided_kw", "upgrade_avoided_eur", "base_connection_id", "feasible"];
  return Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]));
}

export async function POST(req: Request) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const tenant = process.env.ENERGY_TENANT_ID, salt = process.env.IP_HASH_SALT;
  if (!url || !key || !tenant || !salt) return reply({ ok: false, error: "not_configured" }, 503);

  // same site only
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return reply({ ok: false, error: "invalid" }, 403);

  const text = await req.text();
  if (text.length > MAX_BYTES) return reply({ ok: false, error: "invalid" }, 413);
  let b: SaveRequest;
  try { b = JSON.parse(text); } catch { return reply({ ok: false, error: "invalid" }, 400); }
  if (!validRequest(b)) return reply({ ok: false, error: "invalid" }, 400);
  // spam: hidden field filled in, or form sent too fast -> pretend success, store nothing
  if (b.website || !(Number(b.elapsed_ms) >= MIN_FORM_MS)) return reply({ ok: true }, 200);

  // re-run the chosen design on the server (not possible with meter data: that never leaves the browser)
  const inputs: Inputs = { ...b.inputs, load_kw: null };
  let row: Row = b.row;
  let checked = false;
  let household = false;
  try {
    const prep = prepare(inputs);
    household = prep.p.site.household;
    if (!b.has_meter_data) {
      const d = prep.designs.find((x) => x.conn === b.design.conn && x.pv === b.design.pv && x.batt === b.design.batt
        && x.nAc === b.design.nAc && x.nDc === b.design.nDc);
      if (!d) return reply({ ok: false, error: "mismatch" }, 422);
      const [server] = runDesigns(prep, [d]);
      if (Math.abs(Number(server.npv_eur) - Number(b.row.npv_eur)) > NPV_TOLERANCE) return reply({ ok: false, error: "mismatch" }, 422);
      row = server;
      checked = true;
    }
  } catch {
    return reply({ ok: false, error: "invalid" }, 400);
  }

  const c = b.contact;
  const company = household ? "" : c.company.trim();
  const typeLabel = { house: "woning", shop: "winkel", office: "kantoor", warehouse: "magazijn", industry: "industrie", retail: "retail" }[b.inputs.site_type];
  const siteLabel = `${company || `${c.first_name.trim()} ${c.last_name.trim()}`} - ${typeLabel} ${b.inputs.annual_mwh} MWh`;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

  const payload = {
    tenant_id: tenant,
    ip_hash: createHash("sha256").update(`${salt}|${ip}`).digest("hex"),
    model_version: MODEL_VERSION,
    locale: b.locale,
    site_label: siteLabel.slice(0, 200),
    segment: b.inputs.site_type,
    capex_eur: Number(row.capex_eur),
    npv_eur: Number(row.npv_eur),
    checked_on_server: checked,
    consent_version: CONSENT_VERSION,
    inputs: { ...b.inputs, has_meter_data: b.has_meter_data },
    result: { row: pickRow(row), packages: b.packages ?? {} },
    contact: { first_name: c.first_name.trim(), last_name: c.last_name.trim(), email: c.email.trim(), phone: (c.phone ?? "").trim(), company },
    quote_lines: quoteLines(row, household, b.locale),
  };

  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy JWT key; new secret keys go in apikey only
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/energy_save_configuration`, {
      method: "POST", headers, body: JSON.stringify({ p: payload }), cache: "no-store",
    });
    if (res.ok) return reply({ ok: true }, 200);
    const err = await res.text();
    if (err.includes("rate_limited")) return reply({ ok: false, error: "rate_limited" }, 429);
    console.error("save failed", res.status, err.slice(0, 300));
    return reply({ ok: false, error: "server" }, 502);
  } catch (e) {
    console.error("save failed", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "server" }, 502);
  }
}
