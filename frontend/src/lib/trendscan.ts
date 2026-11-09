// Trend-Scanning (López de Prado, „Machine Learning for Asset Managers“ 2020, Kap. 5.4; umgesetzt wie
// ``trend_scanning_labels`` in mlfinlab von Hudson & Thames): Je Balken werden Geraden über verschiedene
// Fensterlängen gelegt; die Länge mit dem größten |t-Wert| der Steigung bestimmt den Trend.
//
// - vorwärts (Rückblick): der Trend, der auf den Balken FOLGTE – nutzt spätere Kurse, nur zur Darstellung
//   der Vergangenheit; die letzten ``window − 1`` Balken haben noch kein Ergebnis.
// - rückwärts (laufend): der Trend, der zum Balken HINFÜHRTE – nur frühere Kurse, auch heute gültig.
//
// Parameter wie mlfinlab: ``window`` (look_forward_window, Standard 20), ``minLen`` (min_sample_length, 5),
// ``step`` (1). Geprüft werden die Längen minLen, minLen+step, … < window (wie np.arange in mlfinlab).

export interface ScanPoint {
  /** t-Wert der Steigung (Vorzeichen = Richtung, Betrag = wie sauber der Trend ist); null = kein Ergebnis. */
  t: number | null;
  /** gewählte Fensterlänge in Balken */
  len: number | null;
  /** Kursveränderung über das Fenster (Anteil, 0.05 = +5 %) */
  ret: number | null;
  /** Index des anderen Fensterendes: vorwärts das Trendende (t1), rückwärts der Trendbeginn */
  other: number | null;
}

/** Größter angezeigter |t|-Wert (eine perfekte Gerade hätte unendlich). */
export const T_CAP = 999;

const EMPTY: ScanPoint = { t: null, len: null, ret: null, other: null };

/**
 * Trend-Scanning über eine Kursreihe (älteste zuerst).
 * Rechnet mit Abständen zum Ausgangskurs (numerisch stabil auch bei Kursen wie 160.000).
 */
export function trendScan(y: number[], direction: "forward" | "backward", window = 20, minLen = 5, step = 1): ScanPoint[] {
  const n = y.length;
  const out: ScanPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const enough = direction === "forward" ? i + window - 1 <= n - 1 : i - window + 1 >= 0;
    if (!enough || minLen < 3 || minLen >= window) {
      out[i] = EMPTY;
      continue;
    }
    let sx = 0;
    let sz = 0;
    let sxx = 0;
    let sxz = 0;
    let szz = 0;
    let best = -1;
    let bestT = 0;
    let bestLen = 0;
    for (let k = 0; k < window - 1; k++) {
      // vorwärts: Punkt i+k bei x = k; rückwärts: Punkt i−k bei x = −k (Zeit läuft in beiden Fällen nach rechts)
      const idx = direction === "forward" ? i + k : i - k;
      const x = direction === "forward" ? k : -k;
      const z = y[idx] - y[i];
      sx += x;
      sz += z;
      sxx += x * x;
      sxz += x * z;
      szz += z * z;
      const l = k + 1;
      if (l < minLen || (l - minLen) % step !== 0) continue;
      const cxx = sxx - (sx * sx) / l;
      const cxz = sxz - (sx * sz) / l;
      const czz = szz - (sz * sz) / l;
      const b = cxz / cxx;
      const sse = Math.max(czz - b * cxz, 0);
      const se = Math.sqrt(sse / (l - 2) / cxx);
      let t = se > 0 ? b / se : b === 0 ? 0 : Math.sign(b) * Infinity;
      if (!Number.isFinite(t)) t = Math.sign(t) * T_CAP * 10; // perfekte Gerade: gewinnt, wird unten begrenzt
      if (Math.abs(t) > best) {
        best = Math.abs(t);
        bestT = t;
        bestLen = l;
      }
    }
    if (best < 0) {
      out[i] = EMPTY;
      continue;
    }
    const other = direction === "forward" ? i + bestLen - 1 : i - bestLen + 1;
    const ret = direction === "forward" ? y[other] / y[i] - 1 : y[i] / y[other] - 1;
    out[i] = { t: Math.max(-T_CAP, Math.min(T_CAP, bestT)), len: bestLen, ret: Number.isFinite(ret) ? ret : null, other };
  }
  return out;
}

