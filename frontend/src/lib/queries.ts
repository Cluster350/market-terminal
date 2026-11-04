// React-Query-Hooks mit Aktualisierungsintervallen je Datentyp.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Interval } from "./intervals";
import { api, ApiError, IS_STATIC, type CalendarParams, type NewsParams, type ScreenBody } from "./api";

const poll = (ms: number) => (IS_STATIC ? false : ms);

export function retry(count: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return count < 2;
}

export const useStatus = () =>
  useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: poll(60_000), staleTime: 30_000 });

/** Beispiel-Ticker, die es in der aktuellen Datenquelle auch gibt (Demo: fiktive Firmen). */
export function useExampleTickers(): [string, string, string] {
  const st = useStatus();
  return IS_STATIC || st.data?.mode === "demo" ? ["ELBT GR", "NWND US", "THMS LN"] : ["SAP GR", "AAPL US", "VOD LN"];
}

export const useQuotes = (tickers: string[]) =>
  useQuery({
    queryKey: ["quotes", tickers],
    queryFn: () => api.quotes(tickers),
    enabled: tickers.length > 0,
    refetchInterval: poll(15_000),
    placeholderData: keepPreviousData,
  });

export const useHistory = (t: string | null) =>
  useQuery({ queryKey: ["history", t], queryFn: () => api.history(t!), enabled: !!t, staleTime: 60_000, refetchInterval: poll(120_000) });

export const useIntraday = (t: string | null, days: number, enabled = true, interval: Interval = "5m") =>
  useQuery({
    queryKey: ["intraday", t, days, interval],
    queryFn: () => api.intraday(t!, days, interval),
    enabled: !!t && enabled,
    // so oft wie die Kurse in der Kopfzeile, damit Chart und Kopfzeile nicht auseinanderlaufen
    refetchInterval: poll(days <= 1 ? 15_000 : 60_000),
  });

export const useCompany = (t: string | null) =>
  useQuery({ queryKey: ["company", t], queryFn: () => api.company(t!), enabled: !!t, staleTime: 600_000 });

export const useFinancials = (t: string | null, period: string) =>
  useQuery({ queryKey: ["fin", t, period], queryFn: () => api.financials(t!, period), enabled: !!t, staleTime: 600_000 });

export const useEarnings = (t: string | null) =>
  useQuery({ queryKey: ["earn", t], queryFn: () => api.earnings(t!), enabled: !!t, staleTime: 600_000 });

export const useDividends = (t: string | null) =>
  useQuery({ queryKey: ["div", t], queryFn: () => api.dividends(t!), enabled: !!t, staleTime: 600_000 });

export const useNews = (p: NewsParams, enabled = true) =>
  useQuery({
    queryKey: ["news", p],
    queryFn: () => api.news(p),
    enabled,
    refetchInterval: poll(60_000),
    placeholderData: keepPreviousData,
  });

/** Prüft einen Ticker (für Vorschläge der Befehlszeile); Fehler werden nicht wiederholt. */
export const useResolve = (t: string | null) =>
  useQuery({ queryKey: ["resolve", t], queryFn: () => api.resolve(t!), enabled: !!t, staleTime: 600_000, retry: false });

export const useIndices = () => useQuery({ queryKey: ["indices"], queryFn: api.indices, refetchInterval: poll(60_000) });
export const useFx = () => useQuery({ queryKey: ["fx"], queryFn: api.fx, refetchInterval: poll(60_000) });
export const useCommodities = () =>
  useQuery({ queryKey: ["commodities"], queryFn: api.commodities, refetchInterval: poll(60_000) });

export const useCurves = (countries: string[]) =>
  useQuery({
    queryKey: ["curves", countries],
    queryFn: () => api.curves(countries),
    enabled: countries.length > 0,
    refetchInterval: poll(300_000),
    placeholderData: keepPreviousData,
  });

export const useSpreads = () => useQuery({ queryKey: ["spreads"], queryFn: api.spreads, refetchInterval: poll(300_000) });

export const useCalendar = (p: CalendarParams) =>
  useQuery({ queryKey: ["calendar", p], queryFn: () => api.calendar(p), refetchInterval: poll(60_000), placeholderData: keepPreviousData });

export const useCountries = (indicators: string[]) =>
  useQuery({ queryKey: ["countries", indicators], queryFn: () => api.countries(indicators), staleTime: 3_600_000, placeholderData: keepPreviousData });

export const useScreenFields = () => useQuery({ queryKey: ["screenFields"], queryFn: api.screenFields, staleTime: Infinity });

export const useScreen = (body: ScreenBody) =>
  useQuery({ queryKey: ["screen", body], queryFn: () => api.screen(body), staleTime: 60_000, placeholderData: keepPreviousData });

export const useMovers = (exchange?: string) =>
  useQuery({ queryKey: ["movers", exchange], queryFn: () => api.movers(exchange), refetchInterval: poll(60_000) });

export const useHeatmap = (exchange?: string) =>
  useQuery({ queryKey: ["heatmap", exchange], queryFn: () => api.heatmap(exchange), refetchInterval: poll(60_000) });

export const useSearch = (q: string) =>
  useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: q.trim().length >= 1, staleTime: 300_000 });

export const useEarningsCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: ["evts", from, to],
    queryFn: () => api.earningsCalendar(from, to),
    refetchInterval: poll(300_000),
    placeholderData: keepPreviousData,
  });

export const usePeers = (t: string | null, enabled = true) =>
  useQuery({ queryKey: ["peers", t], queryFn: () => api.peers(t!), enabled: !!t && enabled, staleTime: 300_000 });
