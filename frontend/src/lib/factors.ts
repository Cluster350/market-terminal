// Faktoren (FCTR): Stil-ETFs gegenüber dem Markt; Faktorlast des Depots (RISK).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";
import { fmt } from "./format";
import { PAL } from "../theme/palette";

export type FactorRegion = "us" | "eu";
export const PERIODS = ["1d", "1w", "1m", "3m", "ytd", "1y", "3y", "5y"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { "1d": "1T", "1w": "1W", "1m": "1M", "3m": "3M", ytd: "YTD", "1y": "1J", "3y": "3J", "5y": "5J" };

export interface FactorRow {
  key: string;
  label: string;
  ticker: string;
  name: string;
  isin: string | null;
  help: string | null;
  last: number | null;
  currency: string | null;
  abs: Partial<Record<Period, number | null>>;
  rel: Partial<Record<Period, number | null>>;
  vol1y: number | null;
  beta1y: number | null;
  relVsAvg: number | null;
  first: string | null;
}

export interface FactorOverview {
  region: FactorRegion;
  label: string;
  bench: FactorRow;
  rows: FactorRow[];
  t: string[];
  lines: Record<string, (number | null)[]>;
  corrKeys: string[];
  corr: (number | null)[][];
  notes: string[];
  skipped: string[];
}

export interface Loading {
  key: string;
  label: string;
  ticker: string;
  beta: number | null;
  t: number | null;
}

export interface FactorExposure {
  region: FactorRegion;
  label: string;
  auto: boolean;
  weeks: number;
  start: string | null;
  end: string | null;
  r2: number | null;
  market: Loading | null;
  factors: Loading[];
  usShare: number | null;
  notes: string[];
}

// Reihenfarben aus der zentralen Palette; Grün/Rot bleiben für gut/schlecht reserviert.
// Die letzten drei Faktoren wiederholen C2/C1/C4 gestrichelt.
export const FACTOR_COLORS: Record<string, string> = {
  market: PAL.c3, value: PAL.c1, growth: PAL.c2, momentum: PAL.c4, quality: PAL.c5,
  size: PAL.c6, lowvol: PAL.c2, dividend: PAL.c1, equal: PAL.c4,
};
export const FACTOR_DASHED = new Set(["lowvol", "dividend", "equal"]);
export const factorLine = (key: string) => (FACTOR_DASHED.has(key) ? ("dashed" as const) : ("solid" as const));

export const useFactors = (region: FactorRegion) =>
  useQuery({
    queryKey: ["factors", region],
    queryFn: () => request<FactorOverview>(`/factors${qs({ region })}`, undefined, { timeoutMs: 90_000 }),
    enabled: !IS_STATIC,
    staleTime: 120_000,
    refetchInterval: 300_000,
    placeholderData: keepPreviousData,
  });

export const usePortfolioFactors = (region: "auto" | FactorRegion, version: number | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ["portfolio-factors", region, version],
    queryFn: () => request<FactorExposure>(`/portfolio/factors${qs({ region })}`, undefined, { timeoutMs: 90_000 }),
    enabled: enabled && !IS_STATIC,
    staleTime: 600_000,
    retry: false,
  });

/** Stärke einer Faktorlast nach ihrem t-Wert. */
export function strength(t: number | null | undefined): "deutlich" | "schwach" | "kaum" | "–" {
  if (t === null || t === undefined || !Number.isFinite(t)) return "–";
  const a = Math.abs(t);
  return a >= 2 ? "deutlich" : a >= 1 ? "schwach" : "kaum";
}

/** Was eine negative Faktorlast bedeutet (Gegenteil des Stils). */
const OPPOSITE: Record<string, string> = {
  value: "eher teurer bewertete Firmen",
  growth: "eher langsam wachsende Firmen",
  momentum: "eher die Verlierer der letzten Monate",
  quality: "eher Firmen mit schwächeren Bilanzen",
  size: "eher große Firmen",
  lowvol: "eher schwankungsreiche Aktien",
  dividend: "eher Firmen mit wenig Dividende",
};
const TOWARD: Record<string, string> = {
  value: "eher günstig bewertete Firmen",
  growth: "eher Wachstumsfirmen",
  momentum: "eher die Gewinner der letzten Monate",
  quality: "eher Qualitätsfirmen",
  size: "eher kleinere Firmen",
  lowvol: "eher ruhige Aktien",
  dividend: "eher Dividendenzahler",
};

/** Faktorlast in Worten: „Momentum: +0,32 → eher die Gewinner der letzten Monate, deutlich“. */
export function loadingText(l: Loading): string {
  if (l.beta === null) return `${l.label}: –`;
  const s = strength(l.t);
  if (s === "kaum") return `${l.label}: keine erkennbare Neigung`;
  const dir = l.beta > 0 ? (TOWARD[l.key] ?? `mehr ${l.label}`) : (OPPOSITE[l.key] ?? `weniger ${l.label}`);
  return `${l.label}: ${l.beta >= 0 ? "+" : "−"}${fmt(Math.abs(l.beta), 2)} → ${dir}, ${s}`;
}

/** Verhältnis Faktor ÷ Markt je Tag (für die relative Linie). */
export function relativeLine(t: string[], f: (number | null)[], m: (number | null)[]): { t: string[]; v: (number | null)[] } {
  return { t, v: f.map((x, i) => (x !== null && m[i] ? x / (m[i] as number) : null)) };
}
