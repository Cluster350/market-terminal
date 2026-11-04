// Optionen (OMON): Kennzahlen und Optionskette je US-Aktie (EODHD-Marketplace bzw. Demo-Ketten).

import { useQuery } from "@tanstack/react-query";
import { ApiError, file, IS_STATIC, request } from "./api";

export interface OptionQuote {
  contract: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
}

export interface ChainRow {
  strike: number;
  call: OptionQuote | null;
  put: OptionQuote | null;
}

export interface OptionChain {
  ticker: string;
  spot: number | null;
  exp: string;
  dte: number;
  expirations: string[];
  atmStrike: number | null;
  rows: ChainRow[];
}

export interface ExpirySummary {
  exp: string;
  dte: number;
  monthly: boolean;
  atmIv: number | null;
  straddle: number | null;
  movePct: number | null;
  callVolume: number;
  putVolume: number;
  callOi: number;
  putOi: number;
  pcVolume: number | null;
  pcOi: number | null;
  maxPain: number | null;
  ivPut25: number | null;
  ivCall25: number | null;
  skew25: number | null;
  /** erster Verfall nach den nächsten Quartalszahlen */
  earnings?: boolean;
}

export interface StrikeOI {
  strike: number;
  callOi: number;
  putOi: number;
  callVolume: number;
  putVolume: number;
}

export interface ActiveContract {
  contract: string;
  type: "call" | "put";
  exp: string;
  strike: number;
  volume: number;
  openInterest: number | null;
  volOi: number | null;
  last: number | null;
  iv: number | null;
  delta: number | null;
}

export interface OptionsOverview {
  ticker: string;
  spot: number | null;
  earningsDate?: string | null;
  earningsTiming?: string | null;
  iv30: number | null;
  hv30: number | null;
  hv1y: number | null;
  ivHv: number | null;
  pcVolume: number | null;
  pcOi: number | null;
  totalVolume: number;
  totalOi: number;
  expirations: ExpirySummary[];
  focus: ExpirySummary | null;
  oiByStrike: StrikeOI[];
  smile: { strike: number; moneyness: number; callIv: number | null; putIv: number | null; iv: number | null }[];
  callWalls: StrikeOI[];
  putWalls: StrikeOI[];
  mostActive: ActiveContract[];
  unusual: ActiveContract[];
  contracts: number;
}

/** Vorige Daten nur beim Verfallswechsel desselben Werts weiter zeigen, nie nach einem Tickerwechsel
 * (sonst stünden kurz Kurs und Kette des alten Werts unter dem neuen Ticker). */
export function sameTicker<T>(prev: T | undefined, prevQuery: { queryKey: readonly unknown[] } | undefined, t: string | null): T | undefined {
  return prevQuery && prevQuery.queryKey[1] === t ? prev : undefined;
}

const safe = (t: string) => t.replace(/[^A-Za-z0-9.\-_]/g, "_");
const STATIC_MSG = "Im statischen Demo sind Optionen nur für NWND US und QBIT US (nächster Monatsverfall) enthalten.";

async function staticFile<T>(name: string): Promise<T> {
  try {
    return await file<T>(name);
  } catch {
    throw new ApiError(404, "not_found", STATIC_MSG);
  }
}

export const optionsApi = {
  overview: (t: string, exp?: string | null) =>
    IS_STATIC
      ? staticFile<OptionsOverview>(`options/${safe(t)}-overview${exp ? `-${exp}` : ""}.json`)
      : request<OptionsOverview>(`/options/${encodeURIComponent(t)}/overview${exp ? `?exp=${exp}` : ""}`, undefined, { timeoutMs: 60_000 }),
  chain: (t: string, exp?: string | null) =>
    IS_STATIC
      ? staticFile<OptionChain>(`options/${safe(t)}-chain${exp ? `-${exp}` : ""}.json`)
      : request<OptionChain>(`/options/${encodeURIComponent(t)}/chain${exp ? `?exp=${exp}` : ""}`, undefined, { timeoutMs: 60_000 }),
};

export const useOptionsOverview = (t: string | null, exp: string | null) =>
  useQuery({
    queryKey: ["options-overview", t, exp],
    queryFn: () => optionsApi.overview(t!, exp),
    enabled: !!t,
    staleTime: 120_000,
    placeholderData: (prev, prevQuery) => sameTicker(prev, prevQuery, t),
    retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
  });

export const useOptionChain = (t: string | null, exp: string | null, enabled = true) =>
  useQuery({
    queryKey: ["options-chain", t, exp],
    queryFn: () => optionsApi.chain(t!, exp),
    enabled: !!t && enabled,
    staleTime: 120_000,
    placeholderData: (prev, prevQuery) => sameTicker(prev, prevQuery, t),
    retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
  });

/** Zeilen um den Kurs: ±pct Prozent (null = alle). */
export function strikeWindow(rows: ChainRow[], spot: number | null, pct: number | null): ChainRow[] {
  if (pct === null || !spot) return rows;
  return rows.filter((r) => Math.abs(r.strike / spot - 1) * 100 <= pct + 1e-9); // Rundung: 110/100 ergibt 10,000…01 %
}

/** OCC-Kürzel lesbar: NWND261120C00145000 -> "NWND 20.11.26 C 145". */
export function contractLabel(c: { contract: string; type: string; exp: string; strike: number }): string {
  const root = c.contract.match(/^[A-Z.]+/)?.[0] ?? "";
  const [y, m, d] = c.exp.split("-");
  const k = Number.isInteger(c.strike) ? String(c.strike) : String(c.strike).replace(".", ",");
  return `${root} ${d}.${m}.${y.slice(2)} ${c.type === "call" ? "C" : "P"} ${k}`.trim();
}
