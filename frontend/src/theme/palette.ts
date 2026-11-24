// Zentrale Farbpalette des Terminals. Grundsatz: jede Farbe hat genau eine Aufgabe.
// - Signal (UP/DOWN/WARN): nur gut/schlecht bzw. steigt/fällt – nie als bloße Unterscheidungsfarbe.
// - Datenreihen C1–C6: feste Reihenfolge für Linien und Legenden; ab der siebten Reihe dieselben Farben gestrichelt.
// - Bilanzflächen BS: Vermögen kühl nach Liquidität, Fremdkapital warm nach Fälligkeit, Eigenkapital silber.
// Dieselben Werte stehen als CSS-Variablen in theme/terminal.css (:root); palette.test.ts prüft, dass beide gleich sind.
// Diagramme (ECharts, Lightweight Charts) brauchen echte Farbwerte, deshalb diese Datei neben den CSS-Variablen.

export const PAL = {
  // Grundgerüst
  label: "#ffa028",
  value: "#ececec",
  muted: "#8f8f8f",
  dim: "#5c5c5c",
  rule: "#262626",
  ruleStrong: "#3a3a3a",
  grid: "#171717",
  tooltipBg: "#111111",
  accent: "#ff8000",
  key: "#f2c200",
  link: "#66b8ff",
  // Signal
  up: "#29d17d",
  down: "#ff5252",
  warn: "#f2c200",
  upFill: "#1d9258",
  downFill: "#b33939",
  // Datenreihen
  c1: "#ffa028", // Bernstein (= Beschriftung)
  c2: "#66b8ff", // Blau (= Link)
  c3: "#d8d8d8", // Hellgrau: Bezugslinie (Markt, Index)
  c4: "#f06aa8", // Rosa
  c5: "#1f8f88", // Petrol
  c6: "#7b70c8", // Indigo
  // Skala (Stimmung): Angst – normal – Gier
  scaleLow: "#66b8ff",
  scaleMid: "#6e6e6e",
  scaleHigh: "#f06aa8",
  // Bilanzflächen
  bsCash: "#8ecef6",
  bsRecv: "#57a9da",
  bsInv: "#3083b4",
  bsFixed: "#1e618c",
  bsOther: "#5e5e5e",
  bsCl: "#de8c63",
  bsNcl: "#9a5237",
  bsEq: "#c6c6c6",
} as const;

/** CSS-Variable je Palettenwert (für die Prüfung gegen terminal.css). */
export const CSS_VARS: Record<string, keyof typeof PAL> = {
  "--up": "up", "--down": "down", "--warn": "warn", "--up-fill": "upFill", "--down-fill": "downFill",
  "--c1": "c1", "--c2": "c2", "--c3": "c3", "--c4": "c4", "--c5": "c5", "--c6": "c6",
  "--scale-low": "scaleLow", "--scale-mid": "scaleMid", "--scale-high": "scaleHigh",
  "--bs-cash": "bsCash", "--bs-recv": "bsRecv", "--bs-inv": "bsInv", "--bs-fixed": "bsFixed", "--bs-other": "bsOther",
  "--bs-cl": "bsCl", "--bs-ncl": "bsNcl", "--bs-eq": "bsEq", "--grid": "grid",
};

export const SERIES = [PAL.c1, PAL.c2, PAL.c3, PAL.c4, PAL.c5, PAL.c6] as const;

export interface SeriesStyle {
  color: string;
  dashed: boolean;
}

/** Farbe und Strichart der i-ten Datenreihe: C1–C6, danach dieselben Farben gestrichelt (12 unterscheidbare Linien). */
export function seriesStyle(i: number): SeriesStyle {
  const n = SERIES.length;
  return { color: SERIES[((i % n) + n) % n], dashed: Math.floor(i / n) % 2 === 1 };
}

/** Reihen, die eine feste Bezugsfarbe (Hellgrau) neben sich haben, überspringen C3, damit sie sich nicht doppelt. */
export function seriesStyleWithoutRef(i: number): SeriesStyle {
  const order = [PAL.c1, PAL.c2, PAL.c4, PAL.c5, PAL.c6];
  return { color: order[i % order.length], dashed: Math.floor(i / order.length) % 2 === 1 };
}

/** Schrift auf einer Fläche: schwarz auf hellen, weiß auf dunklen Farben (relative Leuchtdichte). */
export function textOn(hex: string): "#000" | "#fff" {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? "#000" : "#fff";
}
