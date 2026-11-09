// Trend-Scanning (López de Prado, „Machine Learning for Asset Managers“ 2020, Kap. 5.4; umgesetzt wie
// ``trend_scanning_labels`` in mlfinlab von Hudson & Thames): Je Balken werden Geraden über verschiedene
// Fensterlängen gelegt; die Länge mit dem größten |t-Wert| der Steigung bestimmt den Trend.
//
// - vorwärts (Rückblick): der Trend, der auf den Balken FOLGTE – nutzt spätere Kurse, nur zur Darstellung
//   der Vergangenheit; die letzten ``window − 1`` Balken haben noch kein Ergebnis.
// - rückwärts (laufend): der Trend, der zum Balken HINFÜHRTE – nur frühere Kurse; beschreibt den bisherigen
//   Verlauf (läuft Wendepunkten hinterher), keine Prognose.
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
  /** Steigung der gewählten Geraden (Beta) in Kurseinheiten je Balken */
  slope: number | null;
  /** Veränderung über das Fenster in Kurseinheiten (für Renditen: Prozentpunkte) */
  diff: number | null;
  /** Wert der gewählten Geraden am Balken selbst und am anderen Fensterende (zum Einzeichnen) */
  fitAt: number | null;
  fitOther: number | null;
}

/** Größter angezeigter |t|-Wert (eine perfekte Gerade hätte unendlich). */
export const T_CAP = 999;

const EMPTY: ScanPoint = { t: null, len: null, ret: null, other: null, slope: null, diff: null, fitAt: null, fitOther: null };

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
    let bestB = 0;
    let bestA = 0;
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
        bestB = Number.isFinite(b) ? b : 0;
        bestA = sz / l - bestB * (sx / l); // Achsenabschnitt bei x = 0 (am Balken selbst), relativ zu y[i]
      }
    }
    if (best < 0) {
      out[i] = EMPTY;
      continue;
    }
    const other = direction === "forward" ? i + bestLen - 1 : i - bestLen + 1;
    const ret = direction === "forward" ? y[other] / y[i] - 1 : y[i] / y[other] - 1;
    const xOther = direction === "forward" ? bestLen - 1 : -(bestLen - 1);
    out[i] = {
      t: Math.max(-T_CAP, Math.min(T_CAP, bestT)),
      len: bestLen,
      // bei Werten um oder unter null (Renditen) ist eine prozentuale Veränderung sinnlos
      ret: Number.isFinite(ret) && y[i] > 0 && y[other] > 0 ? ret : null,
      other,
      slope: bestB,
      diff: direction === "forward" ? y[other] - y[i] : y[i] - y[other],
      fitAt: y[i] + bestA,
      fitOther: y[i] + bestA + bestB * xOther,
    };
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
  " Punkte auf dem Schlusskurs, Farbe und Größe fließend: grau und klein = so gerade wie ein typischer reiner Zufallskurs; je kräftiger grün (aufwärts) bzw. rot (abwärts) und je größer, desto gerader im Vergleich zu Zufallskursen – volle Farbe ab „deutlich“ (gerader als 90 von 100), am größten ab „sehr deutlich“ (99 von 100). Kleiner dunkler Punkt = noch kein Ergebnis. Beim Fadenkreuz wird die gefundene Gerade eingezeichnet.";
const MANY =
  " Achtung: Benachbarte Punkte hängen stark zusammen; auch reiner Zufall erzeugt etwa 10 % „deutliche“ Punkte und ganze Strecken davon.";

