// Funktionskürzel und Befehlszeilen-Parser.

export type FnCode =
  | "GP" | "DES" | "HP" | "FA" | "ERN" | "DVD" | "ANR" | "CN"
  | "TOP" | "WEI" | "FX" | "CMDT" | "GC" | "SPRD" | "ECO" | "ECST"
  | "EQS" | "IMAP" | "MOST" | "W" | "HELP";

export type FnGroup = "Aktie" | "Makro" | "Screener" | "News" | "System";

export interface FnInfo {
  code: FnCode;
  title: string;
  group: FnGroup;
  needsTicker: boolean;
  desc: string;
}

export const FUNCTIONS: FnInfo[] = [
  { code: "GP", title: "Kurschart", group: "Aktie", needsTicker: true, desc: "Candlestick-Chart mit Volumen, Zeiträumen und Durchschnitten" },
  { code: "DES", title: "Beschreibung", group: "Aktie", needsTicker: true, desc: "Firmenprofil, Kennzahlen, Management" },
  { code: "HP", title: "Kurshistorie", group: "Aktie", needsTicker: true, desc: "Tageskurse als Tabelle" },
  { code: "FA", title: "Finanzanalyse", group: "Aktie", needsTicker: true, desc: "GuV, Bilanz, Cashflow – jährlich oder quartalsweise" },
  { code: "ERN", title: "Earnings", group: "Aktie", needsTicker: true, desc: "Gewinn je Aktie: Ist vs. Schätzung, nächster Termin" },
  { code: "DVD", title: "Dividenden", group: "Aktie", needsTicker: true, desc: "Dividendenhistorie, Rendite, Splits" },
  { code: "ANR", title: "Analysten", group: "Aktie", needsTicker: true, desc: "Empfehlungen und Kursziel" },
  { code: "CN", title: "Firmen-News", group: "Aktie", needsTicker: true, desc: "Nachrichten zum Wertpapier" },
  { code: "TOP", title: "News-Terminal", group: "News", needsTicker: false, desc: "Nachrichtenstrom mit Filtern, Suche und Leseansicht" },
  { code: "WEI", title: "Weltindizes", group: "Makro", needsTicker: false, desc: "Aktienindizes weltweit" },
  { code: "FX", title: "Devisen", group: "Makro", needsTicker: false, desc: "Währungspaare und Stärke-Ranking" },
  { code: "CMDT", title: "Rohstoffe", group: "Makro", needsTicker: false, desc: "Energie, Metalle, Agrar" },
  { code: "GC", title: "Zinskurven", group: "Makro", needsTicker: false, desc: "Staatsanleihen-Kurven, heute vs. −1M / −1J" },
  { code: "SPRD", title: "Zinsspreads", group: "Makro", needsTicker: false, desc: "2J/10J und Länderspreads in Basispunkten" },
  { code: "ECO", title: "Wirtschaftskalender", group: "Makro", needsTicker: false, desc: "Termine mit Ist, Prognose, Überraschung" },
  { code: "ECST", title: "Länderdaten", group: "Makro", needsTicker: false, desc: "BIP, Inflation, Arbeitslosigkeit, Schulden" },
  { code: "EQS", title: "Aktien-Screener", group: "Screener", needsTicker: false, desc: "Filtern nach Bewertung, Dividende, Momentum" },
  { code: "IMAP", title: "Markt-Heatmap", group: "Screener", needsTicker: false, desc: "Tagesveränderung nach Sektor und Größe" },
  { code: "MOST", title: "Top-Bewegungen", group: "Screener", needsTicker: false, desc: "Gewinner, Verlierer, meistgehandelt" },
  { code: "W", title: "Watchlist", group: "System", needsTicker: false, desc: "Eigene Werte mit laufenden Kursen" },
  { code: "HELP", title: "Hilfe", group: "System", needsTicker: false, desc: "Befehle und Tastenkürzel" },
];

export const FN: Record<FnCode, FnInfo> = Object.fromEntries(FUNCTIONS.map((f) => [f.code, f])) as Record<FnCode, FnInfo>;

const ALIASES: Record<string, FnCode> = {
  N: "TOP", NEWS: "TOP", NI: "TOP", G: "GP", CHART: "GP", WCRS: "FX", FXC: "FX", GLCO: "CMDT",
  CAL: "ECO", KALENDER: "ECO", SCREENER: "EQS", SCRN: "EQS", HEAT: "IMAP", HEATMAP: "IMAP",
  MOV: "MOST", WATCH: "W", WL: "W", HILFE: "HELP", "?": "HELP", EE: "ERN", BDVD: "DVD",
  CURVE: "GC", YC: "GC", SPREAD: "SPRD", ECOST: "ECST",
};

const BBG_EXCHANGES: Record<string, string> = {
  US: "US", UN: "US", UW: "US", UQ: "US", GR: "XETRA", GY: "XETRA", GF: "F", LN: "LSE", FP: "PA",
  NA: "AS", BB: "BR", SW: "SW", SE: "SW", IM: "MI", SM: "MC", JT: "TSE", JP: "TSE", HK: "HK",
  CN: "TO", CT: "TO", AU: "AU", SS: "ST", DC: "CO", NO: "OL", FH: "HE",
};

const VALID = /^[A-Z0-9][A-Z0-9\-_=^&]{0,24}\.[A-Z0-9]{1,10}$/;

/** Wie services/tickers.py: "sap gr" -> "SAP.XETRA", "aapl" -> "AAPL.US". */
export function normalizeTicker(raw: string): string | null {
  let s = raw.trim().toUpperCase().replace(/\s+(EQUITY|INDEX|CURNCY|COMDTY|GOVT)$/, "");
  if (!s) return null;
  const parts = s.split(/\s+/);
  if (parts.length === 2 && !parts[0].includes(".")) s = `${parts[0]}.${BBG_EXCHANGES[parts[1]] || parts[1]}`;
  else if (parts.length > 2) return null;
  if (!s.includes(".")) s = `${s}.US`;
  return VALID.test(s) ? s : null;
}

export function resolveFn(token: string): FnCode | null {
  const t = token.toUpperCase();
  if (t in FN) return t as FnCode;
  return ALIASES[t] ?? null;
}

export type Command =
  | { kind: "fn"; fn: FnCode; ticker: string | null }
  | { kind: "ticker"; ticker: string }
  | { kind: "error"; message: string };

/**
 * Akzeptiert: "GP", "NWND GP", "NWND US GP", "ELBT GR DES", "NWND.US", "ELBT GR".
 * Ein Ticker allein wechselt das aktive Wertpapier.
 */
export function parseCommand(input: string): Command | null {
  // "<GO>" bzw. ein abschließendes, eigenständiges "GO" entfernen – nicht das Ende eines
  // Tickers wie WGO oder AGO (sonst würde daraus W bzw. A)
  const raw = input.trim().replace(/(?:<GO>?|(?:^|\s)GO)$/i, "").trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  const last = tokens[tokens.length - 1];
  const fn = resolveFn(last);
  if (fn) {
    const rest = tokens.slice(0, -1).join(" ");
    if (!rest) return { kind: "fn", fn, ticker: null };
    const t = normalizeTicker(rest);
    if (!t) return { kind: "error", message: `Ticker „${rest}“ nicht erkannt.` };
    return { kind: "fn", fn, ticker: t };
  }
  const t = normalizeTicker(raw);
  if (!t) return { kind: "error", message: `„${raw}“ ist weder Funktion noch Ticker.` };
  return { kind: "ticker", ticker: t };
}
