// Stimmungsterminal (STIM): Daten, Farbskala und Formatierung.

import { useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";
import { DASH, fmt, isNum } from "./format";

export type SentRegion = "us" | "eu";

export interface SentComponent {
  key: string;
  label: string;
  unit: "pct" | "pp" | "num" | "ratio" | "tone";
  explain: string;
  approx: boolean;
  inTotal: boolean;
  available: boolean;
  note: string | null;
  value: number | null;
  value1w: number | null;
  rank: number | null;
  rank1w: number | null;
  sentence: string | null;
  ranks: (number | null)[];
  values: (number | null)[];
}

export interface SentTotal {
  value: number | null;
  mean: number | null;
  word: string;
  sentence: string;
  w1: number | null;
  m1: number | null;
  y1: number | null;
  low12: number | null;
  high12: number | null;
  n: number;
  nTotal: number;
}

export interface BacktestRow {
  h: number;
  label: string;
  n: number;
  nAll: number;
  median: number | null;
  medianAll: number | null;
  plus: number | null;
  plusAll: number | null;
  p10: number | null;
  p90: number | null;
  p10All: number | null;
  p90All: number | null;
}

export interface SentBacktest {
  state: "deutlich" | "schwach" | "wenig";
  text: string;
  band?: [number, number];
  episodes?: number;
  rows: BacktestRow[];
}

export interface SentimentResult {
  region: SentRegion;
  label: string;
  state: "ready" | "building";
  asOf: string | null;
  since: string;
  firms: number;
  indexLabel: string;
  total: SentTotal;
  lage: string;
  components: SentComponent[];
  trend: SentComponent | null;
  dates: string[];
  totalSeries: (number | null)[];
  indexSeries: (number | null)[];
  breadth: Record<"adl" | "breadthVol" | "trin" | "pct200" | "nhnl" | "trust", (number | null)[]>;
  heatmap: { weeks: string[]; rows: { sector: string; label: string; n: number; values: (number | null)[] }[] };
  backtest: SentBacktest;
  note: string;
  message: string | null;
}

export const useSentiment = (region: SentRegion) =>
  useQuery({
    queryKey: ["sentiment", region],
    queryFn: () => request<SentimentResult>(`/sentiment${qs({ region })}`, undefined, { timeoutMs: 180_000 }),
    enabled: !IS_STATIC,
    staleTime: 300_000,
    // solange die Firmenliste aufgebaut wird, alle 5 s nachfragen, danach alle 15 Minuten
    refetchInterval: (q) => (q.state.data?.state === "building" ? 5_000 : 900_000),
  });

// --- Farbskala: Blau (Angst) – Grau – Magenta (Sorglosigkeit); grau zwischen Rang 30 und 70 ---

const BLUE = [0x5b, 0x8c, 0xff];
const GREY = [0x8f, 0x8f, 0x8f];
const MAGENTA = [0xff, 0x5f, 0xa2];

const mix = (a: number[], b: number[], t: number) =>
  `#${a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, "0")).join("")}`;

/** Farbe zu einem Rang 0–100: bis 10 volles Blau, 30–70 Grau, ab 90 volles Magenta, dazwischen fließend. */
export function rankColor(rank: number | null | undefined): string {
  if (!isNum(rank)) return "#5c5c5c";
  if (rank <= 10) return mix(BLUE, BLUE, 0);
  if (rank < 30) return mix(BLUE, GREY, (rank - 10) / 20);
  if (rank <= 70) return mix(GREY, GREY, 0);
  if (rank < 90) return mix(GREY, MAGENTA, (rank - 70) / 20);
  return mix(MAGENTA, MAGENTA, 0);
}

/** Besonders selten (unter 5 bzw. über 95): größere Marke. */
export const isExtreme = (rank: number | null | undefined) => isNum(rank) && (rank < 5 || rank > 95);

// --- Formatierung ---------------------------------------------------------------------------

const signed = (v: number, d: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmt(Math.abs(v), d)}`;

/** Wert eines Bausteins mit Einheit. */
export function compValue(c: Pick<SentComponent, "key" | "unit">, v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  switch (c.key) {
    case "hochtief":
      return `${signed(v, 1)} %`;
    case "haefen":
    case "risiko":
      return `${signed(v, 1)} Pp`;
    case "trend":
      return `${signed(v, 1)} %`;
  }
  switch (c.unit) {
    case "pct":
      return `${fmt(v, c.key === "vola" ? 1 : 0)} %`;
    case "pp":
      return `${signed(v, 1)} Pp`;
    case "ratio":
      return fmt(v, 2);
    case "tone":
      return signed(v, 2);
    default:
      return fmt(v, 1);
  }
}

/** Veränderung über eine Woche als Pfeil und Betrag (Prozentpunkte bei Anteilen). */
export function compChange(c: Pick<SentComponent, "key" | "unit">, now: number | null | undefined, before: number | null | undefined): string {
  if (!isNum(now) || !isNum(before)) return DASH;
  const d = now - before;
  const digits = c.unit === "ratio" || c.unit === "tone" ? 2 : 1;
  if (Math.abs(d) < 10 ** -digits / 2) return "→ 0";
  const unit = c.unit === "pct" && c.key !== "vola" && c.key !== "trend" ? " Pp" : "";
  const shown = unit ? fmt(Math.abs(d), Math.abs(d) < 1 ? 1 : 0) : fmt(Math.abs(d), digits);
  return `${d > 0 ? "↑" : "↓"} ${shown}${unit}`;
}

export const rankText = (r: number | null | undefined) => (isNum(r) ? fmt(r, 0) : DASH);

/** Kurzurteil des Rückblicks. */
export const BACKTEST_WORD: Record<SentBacktest["state"], string> = {
  deutlich: "Früher: deutliches Muster",
  schwach: "Früher: kein klares Muster",
  wenig: "Früher: zu wenig Fälle",
};

/** Fünftel in Worten (Rückblick-Zeile). */
export function bandLabel(band: [number, number] | undefined): string {
  if (!band) return "Ähnlich wie heute";
  const names = ["ängstlich (1. Fünftel)", "vorsichtig (2. Fünftel)", "gewöhnlich (3. Fünftel)", "zuversichtlich (4. Fünftel)", "sorglos (5. Fünftel)"];
  return `Ähnlich ${names[Math.min(4, Math.floor(band[0] / 20))]} wie heute`;
}

export const pctSigned = (v: number | null | undefined, d = 1) => (isNum(v) ? `${signed(v, d)} %` : DASH);

/** Gesamtwert-Verlauf eingeschränkt auf den gewählten Zeitraum (Monate, 0 = alles). */
export function sliceFrom(dates: string[], months: number): number {
  if (!months || !dates.length) return 0;
  const last = new Date(dates[dates.length - 1]);
  last.setMonth(last.getMonth() - months);
  const iso = last.toISOString().slice(0, 10);
  const i = dates.findIndex((d) => d >= iso);
  return i < 0 ? 0 : i;
}

/** Abschnitte, in denen der Index steigt, die A/D-Linie aber fällt (über 20 Tage) – Breite geht nicht mit. */
export function divergences(index: (number | null)[], adl: (number | null)[], window = 20): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = window; i < index.length; i++) {
    const a = index[i], b = index[i - window], c = adl[i], d = adl[i - window];
    const div = isNum(a) && isNum(b) && isNum(c) && isNum(d) && a > b && c < d;
    if (div && start < 0) start = i;
    if (!div && start >= 0) {
      if (i - start >= 5) out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0 && index.length - start >= 5) out.push([start, index.length - 1]);
  return out;
}
