// Zahlen- und Datumsformate (deutsche Schreibweise, feste Nachkommastellen).

const cache = new Map<string, Intl.NumberFormat>();

function nf(min: number, max: number, sign = false): Intl.NumberFormat {
  const key = `${min}|${max}|${sign}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      signDisplay: sign ? "exceptZero" : "auto",
    });
    cache.set(key, f);
  }
  return f;
}

export const DASH = "–";

export function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Werte, die auf `digits` Stellen zu null runden, als 0 – sonst zeigt Intl "-0,00". */
function z(x: number, digits: number): number {
  return Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x;
}

/** Zahl mit fester Stellenzahl. */
export function fmt(x: number | null | undefined, digits = 2): string {
  return isNum(x) ? nf(digits, digits).format(z(x, digits)) : DASH;
}

/** Kurs: Nachkommastellen nach Größenordnung (Devisen 4, große Indizes 2). */
export function fmtPrice(x: number | null | undefined): string {
  if (!isNum(x)) return DASH;
  const a = Math.abs(x);
  const d = a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 4 : 4;
  return nf(d, d).format(z(x, d));
}

export function fmtSigned(x: number | null | undefined, digits = 2): string {
  return isNum(x) ? nf(digits, digits, true).format(x) : DASH;
}

/** Prozentwert, der bereits in Prozent vorliegt (1.5 = 1,5 %). */
export function fmtPct(x: number | null | undefined, digits = 2, signed = true): string {
  return isNum(x) ? `${nf(digits, digits, signed).format(z(x, digits))} %` : DASH;
}

/** Anteil (0.015 = 1,5 %). */
export function fmtRatio(x: number | null | undefined, digits = 1): string {
  return isNum(x) ? `${nf(digits, digits).format(z(x * 100, digits))} %` : DASH;
}

/** Basispunkte aus Prozentpunkten (0.05 -> +5 bp). */
export function fmtBp(x: number | null | undefined, fromPercent = true): string {
  if (!isNum(x)) return DASH;
  const bp = fromPercent ? x * 100 : x;
  return `${nf(0, 0, true).format(Math.round(bp))} bp`;
}

/** Große Beträge kompakt: 1,23 Bio. / 4,56 Mrd. / 7,8 Mio. / 12,3 Tsd. */
export function fmtBig(x: number | null | undefined, digits = 2): string {
  if (!isNum(x)) return DASH;
  const a = Math.abs(x);
  if (a >= 1e12) return `${nf(digits, digits).format(x / 1e12)} Bio.`;
  if (a >= 1e9) return `${nf(digits, digits).format(x / 1e9)} Mrd.`;
  if (a >= 1e6) return `${nf(1, 1).format(x / 1e6)} Mio.`;
  if (a >= 1e4) return `${nf(1, 1).format(x / 1e3)} Tsd.`;
  return nf(0, 0).format(z(x, 0));
}

export function fmtInt(x: number | null | undefined): string {
  return isNum(x) ? nf(0, 0).format(z(x, 0)) : DASH;
}

/** Vorzeichen-Klasse für Kursfarben. */
export function tone(x: number | null | undefined): "up" | "down" | "flat" {
  if (!isNum(x) || x === 0) return "flat";
  return x > 0 ? "up" : "down";
}

export function arrow(x: number | null | undefined): string {
  if (!isNum(x) || x === 0) return " ";
  return x > 0 ? "▲" : "▼";
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

function toDate(x: string | number | Date): Date {
  if (x instanceof Date) return x;
  if (typeof x === "number") return new Date(x * 1000);
  // Reines Datum als lokales Datum interpretieren, nicht als UTC-Mitternacht
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) {
    const [y, m, d] = x.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(x);
}

export function fmtDate(x: string | number | Date | null | undefined): string {
  if (x === null || x === undefined || x === "") return DASH;
  const d = toDate(x);
  return Number.isNaN(d.getTime()) ? DASH : dateFmt.format(d);
}

export function fmtShortDate(x: string | number | Date | null | undefined): string {
  if (x === null || x === undefined || x === "") return DASH;
  const d = toDate(x);
  return Number.isNaN(d.getTime()) ? DASH : shortDateFmt.format(d);
}

export function fmtTime(x: string | number | Date | null | undefined): string {
  if (x === null || x === undefined || x === "") return DASH;
  const d = toDate(x);
  return Number.isNaN(d.getTime()) ? DASH : timeFmt.format(d);
}

export function fmtWeekday(x: string | number | Date): string {
  const d = toDate(x);
  return Number.isNaN(d.getTime()) ? DASH : weekdayFmt.format(d);
}

/**
 * ISO-Datum um `months` Monate zurück, mit Monatsende-Begrenzung: 31.03. − 1M = 28.02.
 * (Date.setUTCMonth liefe über: 31.03. − 1M = 03.03.)
 */
export function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = m - 1 - months;
  const lastDay = new Date(Date.UTC(y, target + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, target, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/** "vor 5 Min." / "14:32" / "28.10." je nach Alter. */
export function fmtAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return DASH;
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 60) return "gerade";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  const d = new Date(t);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return timeFmt.format(d);
  return shortDateFmt.format(d);
}

export function isToday(iso: string, now = Date.now()): boolean {
  return new Date(iso).toDateString() === new Date(now).toDateString();
}

/** Ticker ohne Börsensuffix für kompakte Anzeige: NWND.US -> NWND US */
export function displayTicker(t: string): string {
  const i = t.lastIndexOf(".");
  return i > 0 ? `${t.slice(0, i)} ${t.slice(i + 1)}` : t;
}

/**
 * Externe Links aus Fremddaten (EODHD) nur als http(s): "www.sap.com" wird ergänzt,
 * alles andere (javascript:, relative Pfade) verworfen.
 */
export function safeUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
  return null;
}

const HTML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Für HTML-Tooltips (ECharts): Namen aus Fremddaten nicht als Markup interpretieren. */
export function escapeHtml(s: string | null | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}
