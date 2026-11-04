// Funktionskürzel und Befehlszeilen-Parser.

import { displayTicker } from "./format";

export type FnCode =
  | "GP" | "DES" | "HP" | "FA" | "ERN" | "DVD" | "ANR" | "CN"
  | "TOP" | "WEI" | "FX" | "CMDT" | "GC" | "SPRD" | "ECO" | "ECST"
  | "EQS" | "IMAP" | "MOST" | "W" | "HELP" | "EVTS" | "RV" | "BRIEF" | "ASK" | "PORT" | "RISK" | "ALRT" | "TPO" | "WMAP" | "FWD";

export type FnGroup = "Aktie" | "Makro" | "Screener" | "News" | "KI" | "Depot" | "System";

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
  { code: "RV", title: "Peer-Vergleich", group: "Aktie", needsTicker: true, desc: "Bewertung und Performance gegenüber Branchen-Peers" },
  { code: "TPO", title: "Market Profile", group: "Aktie", needsTicker: true, desc: "Market Profile je Handelstag (30-Minuten-Buchstaben) oder Volumen je Preisstufe, mit POC, Value Area und erster Stunde" },
  { code: "TOP", title: "News-Terminal", group: "News", needsTicker: false, desc: "Nachrichtenstrom mit Filtern, Suche und Leseansicht" },
  { code: "EVTS", title: "Earnings-Kalender", group: "News", needsTicker: false, desc: "Quartalszahlen aller Unternehmen nach Termin, mit Schätzung und Ergebnis" },
  { code: "BRIEF", title: "Morgenbriefing", group: "KI", needsTicker: false, desc: "KI-Zusammenfassung: Märkte, Ihre Werte, Termine heute, Zinsen und Devisen – mit Quellen" },
  { code: "ASK", title: "KI-Assistent", group: "KI", needsTicker: false, desc: "Fragen an die KI; sie liest nur Terminal-Daten und zeigt, welche Daten sie genutzt hat" },
  { code: "WMAP", title: "Weltkarte", group: "Makro", needsTicker: false, desc: "Länder eingefärbt nach Aktienmarkt, Zinsen oder Konjunktur, mit Rangliste" },
  { code: "FWD", title: "Terminkurse", group: "Makro", needsTicker: false, desc: "Devisen-Terminkurse, Kosten der Währungsabsicherung und eingepreiste künftige Zinsen (berechnet)" },
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
  { code: "PORT", title: "Depot", group: "Depot", needsTicker: false, desc: "Eigene Positionen: Wert, Ergebnis heute und seit Kauf, Aufteilung; Positionen eintragen, CSV-Import" },
  { code: "RISK", title: "Depot-Risiko", group: "Depot", needsTicker: false, desc: "Schwankung, Beta, größter Rückgang, Value at Risk, Risikobeitrag je Position, Korrelationen" },
  { code: "ALRT", title: "Kursalarme", group: "Depot", needsTicker: false, desc: "Alarme bei Kursmarken und Tagesbewegungen; Kursmarken im Chart mit ＋ Marke setzen" },
  { code: "W", title: "Watchlist", group: "System", needsTicker: false, desc: "Eigene Werte mit laufenden Kursen" },
  { code: "HELP", title: "Hilfe", group: "System", needsTicker: false, desc: "Befehle und Tastenkürzel" },
];

export const FN: Record<FnCode, FnInfo> = Object.fromEntries(FUNCTIONS.map((f) => [f.code, f])) as Record<FnCode, FnInfo>;

