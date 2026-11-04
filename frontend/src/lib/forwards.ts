// Terminkurse (FWD): Devisen-Terminkurse, Absicherungskosten und Forward-Zinsen – berechnet aus
// Kassakursen und Zinskurven (EODHD liefert keine Börsen-Futures oder Terminkurse).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { file, IS_STATIC, request } from "./api";

export interface RatePoint {
  years: number;
  rate: number;
}

export interface FxForwardRow {
  tenor: string;
  years: number;
  baseRate: number | null;
  quoteRate: number | null;
  outright: number | null;
  points: number | null;
  premiumPa: number | null;
}

export interface FxForwards {
  pair: string;
  base: string;
  quote: string;
  spot: number | null;
  pip: number;
  asOf: string | null;
  rows: FxForwardRow[];
  baseCurve: RatePoint[];
  quoteCurve: RatePoint[];
  missing: string[];
}

export interface HedgeRow {
  currency: string;
  rate3m: number | null;
  hedge3mPa: number | null;
  hedge1yPa: number | null;
}

export interface HedgeTable {
  home: string;
  homeRate3m: number | null;
  rows: HedgeRow[];
  missing: string[];
}

export interface RateForwards {
  country: string;
  name: string;
  asOf: string | null;
  spot: RatePoint[];
  spot1m: RatePoint[];
  forwards: { start: number; rate: number | null; rate1m: number | null }[];
  keys: { label: string; start: number; length: number; rate: number | null; change1mBp: number | null }[];
}

/** Paare, deren Kassakurs auch im Demo-Modus vorliegt (wie FX). */
export const FX_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "EURGBP", "EURCHF", "EURJPY", "AUDUSD", "USDCAD", "NZDUSD", "USDCNH"];
export const HOME_CURRENCIES = ["EUR", "USD", "CHF", "GBP"] as const;
export const RATE_COUNTRIES = ["US", "DE", "UK", "FR", "IT", "JP"] as const;

export const TENOR_LABEL: Record<string, string> = {
  "1W": "1 Woche", "1M": "1 Monat", "2M": "2 Monate", "3M": "3 Monate", "6M": "6 Monate", "9M": "9 Monate",
  "1Y": "1 Jahr", "18M": "18 Monate", "2Y": "2 Jahre",
};

export const forwardsApi = {
  fx: (pair: string) => (IS_STATIC ? file<FxForwards>(`forwards/fx-${pair}.json`) : request<FxForwards>(`/forwards/fx?pair=${pair}`)),
  hedge: (home: string, currencies?: string[]) =>
    IS_STATIC
      ? file<HedgeTable>(`forwards/hedge-${home}.json`).then((h) => (currencies ? { ...h, rows: h.rows.filter((r) => currencies.includes(r.currency)) } : h))
      : request<HedgeTable>(`/forwards/hedge?home=${home}${currencies?.length ? `&currencies=${currencies.join(",")}` : ""}`),
  rates: (country: string) => (IS_STATIC ? file<RateForwards>(`forwards/rates-${country}.json`) : request<RateForwards>(`/forwards/rates?country=${country}`)),
};

const poll = (ms: number) => (IS_STATIC ? false : ms);

export const useFxForwards = (pair: string) =>
  useQuery({ queryKey: ["fwd-fx", pair], queryFn: () => forwardsApi.fx(pair), refetchInterval: poll(60_000), placeholderData: keepPreviousData });

export const useHedge = (home: string, currencies?: string[], enabled = true) =>
  useQuery({
    queryKey: ["fwd-hedge", home, currencies?.join(",") ?? ""],
    queryFn: () => forwardsApi.hedge(home, currencies),
    enabled: enabled && (!currencies || currencies.length > 0),
    staleTime: 300_000,
    placeholderData: keepPreviousData,
  });

export const useRateForwards = (country: string) =>
  useQuery({ queryKey: ["fwd-rates", country], queryFn: () => forwardsApi.rates(country), staleTime: 300_000, placeholderData: keepPreviousData });

/** "EURUSD" -> "EUR/USD" */
export const pairLabel = (p: string) => `${p.slice(0, 3)}/${p.slice(3)}`;

/** Stellen des Terminkurses: zwei mehr als die Pip-Stelle (EUR/USD 5, USD/JPY 3). */
export const outrightDigits = (pip: number) => Math.round(-Math.log10(pip)) + 1;
