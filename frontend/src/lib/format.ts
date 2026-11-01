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

/** Kurs: zwei Nachkommastellen, unter 1 vier. Devisenpaare über `ticker` mit Devisenschreibweise. */
/** Nachkommastellen eines Kurses: Devisen in Pips (EUR/USD 5, USD/JPY 3), sonst 2 bzw. 4 unter 1. */
export function priceDigits(x: number, ticker?: string | null): number {
  const a = Math.abs(x);
  if (ticker && ticker.endsWith(".FOREX")) return a >= 20 ? 3 : 5;
  return a >= 1 ? 2 : 4;
}

export function fmtPrice(x: number | null | undefined, ticker?: string | null): string {
  if (!isNum(x)) return DASH;
  const d = priceDigits(x, ticker);
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

/** Gewinn je Aktie: unter 1 mit drei Stellen, sonst verdeckt die Rundung die Abweichung. */
export function fmtEps(x: number | null | undefined): string {
  return fmt(x, isNum(x) && Math.abs(x) < 1 ? 3 : 2);
}

/** Nötige Nachkommastellen für Beträge je Aktie: zwei, bei krummen Beträgen bis zu vier. */
export function perShareDigits(x: number | null | undefined): number {
  if (!isNum(x)) return 2;
  for (const d of [2, 3]) if (Math.abs(x * 10 ** d - Math.round(x * 10 ** d)) < 1e-6) return d;
  return 4;
}

/** Beträge je Aktie (Dividenden); ``digits`` für einheitliche Spalten (siehe perShareDigits). */
export function fmtPerShare(x: number | null | undefined, digits?: number): string {
  if (!isNum(x)) return DASH;
  return fmt(x, digits ?? perShareDigits(x));
}

/** Basispunkte aus Prozentpunkten (0.05 -> +5 bp). */
export function fmtBp(x: number | null | undefined, fromPercent = true): string {
  if (!isNum(x)) return DASH;
  const bp = fromPercent ? x * 100 : x;
  const r = Math.round(bp);
  return r === 0 ? "0 bp" : `${nf(0, 0, true).format(r)} bp`;
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
/** Farbe einer Veränderung; mit ``digits`` gilt ein auf null gerundeter Wert als unverändert. */
export function tone(x: number | null | undefined, digits?: number): "up" | "down" | "flat" {
  if (!isNum(x) || x === 0) return "flat";
  if (digits !== undefined && Math.round(Math.abs(x) * 10 ** digits) === 0) return "flat";
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

/** Einheitliche Zeitspalte: heute "14:32", sonst "28.10.". */
export function fmtStamp(x: string | null | undefined, now = Date.now()): string {
  if (!x) return DASH;
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) {
    const today = new Date(now);
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return x === iso ? "heute" : shortDateFmt.format(toDate(x));
  }
  const d = toDate(x);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toDateString() === new Date(now).toDateString() ? timeFmt.format(d) : shortDateFmt.format(d);
}

/**
 * Ist der letzte Tagesbalken (Datum ``lastDate``) noch im Entstehen? Ja, wenn der Kurs gerade
 * aktualisiert wird (Zeitstempel jünger als 30 Minuten) und vom selben Tag stammt.
 */
export function isLiveBar(lastDate: string | undefined, quoteTs: string | null | undefined, now = Date.now()): boolean {
  if (!lastDate || !quoteTs) return false;
  const ts = new Date(quoteTs);
  if (Number.isNaN(ts.getTime())) return false;
  return now - ts.getTime() < 30 * 60_000 && ts.toISOString().slice(0, 10) === lastDate;
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

// EODHD-Börse -> Bloomberg-Schreibweise für die Anzeige (Eingabe akzeptiert beides)
const BBG_DISPLAY: Record<string, string> = {
  US: "US", XETRA: "GR", F: "GF", LSE: "LN", PA: "FP", AS: "NA", BR: "BB", SW: "SW", MI: "IM", MC: "SM",
  TSE: "JT", HK: "HK", TO: "CN", AU: "AU", ST: "SS", CO: "DC", OL: "NO", HE: "FH",
  INDX: "Index", FOREX: "Curncy", CC: "Curncy", GBOND: "Govt", COMM: "Comdty",
};

// Bloomberg-Indexkürzel für die Anzeige (Umkehrung von INDEX_ALIASES in commands.ts)
const INDEX_DISPLAY: Record<string, string> = {
  GSPC: "SPX", DJI: "INDU", IXIC: "CCMP", RUT: "RTY", GSPTSE: "SPTSX", GDAXI: "DAX", MDAXI: "MDAX",
  STOXX50E: "SX5E", FCHI: "CAC", FTSE: "UKX", SSMI: "SMI", N225: "NKY", AXJO: "AS51",
};

/** Ticker in Terminal-Schreibweise: NWND.US -> "NWND US", SAP.XETRA -> "SAP GR", GDAXI.INDX -> "DAX Index". */
export function displayTicker(t: string): string {
  const i = t.lastIndexOf(".");
  if (i <= 0) return t;
  const exch = t.slice(i + 1);
  const code = t.slice(0, i);
  const shown = exch === "INDX" && Object.prototype.hasOwnProperty.call(INDEX_DISPLAY, code) ? INDEX_DISPLAY[code] : code;
  return `${shown} ${BBG_DISPLAY[exch] ?? exch}`;
}

/** Aktie (mit Fundamentaldaten) oder anderes Instrument (Index, Devise, Anleihe, Rohstoff)? */
export function isEquity(t: string | null | undefined): boolean {
  return !!t && !/\.(INDX|FOREX|CC|GBOND|COMM)$/.test(t);
}

const SECTOR_DE: Record<string, string> = {
  Technology: "Technologie", Healthcare: "Gesundheit", "Financial Services": "Finanzen",
  "Consumer Cyclical": "Zykl. Konsum", "Consumer Defensive": "Basiskonsum", Energy: "Energie",
  Utilities: "Versorger", Industrials: "Industrie", "Communication Services": "Kommunikation",
  "Basic Materials": "Grundstoffe", "Real Estate": "Immobilien",
};

/** Sektornamen der Datenquelle (englisch) für die Anzeige übersetzen. */
export function sectorDe(s: string | null | undefined): string {
  return s ? SECTOR_DE[s] ?? s : DASH;
}

// Häufige Branchen der EODHD-Klassifikation; unbekannte bleiben im Original
const INDUSTRY_DE: Record<string, string> = {
  "Aerospace & Defense": "Luft- und Raumfahrt, Verteidigung",
  "Asset Management": "Vermögensverwaltung",
  "Auto Manufacturers": "Automobilhersteller",
  "Auto Parts": "Autozulieferer",
  "Banks—Diversified": "Universalbanken",
  "Banks—Regional": "Regionalbanken",
  "Biotechnology": "Biotechnologie",
  "Building Products & Equipment": "Baustoffe und -ausrüstung",
  "Chemicals": "Chemie",
  "Communication Equipment": "Kommunikationstechnik",
  "Consumer Electronics": "Unterhaltungselektronik",
  "Credit Services": "Kreditdienstleistungen",
  "Diagnostics & Research": "Diagnostik und Forschung",
  "Drug Manufacturers—General": "Pharma",
  "Electronic Gaming & Multimedia": "Spiele und Multimedia",
  "Entertainment": "Unterhaltung",
  "Gold": "Gold",
  "Grocery Stores": "Lebensmittelhandel",
  "Household & Personal Products": "Haushalts- und Körperpflege",
  "Information Technology Services": "IT-Dienstleistungen",
  "Insurance—Diversified": "Versicherungen (diversifiziert)",
  "Insurance—Property & Casualty": "Sachversicherungen",
  "Integrated Freight & Logistics": "Logistik",
  "Internet Content & Information": "Internetinhalte",
  "Internet Retail": "Onlinehandel",
  "Luxury Goods": "Luxusgüter",
  "Medical Devices": "Medizintechnik",
  "Oil & Gas Integrated": "Öl und Gas (integriert)",
  "Other Industrial Metals & Mining": "Industriemetalle und Bergbau",
  "Packaged Foods": "Nahrungsmittel",
  "REIT—Industrial": "REIT Gewerbeimmobilien",
  "Real Estate Services": "Immobiliendienstleistungen",
  "Scientific & Technical Instruments": "Mess- und Prüftechnik",
  "Semiconductor Equipment & Materials": "Halbleiterausrüstung",
  "Semiconductors": "Halbleiter",
  "Software—Application": "Anwendungssoftware",
  "Software—Infrastructure": "Infrastruktursoftware",
  "Specialty Chemicals": "Spezialchemie",
  "Specialty Industrial Machinery": "Maschinenbau",
  "Specialty Retail": "Fachhandel",
  "Telecom Services": "Telekommunikation",
  "Utilities—Diversified": "Versorger (diversifiziert)",
  "Utilities—Regulated Electric": "Stromversorger",
  "Utilities—Renewable": "Erneuerbare Energien",
};

const COUNTRY_DE: Record<string, string> = {
  Germany: "Deutschland", "United Kingdom": "Großbritannien", Switzerland: "Schweiz", France: "Frankreich",
  Netherlands: "Niederlande", "United States": "USA", USA: "USA", Japan: "Japan", Italy: "Italien", Spain: "Spanien",
  Belgium: "Belgien", Sweden: "Schweden", Denmark: "Dänemark", Norway: "Norwegen", Finland: "Finnland",
  Austria: "Österreich", Ireland: "Irland", Canada: "Kanada", Australia: "Australien", China: "China",
  "Hong Kong": "Hongkong", Luxembourg: "Luxemburg", Portugal: "Portugal", Taiwan: "Taiwan", "South Korea": "Südkorea",
};

const TYPE_DE: Record<string, string> = {
  "Common Stock": "Aktie", "Preferred Stock": "Vorzugsaktie", ETF: "ETF", FUND: "Fonds", Fund: "Fonds", INDEX: "Index",
  Index: "Index", Currency: "Devisen", FOREX: "Devisen", Bond: "Anleihe", BOND: "Anleihe", Commodity: "Rohstoff",
};

/** Wertpapierart auf Deutsch ("Common Stock" -> "Aktie"). */
export function typeDe(s: string | null | undefined): string {
  return s ? (Object.prototype.hasOwnProperty.call(TYPE_DE, s) ? TYPE_DE[s] : s) : "";
}

export function countryDe(s: string | null | undefined): string {
  return s ? (Object.prototype.hasOwnProperty.call(COUNTRY_DE, s) ? COUNTRY_DE[s] : s) : DASH;
}

const EXCHANGE_NAMES: Record<string, string> = {
  US: "USA", NASDAQ: "Nasdaq", NYSE: "NYSE", "NYSE ARCA": "NYSE Arca", XETRA: "Xetra", F: "Frankfurt",
  LSE: "London", PA: "Euronext Paris", AS: "Euronext Amsterdam", BR: "Euronext Brüssel", SW: "SIX Swiss",
  MI: "Borsa Italiana", MC: "Madrid", TO: "Toronto", HK: "Hongkong", KO: "Korea", AU: "ASX",
};

/** Börsenname für die Anzeige (EODHD-Kürzel wie XETRA oder SW werden ausgeschrieben). */
export function exchangeName(s: string | null | undefined): string {
  return s ? (Object.prototype.hasOwnProperty.call(EXCHANGE_NAMES, s) ? EXCHANGE_NAMES[s] : s) : DASH;
}

export function industryDe(s: string | null | undefined): string {
  return s ? (Object.prototype.hasOwnProperty.call(INDUSTRY_DE, s) ? INDUSTRY_DE[s] : s) : DASH;
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
