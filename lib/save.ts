// "Save my result": shared between the form (browser) and the /api/save route (server).
import type { Inputs } from "./engine/configurator";
import type { Design, Row } from "./engine/model";

export const CONSENT_VERSION = "2026-10-05";

export type SaveContact = { first_name: string; last_name: string; email: string; phone: string; company: string };

/** What the browser sends. Meter data itself is never sent: only whether it was used. */
export type SaveRequest = {
  locale: "nl" | "en";
  inputs: Omit<Inputs, "load_kw">;
  has_meter_data: boolean;
  design: Design;
  row: Row;                                   // the browser's result for the design
  packages: Record<string, { npv_eur: number; capex_eur: number } | null>;
  contact: SaveContact;
  consent: boolean;
  website: string;                            // hidden spam field: must stay empty
  elapsed_ms: number;                         // time the form was open
};

export type SaveResponse =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "mismatch" | "not_configured" | "server" };

export type QuoteLine = { part: string; description: string; quantity: number; unit_price: number; tax_rate: number };

const n = (r: Row, k: string) => Number(r[k] ?? 0);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Quote lines from a result row. Amounts are those the visitor saw. Households: the model's amounts include
 * VAT (solar 0%, the rest 21%), so the net price is split back out; businesses: amounts are excl. VAT.
 */
export function quoteLines(row: Row, household: boolean, locale: "nl" | "en"): QuoteLine[] {
  const nl = locale === "nl";
  const vat = 21;
  const net = (gross: number) => (household ? gross / (1 + vat / 100) : gross);
  const lines: QuoteLine[] = [];
  const kwp = n(row, "pv_kwp"), kwh = n(row, "battery_kwh");
  if (kwp > 0 && n(row, "capex_pv_eur") > 0) {
    lines.push({ part: "solar", description: nl ? `Zonnepanelen ${kwp} kWp, geïnstalleerd` : `Solar panels ${kwp} kWp, installed`,
      quantity: kwp, unit_price: r4(n(row, "capex_pv_eur") / kwp), tax_rate: household ? 0 : vat });
  }
  if (kwh > 0 && n(row, "capex_batt_eur") > 0) {
    lines.push({ part: "battery", description: nl ? `Batterij ${kwh} kWh / ${n(row, "battery_kw")} kW, geïnstalleerd` : `Battery ${kwh} kWh / ${n(row, "battery_kw")} kW, installed`,
      quantity: kwh, unit_price: r4(net(n(row, "capex_batt_eur")) / kwh), tax_rate: vat });
  }
  if (n(row, "capex_charger_incremental_eur") > 0) {
    const ac = n(row, "n_ac_chargers"), dc = n(row, "n_dc_chargers");
    lines.push({ part: "chargers", description: nl ? `Extra laadpunten (ontwerp: ${ac} AC${dc ? ` + ${dc} DC` : ""})` : `Extra charge points (design: ${ac} AC${dc ? ` + ${dc} DC` : ""})`,
      quantity: 1, unit_price: r4(net(n(row, "capex_charger_incremental_eur"))), tax_rate: vat });
  }
  if (n(row, "capex_ems_eur") > 0) {
    lines.push({ part: "ems", description: nl ? "Energiemanagementsysteem (EMS)" : "Energy management system (EMS)",
      quantity: 1, unit_price: r4(net(n(row, "capex_ems_eur"))), tax_rate: vat });
  }
  if (n(row, "capex_soft_eur") > 0) {
    lines.push({ part: "engineering", description: nl ? "Engineering en onvoorzien" : "Engineering and contingency",
      quantity: 1, unit_price: r4(net(n(row, "capex_soft_eur"))), tax_rate: vat });
  }
  return lines;
}
