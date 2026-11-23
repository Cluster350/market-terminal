// Saisonalität (SAIS): Daten und Hilfen.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";
import { DASH, fmt, isNum } from "./format";

export interface SeasonGroup {
  key: number;
  label: string;
  n: number;
  mean: number | null;
  median: number | null;
  plus: number | null;
  p: number | null;
  first: number | null;
  second: number | null;
  same: boolean | null;
}

export type Verdict = "deutlich" | "schwach" | "zufall" | "wenig";

export interface SeasonBlock {
  title: string;
  unit: string;
  groups: SeasonGroup[];
  overall: number | null;
  pAll: number | null;
  verdict: Verdict;
  verdictText: string;
  sentence: string;
  stable: string | null;
}

export interface Seasonality {
  ticker: string;
  name: string;
  currency: string | null;
  first: string;
  last: string;
  years: number;
  months: SeasonBlock;
  weekdays: SeasonBlock;
  turn: SeasonBlock;
  path: { days: number[]; average: (number | null)[]; current: (number | null)[]; plusShare: (number | null)[]; years: number[] };
  note: string;
}

export const useSeasonality = (ticker: string | null, years: number) =>
  useQuery({
    queryKey: ["seasonality", ticker, years],
    queryFn: () => request<Seasonality>(`/seasonality/${encodeURIComponent(ticker!)}${qs({ years })}`, undefined, { timeoutMs: 90_000 }),
    enabled: !!ticker && !IS_STATIC,
    staleTime: 3_600_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

export const VERDICT_WORD: Record<Verdict, string> = {
  deutlich: "deutlicher als Zufall",
  schwach: "schwach – auffällig, nicht sicher",
  zufall: "nicht vom Zufall zu unterscheiden",
  wenig: "zu wenig Daten",
};

/** Rendite mit Vorzeichen und Prozent (−1,23 %). */
export function pct(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return DASH;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${fmt(Math.abs(v), digits)} %`;
}

/** p-Wert als „in x % der Zufallsmischungen“. */
export function chance(p: number | null | undefined): string {
  if (!isNum(p)) return DASH;
  return p < 0.01 ? "< 1 %" : `${fmt(p * 100, 0)} %`;
}

/** Kalendertag (1–365, Nicht-Schaltjahr) → „3. Mär“ für Achse und Tooltip. */
const MONTH_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTH_START = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

export function dayLabel(day: number): string {
  let m = 0;
  while (m < 11 && day >= MONTH_START[m + 1]) m++;
  return `${day - MONTH_START[m] + 1}. ${MONTH_SHORT[m]}`;
}

export const monthTicks = MONTH_START;
export const monthShort = MONTH_SHORT;