export const SCAN_MODES = ["off", "back20", "back60", "live20", "live60"] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

export const SCAN_LABEL: Record<ScanMode, string> = {
  off: "aus",
  back20: "Rückblick 20",
  back60: "Rückblick 60",
  live20: "laufend 20",
  live60: "laufend 60",
};

const DOTS =
  " Punkte auf dem Schlusskurs: grün aufwärts, rot abwärts; je größer, desto stärker im Vergleich zu reinem Zufall (kleiner grauer Punkt = im Zufallsbereich, grauer Ring = noch offen).";

export const SCAN_INFO: Record<ScanMode, string> = {
  off: "Trend-Scanning (López de Prado; mlfinlab von Hudson & Thames): Punkte auf dem Kurs nach dem gefundenen Trend.",
  back20:
    "Rückblick: welcher Trend auf jeden Balken FOLGTE (Geraden über 5 bis 19 folgende Balken, die mit dem größten t-Wert gewinnt). Nutzt spätere Kurse – nur zum Verstehen der Vergangenheit, kein Signal. Die letzten 19 Balken sind noch offen." +
    DOTS,
  back60:
    "Rückblick über bis zu 59 folgende Balken (längere Trends). Nutzt spätere Kurse – nur zum Verstehen der Vergangenheit, kein Signal. Die letzten 59 Balken sind noch offen." +
    DOTS,
  live20: "Laufend: welcher Trend zu jedem Balken HINFÜHRTE (Geraden über die 5 bis 19 vorherigen Balken). Nutzt nur frühere Kurse und gilt auch für heute." + DOTS,
  live60: "Laufend über bis zu 59 vorherige Balken (längere Trends). Nutzt nur frühere Kurse und gilt auch für heute." + DOTS,
};

export const scanParams = (m: ScanMode): { direction: "forward" | "backward"; window: number } | null =>
  m === "off" ? null : { direction: m.startsWith("back") ? "forward" : "backward", window: m.endsWith("60") ? 60 : 20 };

// ---- Vergleich mit dem Zufall ----
// Bei Kursen ist der t-Wert fast immer groß: Kurse hängen am Vortag (die Regression hält Trends für sicherer, als sie
// sind), und von allen Fensterlängen wird die beste genommen. Ein reiner Zufallskurs erreicht bei Fenster 20 typisch
// |t| ≈ 6, bei Fenster 60 ≈ 11 – die übliche Grenze 2 trennt also nichts. Deshalb wird jeder t-Wert mit vielen
// Zufallskursen verglichen (Irrfahrt mit normalverteilten Schritten, fester Startwert → immer dieselben Zahlen):
// Rang 0,9 = stärker als 90 % der Zufallsfälle. Der Vergleich hängt nur von Fenster, Mindestlänge und Schritt ab –
// nicht von Kursniveau oder Schwankung – und ist vorwärts wie rückwärts gleich (eine Irrfahrt rückwärts ist wieder eine).

const baselines = new Map<string, Float64Array>();

/** Kleiner, schneller Zufallsgenerator mit festem Startwert (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Aufsteigend sortierte |t|-Werte von ``samples`` unabhängigen Zufallskursen (einmal gerechnet, dann gemerkt). */
export function randomBaseline(window = 20, minLen = 5, step = 1, samples = 20000): Float64Array {
  const key = `${window}/${minLen}/${step}/${samples}`;
  const hit = baselines.get(key);
  if (hit) return hit;
  const rnd = seeded(20200514);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const y = new Array<number>(window).fill(0);
  const vals: number[] = [];
  for (let n = 0; n < samples; n++) {
    for (let k = 1; k < window; k++) y[k] = y[k - 1] + gauss();
    const t = trendScan(y, "forward", window, minLen, step)[0]?.t ?? null;
    if (t !== null) vals.push(Math.abs(t));
  }
  const out = Float64Array.from(vals).sort();
  baselines.set(key, out);
  return out;
}

