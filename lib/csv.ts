// Meter data: a CSV with one value per hour (8,760 / 8,784 rows) or per quarter-hour
// (35,040 / 35,136 rows). The last number on each line is used. Header lines are skipped.
// Returns 8,760 hourly kW values, or an error code the page translates.

export type MeterUnit = "kw" | "kwh";
export type MeterResult = { ok: true; load: number[]; annualMwh: number; rows: number; step: "hour" | "quarter" }
  | { ok: false; error: "empty" | "rows" | "negative" | "nonnumeric"; rows?: number; line?: number };

function parseNumber(s: string): number | null {
  let t = s.trim().replace(/^"|"$/g, "");
  if (!t) return null;
  // 1.234,5 (Dutch) or 1,234.5 (English) or 1234,5
  if (t.includes(",") && t.includes(".")) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.includes(",")) t = t.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function parseMeterCsv(text: string, unit: MeterUnit): MeterResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { ok: false, error: "empty" };
  const values: number[] = [];
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    // separator: ; or tab when present, otherwise comma
    const parts = /[;\t]/.test(lines[i]) ? lines[i].split(/[;\t]/) : lines[i].split(",");
    let v: number | null = null;
    for (let j = parts.length - 1; j >= 0; j--) {
      v = parseNumber(parts[j]);
      if (v !== null) break;
    }
    if (v === null) {
      if (!started) continue; // header
      return { ok: false, error: "nonnumeric", line: i + 1 };
    }
    started = true;
    values.push(v);
  }
  const n = values.length;
  if (values.some((v) => v < 0)) return { ok: false, error: "negative", rows: n };
  let hourly: number[];
  let step: "hour" | "quarter";
  if (n === 8760 || n === 8784) {
    step = "hour";
    hourly = n === 8784 ? [...values.slice(0, 1416), ...values.slice(1440)] : values; // drop 29 Feb
  } else if (n === 35040 || n === 35136) {
    step = "quarter";
    const v = n === 35136 ? [...values.slice(0, 5664), ...values.slice(5760)] : values;
    hourly = [];
    for (let h = 0; h < 8760; h++) {
      const s = v[4 * h] + v[4 * h + 1] + v[4 * h + 2] + v[4 * h + 3];
      hourly.push(unit === "kwh" ? s : s / 4); // kWh per quarter summed = kWh per hour = average kW
    }
  } else {
    return { ok: false, error: "rows", rows: n };
  }
  const annual = hourly.reduce((a, b) => a + b, 0) / 1000;
  if (annual <= 0) return { ok: false, error: "empty" };
  return { ok: true, load: hourly, annualMwh: annual, rows: n, step };
}