const ALIASES: Record<string, FnCode> = {
  N: "TOP", NEWS: "TOP", NI: "TOP", G: "GP", CHART: "GP", WCRS: "FX", FXC: "FX", GLCO: "CMDT",
  CAL: "ECO", KALENDER: "ECO", SCREENER: "EQS", SCRN: "EQS", HEAT: "IMAP", HEATMAP: "IMAP",
  MOV: "MOST", WATCH: "W", WL: "W", HILFE: "HELP", "?": "HELP", EE: "ERN", BDVD: "DVD",
  CURVE: "GC", YC: "GC", SPREAD: "SPRD", ECOST: "ECST", EARN: "EVTS", ERNCAL: "EVTS", PEERS: "RV", COMP: "RV",
  // Deutsche und englische Wörter, wie Einsteiger sie tippen
  WATCHLIST: "W", BEOBACHTUNGSLISTE: "W", KURSCHART: "GP", KURS: "GP", GRAFIK: "GP", DIVIDENDE: "DVD", DIVIDENDEN: "DVD",
  DIVIDEND: "DVD", BESCHREIBUNG: "DES", PROFIL: "DES", FIRMA: "DES", FINANZEN: "FA", BILANZ: "FA", ZAHLEN: "FA",
  HISTORIE: "HP", KURSE: "HP", ANALYSTEN: "ANR", KURSZIEL: "ANR", NACHRICHTEN: "TOP", MELDUNGEN: "TOP",
  QUARTALSZAHLEN: "EVTS", TERMINE: "ECO", WIRTSCHAFT: "ECO", ZINSEN: "GC", ZINSKURVE: "GC", DEVISEN: "FX",
  WAEHRUNGEN: "FX", "WÄHRUNGEN": "FX", ROHSTOFFE: "CMDT", INDIZES: "WEI", "LÄNDER": "ECST", LAENDER: "ECST",
  VERGLEICH: "RV", BEWEGUNGEN: "MOST", GEWINNER: "MOST",
  KI: "ASK", AI: "ASK", FRAGE: "ASK", FRAGEN: "ASK", AGENT: "ASK", CHAT: "ASK", ASSISTENT: "ASK",
  DEPOT: "PORT", PORTFOLIO: "PORT", POSITIONEN: "PORT", PRTU: "PORT", BESTAND: "PORT",
  RISIKO: "RISK", VAR: "RISK", PORTRISK: "RISK",
  TERMIN: "FWD", TERMINKURSE: "FWD", FORWARD: "FWD", FORWARDS: "FWD", FRD: "FWD", FXFA: "FWD", ABSICHERUNG: "FWD", HEDGE: "FWD",
  KARTE: "WMAP", WELTKARTE: "WMAP", MAP: "WMAP", WORLD: "WMAP", WELT: "WMAP", LAENDERKARTE: "WMAP",
  MP: "TPO", MKTP: "TPO", MARKETPROFILE: "TPO", MARKTPROFIL: "TPO", VOLUMENPROFIL: "TPO", VOLUMEPROFILE: "TPO", VPRO: "TPO",
  ALARM: "ALRT", ALARME: "ALRT", ALERT: "ALRT", ALERTS: "ALRT", KURSALARM: "ALRT", MARKEN: "ALRT", KURSMARKEN: "ALRT",
  BRIEFING: "BRIEF", MORGEN: "BRIEF", MORGENBRIEFING: "BRIEF", MORNING: "BRIEF", BRIEFUNG: "BRIEF",
};

const BBG_EXCHANGES: Record<string, string> = {
  US: "US", UN: "US", UW: "US", UQ: "US", GR: "XETRA", GY: "XETRA", GF: "F", LN: "LSE", FP: "PA",
  NA: "AS", BB: "BR", SW: "SW", SE: "SW", IM: "MI", SM: "MC", JT: "TSE", JP: "TSE", HK: "HK",
  CN: "TO", CT: "TO", AU: "AU", SS: "ST", DC: "CO", NO: "OL", FH: "HE",
};

const VALID = /^[A-Z0-9][A-Z0-9\-_=^&]{0,24}\.[A-Z0-9]{1,10}$/;

// Gelbe Bloomberg-Tasten und Indexkürzel (wie services/tickers.py)
const YELLOW_KEYS: Record<string, string> = { INDEX: "INDX", CURNCY: "FOREX", GOVT: "GBOND", COMDTY: "COMM" };
const INDEX_ALIASES: Record<string, string> = {
  SPX: "GSPC", INDU: "DJI", CCMP: "IXIC", NDX: "NDX", RTY: "RUT", SPTSX: "GSPTSE", DAX: "GDAXI", MDAX: "MDAXI",
  SX5E: "STOXX50E", CAC: "FCHI", UKX: "FTSE", SMI: "SSMI", NKY: "N225", HSI: "HSI", AS51: "AXJO", VIX: "VIX",
};

const COMDTY_ALIASES: Record<string, string> = {
  CL1: "WTI", CO1: "BRENT", GC1: "GOLD", SI1: "SILVER", NG1: "NATGAS", HG1: "COPPER", W1: "WHEAT",
  C1: "CORN", S1: "SOY", KC1: "COFFEE", SB1: "SUGAR", PL1: "PLAT", PA1: "PALL", LA1: "ALU",
};