/** Anteil der Zufallskurse mit kleinerem |t| (0 … 1); null ohne Ergebnis. */
export function randomRank(t: number | null, window = 20, minLen = 5, step = 1): number | null {
  if (t === null) return null;
  const b = randomBaseline(window, minLen, step);
  if (!b.length) return null;
  const a = Math.abs(t);
  let lo = 0;
  let hi = b.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid] <= a) lo = mid + 1;
    else hi = mid;
  }
  return lo / b.length;
}

/** |t|, den der Anteil ``q`` der Zufallskurse nicht überschreitet (z. B. q = 0,9). */
export function randomQuantile(q: number, window = 20, minLen = 5, step = 1): number {
  const b = randomBaseline(window, minLen, step);
  if (!b.length) return NaN;
  return b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))];
}

/**
 * Darstellung als Punkt auf dem Schlusskurs – an jedem Balken: Farbe = Richtung (grün auf, rot ab), Größe = Stärke im
 * Vergleich zum Zufall. Stufe 0 (schwächer als ein typischer Zufallskurs) = kleiner grauer Punkt.
 */
export const DOT_TIERS = [
  { from: 0, radius: 2, alpha: 0.95, text: "im Zufallsbereich" },
  { from: 0.5, radius: 2.5, alpha: 0.6, text: "schwach" },
  { from: 0.75, radius: 3.5, alpha: 0.8, text: "mittel" },
  { from: 0.9, radius: 4.5, alpha: 0.95, text: "deutlich" },
  { from: 0.99, radius: 6, alpha: 1, text: "sehr deutlich" },
] as const;

/** Stufe 0 … 4 zum Zufallsrang. */
export function dotTier(rank: number): number {
  let k = 0;
  for (let i = 1; i < DOT_TIERS.length; i++) if (rank >= DOT_TIERS[i].from) k = i;
  return k;
}

export function dotColor(t: number, tier: number): string {
  if (tier <= 0) return "rgba(150,150,150,0.95)";
  const a = DOT_TIERS[Math.min(tier, DOT_TIERS.length - 1)].alpha.toFixed(2);
  return t > 0 ? `rgba(41,209,125,${a})` : `rgba(255,82,82,${a})`;
}

/**
 * Reihen für die Punkte: Stufe 0 grau, Stufen 1–4 je einmal grün (aufwärts) und rot (abwärts). Jede Reihe hat EINE
 * Farbe – die Chart-Bibliothek (4.2) zeichnet Punkte mit wechselnder Farbe innerhalb einer Reihe nicht vollständig.
 */
export const DOT_SERIES: { tier: number; up: boolean; radius: number; color: string }[] = DOT_TIERS.flatMap((d, tier) =>
  tier === 0
    ? [{ tier, up: true, radius: d.radius, color: dotColor(0, 0) }]
    : [true, false].map((up) => ({ tier, up, radius: d.radius, color: dotColor(up ? 1 : -1, tier) })),
);

/** Noch ohne Ergebnis (Rückblick: die letzten Balken; laufend: zu wenig Verlauf): grauer Ring statt Punkt. */
export const OPEN_RING = [
  { radius: 2.5, color: "rgba(150,150,150,0.8)" },
  { radius: 1.2, color: "#0a0a0a" },
] as const;

/** Index in DOT_SERIES für einen t-Wert und seine Stufe. */
export function dotSeriesIndex(t: number, tier: number): number {
  return tier <= 0 ? 0 : 1 + (Math.min(tier, DOT_TIERS.length - 1) - 1) * 2 + (t > 0 ? 0 : 1);
}

/** Hilfslinien fürs Unterfenster „Trend-Scan t-Wert“: typischer Zufall (grau) und stärker als 90 % Zufall (grün/rot). */
export function tscanLevels(window = 20): { value: number; color: string; label: boolean }[] {
  const q50 = randomQuantile(0.5, window);
  const q90 = randomQuantile(0.9, window);
  return [
    { value: q90, color: "#29d17d", label: true },
    { value: q50, color: "#555", label: false },
    { value: 0, color: "#555", label: false },
    { value: -q50, color: "#555", label: false },
    { value: -q90, color: "#ff5252", label: true },
  ];
}
