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

export const SCAN_INFO: Record<ScanMode, string> = {
  off: "Trend-Scanning (López de Prado; mlfinlab von Hudson & Thames): färbt den Chart nach dem gefundenen Trend.",
  back20:
    "Rückblick: welcher Trend auf jeden Balken FOLGTE (Geraden über 5 bis 19 folgende Balken, die mit dem größten t-Wert gewinnt). Nutzt spätere Kurse – nur zum Verstehen der Vergangenheit, kein Signal. Die letzten 19 Balken sind noch offen.",
  back60:
    "Rückblick über bis zu 59 folgende Balken (längere Trends). Nutzt spätere Kurse – nur zum Verstehen der Vergangenheit, kein Signal. Die letzten 59 Balken sind noch offen.",
  live20: "Laufend: welcher Trend zu jedem Balken HINFÜHRTE (Geraden über die 5 bis 19 vorherigen Balken). Nutzt nur frühere Kurse und gilt auch für heute.",
  live60: "Laufend über bis zu 59 vorherige Balken (längere Trends). Nutzt nur frühere Kurse und gilt auch für heute.",
};

export const scanParams = (m: ScanMode): { direction: "forward" | "backward"; window: number } | null =>
  m === "off" ? null : { direction: m.startsWith("back") ? "forward" : "backward", window: m.endsWith("60") ? 60 : 20 };

/** Ab diesem |t| gilt ein Trend als deutlich (sonst „kein klarer Trend“, nicht eingefärbt). */
export const T_MIN = 2;

/** Hintergrundfarbe je Balken: grün aufwärts, rot abwärts, Deckkraft nach Stärke; schwacher Trend ohne Farbe. */
export function scanColor(t: number | null): string | null {
  if (t === null || Math.abs(t) < T_MIN) return null;
  const a = 0.08 + 0.22 * Math.min(1, (Math.abs(t) - T_MIN) / 18);
  return t > 0 ? `rgba(41,209,125,${a.toFixed(3)})` : `rgba(255,82,82,${a.toFixed(3)})`;
}