/** Wie services/tickers.py: "sap gr" -> "SAP.XETRA", "aapl" -> "AAPL.US", "dax index" -> "GDAXI.INDX". */
export function normalizeTicker(raw: string): string | null {
  let s = raw.trim().toUpperCase().replace(/\s+EQUITY$/, "");
  // Bloomberg schreibt einbuchstabige Rohstoff-Generika mit Leerzeichen: "W 1 Comdty" = W1
  s = s.replace(/^([A-Z]{1,2})\s+(\d)\s+COMDTY$/, "$1$2 COMDTY");
  if (!s) return null;
  const m = /^(\S+)\s+(INDEX|CURNCY|GOVT|COMDTY)$/.exec(s);
  if (m && !m[1].includes(".")) {
    const aliases = m[2] === "INDEX" ? INDEX_ALIASES : m[2] === "COMDTY" ? COMDTY_ALIASES : null;
    const code = aliases && Object.prototype.hasOwnProperty.call(aliases, m[1]) ? aliases[m[1]] : m[1];
    s = `${code}.${m[2] === "CURNCY" && code.includes("-") ? "CC" : YELLOW_KEYS[m[2]]}`;
  }
  const parts = s.split(/\s+/);
  if (parts.length === 2 && !parts[0].includes(".")) s = `${parts[0]}.${BBG_EXCHANGES[parts[1]] || parts[1]}`;
  else if (parts.length > 2) return null;
  if (!s.includes(".")) s = `${s}.US`;
  s = s.replace(/^GB(\d+[MY])\.GBOND$/, "UK$1.GBOND"); // GB10Y wie UK10Y
  return VALID.test(s) ? s : null;
}

export function resolveFn(token: string): FnCode | null {
  const t = token.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(FN, t)) return t as FnCode;
  return Object.prototype.hasOwnProperty.call(ALIASES, t) ? ALIASES[t] : null;
}

/** Editierdistanz mit Vertauschung benachbarter Zeichen (HLEP -> HELP = 1). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Funktion mit Tippfehler-Abstand 1 zu ``token`` (ab drei Zeichen), sonst null. */
export function nearestFn(token: string): FnCode | null {
  const t = token.toUpperCase();
  if (t.length < 3 || resolveFn(t)) return null;
  const hit = FUNCTIONS.find((f) => distance(t, f.code) === 1);
  return hit ? hit.code : null;
}

/**
 * Meldung für ein unbekanntes Wertpapier im Bloomberg-Format. Vorschläge des Backends
 * ("Meinten Sie: HRVS.US, …") werden in Anzeigekürzel übersetzt; sieht die Eingabe wie eine
 * vertippte Funktion aus, steht diese vorn.
 */
export function unknownSecurityMessage(input: string, ticker: string, serverMessage?: string): string {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const fn = tokens.length === 1 ? nearestFn(tokens[0]) : null;
  const m = /Meinten Sie:\s*([^?]+)\?/.exec(serverMessage ?? "");
  const near = m ? m[1].split(",").map((x) => x.trim()).filter(Boolean).map(displayTicker) : [];
  const parts = [fn ? `„${tokens[0]}“ ist weder Funktion noch Wertpapier. Meinten Sie ${fn}?` : `Unbekanntes Wertpapier ${displayTicker(ticker)}.`];
  if (near.length) parts.push(`${fn ? "Wertpapiere" : "Meinten Sie"}: ${near.join(", ")}`);
  return parts.join(" ");
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
  // "NWND US GPP": gültiger Ticker, aber unbekannte Funktion am Ende
  if (tokens.length >= 2 && /^[A-Z]{2,5}$/i.test(last)) {
    const head = normalizeTicker(tokens.slice(0, -1).join(" "));
    const whole = normalizeTicker(raw);
    if (head && (!whole || tokens.length >= 3)) {
      const near = nearestFn(last);
      return {
        kind: "error",
        message: `Unbekannte Funktion „${last.toUpperCase()}“.${near ? ` Meinten Sie ${near}?` : ""} HELP zeigt alle Funktionen.`,
      };
    }
  }
  const t = normalizeTicker(raw);
  if (!t) return { kind: "error", message: `„${raw}“ ist weder Funktion noch Ticker.` };
  return { kind: "ticker", ticker: t };
}
