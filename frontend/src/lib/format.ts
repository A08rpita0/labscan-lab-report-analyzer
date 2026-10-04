/* Presentation helpers. Pure functions: no clinical knowledge lives here, only how a
 * value the backend produced is written down. */

const LOCALE = "en-US";

/** One number style everywhere, independent of the browser's locale: decimals scaled to
 *  magnitude with trailing zeros dropped, digit grouping from 10,000 up. */
export function num(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 10000) {
    return v.toLocaleString(LOCALE, { maximumFractionDigits: Math.abs(v) >= 100000 ? 0 : 2 });
  }
  // Precision follows magnitude, so a value converted from SI units (168 umol/L of
  // creatinine is 1.89837... mg/dL) is not printed with digits no laboratory reported.
  // The unrounded number stays in the raw JSON and the reasoning trace's input step.
  const places = Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 1 ? 3 : 4;
  const f = 10 ** places;
  return String(Math.round(v * f) / f);
}

/** A score or weight in [0, 1], printed to a fixed precision so columns line up. */
export function score(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function refText(low: number | null | undefined, high: number | null | undefined): string | null {
  const hasLo = low !== null && low !== undefined;
  const hasHi = high !== null && high !== undefined;
  if (hasLo && hasHi) return `${num(low)}–${num(high)}`;
  if (hasHi) return `≤ ${num(high)}`;
  if (hasLo) return `≥ ${num(low)}`;
  return null;
}

export function valueText(value: unknown, unit?: string | null): string {
  const v = num(value);
  return unit && typeof value === "number" ? `${v} ${unit}` : v;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ms(v: number): string {
  if (v < 1) return `${v.toFixed(2)} ms`;
  if (v < 100) return `${v.toFixed(1)} ms`;
  if (v < 10000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

/** The analysis time in the reader's own timezone. The server sends an offset, so a
 *  report analysed in one zone is not printed in the deployed server's clock. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return String(iso);
  return t.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Where on a reference interval a value sits, for the range-position bar.
 *  Returns null when there is no two-sided numeric interval to place it on - a
 *  one-sided limit or a qualitative result is never drawn as if it had one. */
export function rangePosition(value: unknown, low: number | null, high: number | null) {
  if (typeof value !== "number" || low === null || high === null || !(high > low)) return null;
  const span = high - low;
  const min = low - span * 0.6;
  const max = high + span * 0.6;
  const clamp = (x: number) => Math.min(1, Math.max(0, (x - min) / (max - min)));
  return {
    low: clamp(low),
    high: clamp(high),
    value: clamp(value),
    offScale: value < min ? "below" : value > max ? "above" : null,
  } as const;
}

/** A label adds nothing when it only repeats the value or the badge beside it: the value
 *  "Equivocal", the badge "Equivocal result" and the grade "Equivocal" said the same thing
 *  three times. Ported from the original dashboard (product decision #29). */
function words(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function repeats(label: unknown, value: unknown, badge?: unknown): boolean {
  const l = words(label);
  if (!l) return true;
  const v = typeof value === "number" ? "" : words(value);
  return l === v || (!!badge && words(badge).includes(l)) || (!!v && l.includes(v));
}
