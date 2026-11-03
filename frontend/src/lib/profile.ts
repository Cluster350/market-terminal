// Volumenprofil und Market Profile (TPO) aus Kerzen.
//
// Volumenprofil: Das Volumen jeder Kerze wird gleichmäßig über ihre Spanne (Tief bis Hoch) auf
// Preisstufen verteilt – bei 5-Minuten-Kerzen sehr genau, bei Tageskerzen eine Schätzung.
// Market Profile: Jeder 30-Minuten-Abschnitt einer Sitzung bekommt einen Buchstaben (A, B, C …),
// der auf jeder Preisstufe steht, die in diesem Abschnitt gehandelt wurde (Time Price Opportunity).
// Value Area: die Preisstufen rund um den POC mit 70 % des Volumens bzw. der TPOs.

export interface Candle {
  t: number; // Unix-Sekunden (Intraday) oder fortlaufende Nummer (Tageskerzen)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface Level {
  price: number; // Untergrenze der Preisstufe
  volume: number;
  up: number; // Volumen aus steigenden Kerzen (Schluss ≥ Eröffnung)
  down: number;
}

export interface Profile {
  step: number;
  levels: Level[]; // aufsteigend nach Preis
  total: number;
  pocIndex: number;
  vaLow: number; // Index der untersten Stufe der Value Area
  vaHigh: number;
  poc: number; // Mitte der POC-Stufe
  vah: number; // Obergrenze der Value Area
  val: number; // Untergrenze der Value Area
}

export const VALUE_AREA = 0.7;
export const TPO_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Runde Schrittweite: 1, 2, 2,5 oder 5 mal einer Zehnerpotenz. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * p;
}

function decimals(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step)) + 2);
}

/** Preisraster: Basis (Vielfaches der Schrittweite) und Anzahl Stufen für [lo, hi]. */
export function grid(lo: number, hi: number, step: number): { base: number; n: number; price: (i: number) => number; index: (p: number) => number } {
  const dec = decimals(step);
  const base = Number((Math.floor(lo / step + 1e-9) * step).toFixed(dec));
  const index = (p: number) => Math.max(0, Math.floor((p - base) / step + 1e-9));
  const n = index(hi) + 1;
  return { base, n, price: (i: number) => Number((base + i * step).toFixed(dec)), index };
}

/** Value Area: von der POC-Stufe aus jeweils die volumenstärkere Nachbarstufe hinzunehmen, bis 70 % erreicht sind. */
export function valueArea(values: number[], poc: number, share = VALUE_AREA): [number, number] {
  const total = values.reduce((a, b) => a + b, 0);
  let lo = poc;
  let hi = poc;
  let acc = values[poc] ?? 0;
  while (acc < share * total && (lo > 0 || hi < values.length - 1)) {
    const up = hi < values.length - 1 ? values[hi + 1] : -1;
    const dn = lo > 0 ? values[lo - 1] : -1;
    if (up >= dn) acc += values[++hi];
    else acc += values[--lo];
  }
  return [lo, hi];
}

/** Stufe mit dem höchsten Wert; bei Gleichstand die der Mitte nächstgelegene. */
export function pocIndex(values: number[], from = 0, to = values.length - 1): number {
  let best = -1;
  let bestVal = -Infinity;
  const mid = (from + to) / 2;
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (v > bestVal || (v === bestVal && Math.abs(i - mid) < Math.abs(best - mid))) {
      best = i;
      bestVal = v;
    }
  }
  return best;
}

/** Volumen einer Kerze anteilig auf die Stufen verteilen, die ihre Spanne überdeckt. */
function spread(c: Candle, g: ReturnType<typeof grid>, step: number, add: (i: number, v: number) => void) {
  const v = c.volume ?? 0;
  if (!(v > 0)) return;
  const i0 = g.index(c.low);
  const i1 = Math.min(g.index(c.high), g.n - 1);
  if (i0 >= i1 || c.high <= c.low) {
    add(i0, v);
    return;
  }
  const span = c.high - c.low;
  for (let i = i0; i <= i1; i++) {
    const bl = g.price(i);
    const overlap = Math.min(c.high, bl + step) - Math.max(c.low, bl);
    if (overlap > 0) add(i, (v * overlap) / span);
  }
}

function usable(c: Candle): boolean {
  return [c.open, c.high, c.low, c.close].every((x) => Number.isFinite(x)) && c.high >= c.low;
}