export const SCAN_INFO: Record<ScanMode, string> = {
  off: "Trend-Scanning (López de Prado; mlfinlab von Hudson & Thames): Punkte auf dem Kurs nach dem gefundenen Trend.",
  back20:
    "RÜCKBLICK (hohle Punkte): welcher Trend auf jeden Balken FOLGTE (Geraden über 5 bis 19 folgende Balken, die mit dem größten t-Wert gewinnt). Nutzt spätere Kurse – zeigt deshalb Hochs und Tiefs im Nachhinein perfekt. Nur zum Verstehen der Vergangenheit, kein Signal. Die letzten 19 Balken sind noch offen. Wird nicht gespeichert." +
    DOTS +
    MANY,
  back60:
    "RÜCKBLICK (hohle Punkte) über bis zu 59 folgende Balken. Nutzt spätere Kurse – zeigt Hochs und Tiefs im Nachhinein perfekt. Nur zum Verstehen der Vergangenheit, kein Signal. Die letzten 59 Balken sind noch offen. Wird nicht gespeichert." +
    DOTS +
    MANY,
  live20:
    "Laufend: welcher Trend zu jedem Balken HINFÜHRTE (Geraden über die 5 bis 19 vorherigen Balken). Nutzt nur frühere Kurse. Beschreibt den bisherigen Verlauf, keine Prognose; wechselt erst einige Balken nach einem Wendepunkt die Farbe." +
    DOTS +
    MANY,
  live60:
    "Laufend über bis zu 59 vorherige Balken (längere Trends). Nutzt nur frühere Kurse. Beschreibt den bisherigen Verlauf, keine Prognose; läuft Wendepunkten deutlich hinterher." +
    DOTS +
    MANY,
};

/** Rückblick-Auswahl wird nicht gespeichert: nach dem Neuladen gilt sie als „aus“. */
export const SCAN_MODES_KEPT = ["off", "live20", "live60"] as const;

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
 * Stufen für Text und Zählung (die Punkte selbst sind fließend, siehe dotStyle): unter 50 % kein Trend erkennbar,
 * 50–90 % Tendenz (noch im Bereich, den Zufall oft erzeugt), ab 90 % deutlich, ab 99 % sehr deutlich.
 */
export const DOT_TIERS = [
  { from: 0, text: "kein Trend erkennbar" },
  { from: 0.5, text: "Tendenz, im Zufallsbereich" },
  { from: 0.9, text: "deutlich" },
  { from: 0.99, text: "sehr deutlich" },
] as const;

/** Ab dieser Stufe gilt ein Punkt als „deutlich“. */
export const STRONG_TIER = 2;

/** Anteil der Balken, die bei reinem Zufall mindestens „deutlich“ wären. */
export const RANDOM_SHARE_STRONG = 1 - DOT_TIERS[STRONG_TIER].from;

/** Stufe 0 … 3 zum Zufallsrang. */
export function dotTier(rank: number): number {
  let k = 0;
  for (let i = 1; i < DOT_TIERS.length; i++) if (rank >= DOT_TIERS[i].from) k = i;
  return k;
}

const GREY = [150, 150, 150];
const UP = [41, 209, 125];
const DOWN = [255, 82, 82];
/** Stützstellen Zufallsrang → Farbanteil (0 grau … 1 volle Farbe) und Radius in Pixeln; dazwischen fließend. */
const COLOR_STOPS: [number, number][] = [
  [0.5, 0],
  [0.9, 1],
];
const RADIUS_STOPS: [number, number][] = [
  [0.5, 2],
  [0.9, 4],
  [0.99, 6],
];

function piecewise(stops: [number, number][], x: number): number {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1];
    const [x1, y1] = stops[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return stops[stops.length - 1][1];
}

/**
 * Fließende Darstellung eines Punkts (wie Bild 5.2 im Buch, aber gegen den Zufall gemessen): bis zum typischen
 * Zufallskurs (Rang 50 %) grau und klein, dann immer kräftiger grün (aufwärts) bzw. rot (abwärts) – volle Farbe ab
 * „deutlich“ (90 %) – und größer bis „sehr deutlich“ (99 %).
 */
export function dotStyle(t: number, rank: number): { color: string; radius: number; mix: number } {
  const mix = piecewise(COLOR_STOPS, rank);
  const target = t > 0 ? UP : DOWN;
  const c = GREY.map((g, i) => Math.round(g + (target[i] - g) * mix));
  return { color: `rgb(${c[0]},${c[1]},${c[2]})`, radius: piecewise(RADIUS_STOPS, rank), mix };
}

/** Ehrlicher Wortlaut zum Zufallsrang (kein „zu x % sicher“). */
export function vsRandomText(rank: number): string {
  if (rank >= 0.995) return "gerader als 99 von 100 Zufallskursen";
  const n = Math.max(1, Math.round((1 - rank) * 100));
  return `so gerade wie ${n <= 10 ? "nur " : ""}${n} von 100 Zufallskursen`;
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
