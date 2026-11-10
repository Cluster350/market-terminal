// DCF – innerer Wert je Aktie nach Aswath Damodarans Methode (Rechenkern im Backend) und die KI-Persona
// „Damodaran“, die die Bewertung einordnet. Rechnen tut nur der Rechenkern; die KI erklärt und schlägt vor.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";
import type { AiEngine } from "./ai";

export type LeverUnit = "pct" | "x" | "year";

export interface IvLever {
  key: string;
  label: string;
  value: number;
  default: number;
  unit: LeverUnit;
  min: number;
  max: number;
  step: number;
  hint: string;
}

export interface IvYear {
  year: number;
  growth: number;
  revenue: number;
  margin: number;
  ebit: number;
  taxRate: number;
  ebitAfterTax: number;
  reinvestment: number;
  fcff: number;
  wacc: number;
  discount: number;
  pv: number;
  investedCapital: number;
  roic: number | null;
}

export interface IvRow {
  label: string;
  value: number | null;
  unit: "money" | "pct" | "x" | "text" | "num";
  text: string | null;
  note: string;
}

export interface IntrinsicResult {
  ticker: string;
  name: string;
  state: "ok" | "not_applicable" | "no_data" | "invalid";
  message: string;
  currency: string | null;
  price: number | null;
  priceQuote: number | null;
  priceCurrency: string | null;
  fxNote: string;
  sector: string | null;
  industry: string | null;
  industryUsed: string;
  industrySource: string;
  country: string | null;
  basePeriod: string;
  lifecycle: { key: string; label: string; text: string } | null;
  levers: IvLever[];
  adjustments: IvRow[];
  costOfCapital: IvRow[];
  years: IvYear[];
  terminal: IvRow[];
  bridge: IvRow[];
  valuePerShare: number | null;
  valueGap: number | null;
  terminalShare: number | null;
  distribution: {
    runs: number;
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    shareAbovePrice: number | null;
    bins: { lo: number; hi: number; n: number }[];
  } | null;
  reverse: { growth: number | null; revenueMultiple10y: number | null; margin: number | null } | null;
  quality: { roicNow: number | null; wacc: number | null; roicMarginal: number | null; verdict: string } | null;
  multiples: IvRow[];
  history: IvRow[];
  warnings: string[];
  paramsSource: string;
  paramsLoadedAt: string | null;
}

export type Levers = Record<string, number>;

const JSON_POST = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** Bewertung; mit geänderten Hebeln per POST (nur die geänderten Werte werden geschickt). */
export const useIntrinsic = (ticker: string | null, levers: Levers) => {
  const key = JSON.stringify(levers);
  return useQuery({
    queryKey: ["intrinsic", ticker, key],
    queryFn: () =>
      Object.keys(levers).length
        ? request<IntrinsicResult>(`/intrinsic/${encodeURIComponent(ticker!)}`, JSON_POST({ levers }), { timeoutMs: 60_000 })
        : request<IntrinsicResult>(`/intrinsic/${encodeURIComponent(ticker!)}`, undefined, { timeoutMs: 60_000 }),
    enabled: !!ticker && !IS_STATIC,
    staleTime: 120_000,
    placeholderData: keepPreviousData,
  });
};

export const refreshParams = () =>
  request<{ ok: boolean; message: string; erp: number; erp_source: string; loaded_at: string | null }>(`/intrinsic/params/refresh${qs({})}`, { method: "POST" }, { timeoutMs: 120_000 });

// --- KI-Persona ----------------------------------------------------------------------------------------------

export type CoachMode = "kommentar" | "story" | "frage";

export interface CoachResult {
  mode: CoachMode;
  engine: AiEngine;
  model: string;
  name: string;
  disclaimer: string;
  sections: { title: string; text: string }[];
  answer: string;
  suggestion: { levers: Levers; reasons: Record<string, string>; threeP: string; valuePerShare: number | null; valueGap: number | null } | null;
  unverified: string[];
  seconds: number;
}

export const askCoach = (
  ticker: string,
  body: { mode: CoachMode; levers: Levers; text?: string; history?: { role: "user" | "assistant"; content: string }[] },
) => request<CoachResult>(`/ai/valuation/${encodeURIComponent(ticker)}`, JSON_POST(body), { quiet: true, timeoutMs: 600_000 });

// --- Anzeige ---------------------------------------------------------------------------------------------------

/** Hebelwert für das Eingabefeld: Prozent als Prozentzahl, sonst unverändert. */
export const leverToInput = (lv: { unit: LeverUnit }, v: number) => (lv.unit === "pct" ? Math.round(v * 10000) / 100 : lv.unit === "year" ? Math.round(v) : Math.round(v * 100) / 100);
export const inputToLever = (lv: { unit: LeverUnit }, v: number) => (lv.unit === "pct" ? v / 100 : lv.unit === "year" ? Math.round(v) : v);

/** Nur die Hebel, die vom Startwert abweichen (so bleibt die Abfrage bei Startwerten ein GET). */
export function changedLevers(levers: Levers, defaults: IvLever[]): Levers {
  const out: Levers = {};
  for (const [k, v] of Object.entries(levers)) {
    const d = defaults.find((x) => x.key === k);
    if (!d || Math.abs(d.default - v) > 1e-9) out[k] = v;
  }
  return out;
}