/** Volumenprofil über alle Kerzen (z. B. den sichtbaren Zeitraum im Chart). */
export function volumeProfile(candles: Candle[], opts: { rows?: number; step?: number } = {}): Profile | null {
  const cs = candles.filter((c) => usable(c) && (c.volume ?? 0) > 0);
  if (!cs.length) return null;
  const lo = Math.min(...cs.map((c) => c.low));
  const hi = Math.max(...cs.map((c) => c.high));
  const step = opts.step ?? niceStep(hi > lo ? (hi - lo) / (opts.rows ?? 48) : Math.abs(hi) * 0.001 || 1);
  const g = grid(lo, hi, step);
  const levels: Level[] = Array.from({ length: g.n }, (_, i) => ({ price: g.price(i), volume: 0, up: 0, down: 0 }));
  for (const c of cs) {
    const rising = c.close >= c.open;
    spread(c, g, step, (i, v) => {
      levels[i].volume += v;
      if (rising) levels[i].up += v;
      else levels[i].down += v;
    });
  }
  const vols = levels.map((l) => l.volume);
  const total = vols.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const poc = pocIndex(vols);
  const [vaLow, vaHigh] = valueArea(vols, poc);
  return {
    step, levels, total, pocIndex: poc, vaLow, vaHigh,
    poc: levels[poc].price + step / 2, vah: levels[vaHigh].price + step, val: levels[vaLow].price,
  };
}

// --- Sitzungen und Haupthandelszeit ------------------------------------------------------

interface SessionHours {
  tz: string;
  open: number; // Minuten nach Mitternacht (Ortszeit der Börse)
  close: number;
}

const HOURS: Record<string, SessionHours> = {
  US: { tz: "America/New_York", open: 570, close: 960 },
  XETRA: { tz: "Europe/Berlin", open: 540, close: 1050 },
  F: { tz: "Europe/Berlin", open: 480, close: 1320 },
  LSE: { tz: "Europe/London", open: 480, close: 990 },
  PA: { tz: "Europe/Paris", open: 540, close: 1050 },
  AS: { tz: "Europe/Amsterdam", open: 540, close: 1050 },
  BR: { tz: "Europe/Brussels", open: 540, close: 1050 },
  MI: { tz: "Europe/Rome", open: 540, close: 1050 },
  MC: { tz: "Europe/Madrid", open: 540, close: 1050 },
  SW: { tz: "Europe/Zurich", open: 540, close: 1050 },
  TSE: { tz: "Asia/Tokyo", open: 540, close: 930 },
  HK: { tz: "Asia/Hong_Kong", open: 570, close: 960 },
  TO: { tz: "America/Toronto", open: 570, close: 960 },
  AU: { tz: "Australia/Sydney", open: 600, close: 960 },
};

const INDEX_EXCHANGE: Record<string, string> = {
  GSPC: "US", NDX: "US", DJI: "US", RUT: "US", IXIC: "US", VIX: "US", GDAXI: "XETRA", MDAXI: "XETRA",
  STOXX50E: "PA", FCHI: "PA", FTSE: "LSE", SSMI: "SW", N225: "TSE", HSI: "HK", GSPTSE: "TO", AXJO: "AU",
};

/** Handelszeit der Börse (null: rund um die Uhr oder unbekannt). */
export function sessionHours(ticker: string): SessionHours | null {
  const dot = ticker.lastIndexOf(".");
  const code = ticker.slice(0, dot);
  const exch = ticker.slice(dot + 1);
  if (exch === "INDX") return HOURS[INDEX_EXCHANGE[code] ?? ""] ?? null;
  return HOURS[exch] ?? null;
}

/** Devisen und Krypto handeln rund um die Uhr: Sitzung = Kalendertag (UTC). */
export const isAllDay = (ticker: string) => /\.(FOREX|CC)$/.test(ticker);

const formatters = new Map<string, Intl.DateTimeFormat>();

function localMinutes(ts: number, tz: string): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    formatters.set(tz, f);
  }
  const parts = f.formatToParts(new Date(ts * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Nur Kerzen der Haupthandelszeit (ohne vor- und nachbörslichen Handel). */
export function regularOnly(candles: Candle[], ticker: string): Candle[] {
  const h = sessionHours(ticker);
  if (!h) return candles;
  return candles.filter((c) => {
    const m = localMinutes(c.t, h.tz);
    return m >= h.open && m < h.close;
  });
}

/** Kerzen in Sitzungen teilen: neue Sitzung nach einer Pause von über zwei Stunden (bzw. neuer UTC-Tag). */
export function splitSessions(candles: Candle[], allDay: boolean): Candle[][] {
  const out: Candle[][] = [];
  let cur: Candle[] = [];
  const day = (ts: number) => Math.floor(ts / 86400);
  for (const c of candles) {
    const prev = cur[cur.length - 1];
    if (prev && (c.t - prev.t > 2 * 3600 || (allDay && day(c.t) !== day(prev.t)))) {
      out.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) out.push(cur);
  return out;
}

// --- Market Profile (TPO) ----------------------------------------------------------------

export interface TpoSession {
  start: number; // Unix-Sekunden der ersten Kerze
  periods: number; // Anzahl 30-Minuten-Abschnitte
  letters: string[]; // je Preisstufe (gemeinsames Raster): Buchstaben in zeitlicher Reihenfolge
  volume: number[]; // je Preisstufe
  open: number;
  close: number;
  high: number;
  low: number;
  ibHigh: number;
  ibLow: number;
  totalVolume: number;
  tpoCount: number;
  lowIndex: number; // Raster-Index der tiefsten und höchsten gehandelten Stufe
  highIndex: number;
  pocIndex: number;
  vaLow: number;
  vaHigh: number;
  poc: number;
  vah: number;
  val: number;
  volPocIndex: number | null; // POC und Value Area nach Volumen (Volumen-Ansicht)
  volVaLow: number;
  volVaHigh: number;
}

export interface MarketProfile {
  step: number;
  base: number;
  n: number;
  price: (i: number) => number;
  sessions: TpoSession[];
}

export const PERIOD_MINUTES = 30;

/** Market Profile der letzten `count` Sitzungen auf einem gemeinsamen Preisraster. */
export function marketProfile(
  candles: Candle[],
  opts: { ticker: string; count: number; rowsPerSession?: number; regular?: boolean; step?: number },
): MarketProfile | null {
  let cs = candles.filter(usable);
  if (opts.regular !== false) cs = regularOnly(cs, opts.ticker);
  const sessions = splitSessions(cs, isAllDay(opts.ticker)).slice(-Math.max(1, opts.count));
  if (!sessions.length) return null;
  const lo = Math.min(...sessions.flat().map((c) => c.low));
  const hi = Math.max(...sessions.flat().map((c) => c.high));
  const ranges = sessions.map((s) => Math.max(...s.map((c) => c.high)) - Math.min(...s.map((c) => c.low)));
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length || Math.abs(hi) * 0.01 || 1;
  let step = opts.step ?? niceStep(avgRange / (opts.rowsPerSession ?? 24));
  if ((hi - lo) / step > 400) step = niceStep((hi - lo) / 400); // Darstellung begrenzen
  const g = grid(lo, hi, step);

  const out: TpoSession[] = sessions.map((s) => {
    const start = s[0].t;
    const letters: string[] = Array(g.n).fill("");
    const volume: number[] = Array(g.n).fill(0);
    let ibHigh = -Infinity;
    let ibLow = Infinity;
    let periods = 0;
    for (const c of s) {
      const k = Math.floor((c.t - start) / (PERIOD_MINUTES * 60));
      periods = Math.max(periods, k + 1);
      const ch = TPO_LETTERS[k % TPO_LETTERS.length];
      const i0 = g.index(c.low);
      const i1 = Math.min(g.index(c.high), g.n - 1);
      for (let i = i0; i <= i1; i++) if (!letters[i].endsWith(ch)) letters[i] += ch;
      spread(c, g, step, (i, v) => (volume[i] += v));
      if (k < 2) {
        ibHigh = Math.max(ibHigh, c.high);
        ibLow = Math.min(ibLow, c.low);
      }
    }
    const counts = letters.map((l) => l.length);
    const lowIndex = counts.findIndex((x) => x > 0);
    const highIndex = counts.length - 1 - [...counts].reverse().findIndex((x) => x > 0);
    const poc = pocIndex(counts, lowIndex, highIndex);
    const [vaLow, vaHigh] = valueArea(counts, poc);
    const totalVolume = volume.reduce((a, b) => a + b, 0);
    const volPoc = totalVolume > 0 ? pocIndex(volume, lowIndex, highIndex) : null;
    const [volVaLow, volVaHigh] = volPoc === null ? [vaLow, vaHigh] : valueArea(volume, volPoc);
    return {
      start, periods, letters, volume,
      open: s[0].open, close: s[s.length - 1].close,
      high: Math.max(...s.map((c) => c.high)), low: Math.min(...s.map((c) => c.low)),
      ibHigh, ibLow, totalVolume, tpoCount: counts.reduce((a, b) => a + b, 0),
      lowIndex, highIndex, pocIndex: poc, vaLow, vaHigh,
      poc: g.price(poc) + step / 2, vah: g.price(vaHigh) + step, val: g.price(vaLow),
      volPocIndex: volPoc, volVaLow, volVaHigh,
    };
  });
  return { step, base: g.base, n: g.n, price: g.price, sessions: out };
}
