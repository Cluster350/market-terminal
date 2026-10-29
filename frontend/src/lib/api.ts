// Zugriff auf das Backend. Im statischen Demo-Build (__STATIC__) werden dieselben
// Aufrufe aus vorab exportierten JSON-Dateien bedient.

import { runScreen } from "./screen";
import type {
  Company,
  CountryTable,
  Curve,
  Dividends,
  Earnings,
  EconEvent,
  Financials,
  History,
  Intraday,
  MarketRow,
  Movers,
  NewsPage,
  Quote,
  ScreenField,
  ScreenFilter,
  ScreenResult,
  ScreenRow,
  SearchHit,
  Series,
  Status,
} from "./types";

declare const __STATIC__: boolean;
export const IS_STATIC: boolean = typeof __STATIC__ !== "undefined" && __STATIC__;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// --- Datenzustand für die Statusleiste --------------------------------------------

type Health = { lastOk: number | null; stale: boolean; lastError: string | null; inflight: number };
const health: Health = { lastOk: null, stale: false, lastError: null, inflight: 0 };
const listeners = new Set<() => void>();
let snapshot: Health = { ...health };

function emit() {
  snapshot = { ...health };
  listeners.forEach((l) => l());
}

export const dataHealth = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => snapshot,
};

// --- HTTP ------------------------------------------------------------------------

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  health.inflight++;
  emit();
  try {
    let res: Response;
    try {
      res = await fetch(BASE + path, { ...init, signal: ctrl.signal, headers: { Accept: "application/json", ...(init?.headers || {}) } });
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      throw new ApiError(0, aborted ? "timeout" : "network", aborted ? "Zeitüberschreitung – der Server antwortet nicht." : "Server nicht erreichbar. Läuft das Backend?");
    }
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new ApiError(res.status, "parse", `Ungültige Antwort vom Server (${res.status}).`);
      }
    }
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, err?.code || "http", err?.message || `Fehler ${res.status}`);
    }
    health.lastOk = Date.now();
    health.stale = res.headers.get("X-Data-Stale") === "1";
    health.lastError = null;
    return body as T;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) health.lastError = e.message;
    throw e;
  } finally {
    clearTimeout(timer);
    health.inflight--;
    emit();
  }
}

const enc = encodeURIComponent;

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// --- Statischer Demo-Modus -----------------------------------------------------------

const fileCache = new Map<string, Promise<unknown>>();

async function file<T>(name: string): Promise<T> {
  let p = fileCache.get(name);
  if (!p) {
    p = (async () => {
      let res: Response;
      try {
        res = await fetch(`./data/${name}`);
      } catch {
        throw new ApiError(0, "network", "Demo-Daten konnten nicht geladen werden.");
      }
      if (!res.ok) throw new ApiError(404, "not_found", "Im statischen Demo nicht enthalten. Für echte Ticker das Terminal mit EODHD-Key lokal starten.");
      return res.json();
    })();
    p.catch(() => fileCache.delete(name));
    fileCache.set(name, p);
  }
  health.lastOk = Date.now();
  emit();
  return p as Promise<T>;
}

const safe = (t: string) => t.replace(/[^A-Za-z0-9.\-_]/g, "_");

function normalizeStatic(t: string): string {
  return t.includes(".") ? t.toUpperCase() : `${t.toUpperCase()}.US`;
}

const series = (t: string) => file<{ history: History; intraday: Intraday }>(`series/${safe(normalizeStatic(t))}.json`);

async function fundamentals(t: string) {
  const ticker = normalizeStatic(t);
  if (!/\.(US|XETRA|PA|AS|SW|LSE)$/.test(ticker)) {
    throw new ApiError(404, "not_found", "Für dieses Instrument gibt es keine Unternehmensdaten.");
  }
  return file<{ company: Company; annual: Financials; quarterly: Financials; earnings: Earnings; dividends: Dividends }>(
    `fundamentals/${safe(ticker)}.json`,
  );
}

const staticApi = {
  status: () => file<Status>("status.json"),
  async search(q: string): Promise<SearchHit[]> {
    const all = await file<SearchHit[]>("search.json");
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const scored = all
      .map((h) => {
        const code = h.ticker.split(".")[0].toLowerCase();
        const name = h.name.toLowerCase();
        const score = code === s ? 0 : code.startsWith(s) ? 1 : name.startsWith(s) ? 2 : name.includes(s) || h.ticker.toLowerCase().includes(s) ? 3 : -1;
        return { h, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.h.ticker.localeCompare(b.h.ticker));
    return scored.slice(0, 12).map((x) => x.h);
  },
  async quotes(tickers: string[]): Promise<Quote[]> {
    const all = await file<Record<string, Quote>>("quotes.json");
    return tickers.map((t) => all[normalizeStatic(t)] || ({ ticker: t } as Quote));
  },
  history: async (t: string) => (await series(t)).history,
  async intraday(t: string, days: number): Promise<Intraday> {
    const d = (await series(t)).intraday;
    if (!d.t.length) return d;
    // Nach Kalendertagen schneiden: die letzten `days` Sitzungen
    const dayKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
    const sessions = Array.from(new Set(d.t.map(dayKey)));
    const keep = new Set(sessions.slice(-days));
    const idx = d.t.map((ts, i) => (keep.has(dayKey(ts)) ? i : -1)).filter((i) => i >= 0);
    const pick = <T,>(a: T[]) => idx.map((i) => a[i]);
    return { ...d, t: pick(d.t), o: pick(d.o), h: pick(d.h), l: pick(d.l), c: pick(d.c), v: pick(d.v) };
  },
  company: async (t: string) => (await fundamentals(t)).company,
  financials: async (t: string, period: string) => (await fundamentals(t))[period === "quarterly" ? "quarterly" : "annual"],
  earnings: async (t: string) => (await fundamentals(t)).earnings,
  dividends: async (t: string) => (await fundamentals(t)).dividends,
  async news(p: NewsParams): Promise<NewsPage> {
    const page = await file<NewsPage>("news.json");
    let items = page.items;
    if (p.tickers?.length) {
      const want = new Set(p.tickers.map(normalizeStatic));
      items = items.filter((n) => n.symbols.some((s) => want.has(s)));
    }
    if (p.topic && p.topic !== "all") items = items.filter((n) => n.topic === p.topic);
    if (p.q) {
      const q = p.q.toLowerCase();
      items = items.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.symbols.some((s) => s.toLowerCase().includes(q)));
    }
    if (p.since) items = items.filter((n) => n.date > p.since!);
    return { items: items.slice(0, p.limit ?? 100), sourcesNote: page.sourcesNote };
  },
  indices: () => file<MarketRow[]>("macro/indices.json"),
  fx: () => file<MarketRow[]>("macro/fx.json"),
  commodities: () => file<MarketRow[]>("macro/commodities.json"),
  async curves(countries: string[]): Promise<Curve[]> {
    const all = await file<Curve[]>("macro/curves.json");
    const by = new Map(all.map((c) => [c.country, c]));
    return countries.map((c) => by.get(c)).filter((c): c is Curve => !!c);
  },
  spreads: () => file<Series[]>("macro/spreads.json"),
  async calendar(p: CalendarParams): Promise<EconEvent[]> {
    const all = await file<EconEvent[]>("macro/calendar.json");
    return all.filter(
      (e) =>
        (!p.from || e.date.slice(0, 10) >= p.from) &&
        (!p.to || e.date.slice(0, 10) <= p.to) &&
        (!p.country || e.country === p.country) &&
        e.importance >= (p.importance ?? 1),
    );
  },
  async countries(indicators?: string[]): Promise<CountryTable> {
    const t = await file<CountryTable>("macro/countries.json");
    if (!indicators?.length) return { ...t, indicators: t.indicators.slice(0, 5) };
    return { ...t, indicators: t.indicators.filter((i) => indicators.includes(i.key)) };
  },
  screenFields: () => file<ScreenField[]>("screener/fields.json"),
  async screen(body: ScreenBody): Promise<ScreenResult> {
    const universe = await file<ScreenRow[]>("screener/universe.json");
    return runScreen(universe, body.filters, body.sort, body.desc, body.limit);
  },
  movers: () => file<Movers>("market/movers.json"),
  heatmap: () => file<ScreenResult>("market/heatmap.json"),
};

// --- Öffentliche API -------------------------------------------------------------------

export interface NewsParams {
  tickers?: string[];
  topic?: string;
  q?: string;
  limit?: number;
  since?: string;
}

export interface CalendarParams {
  from?: string;
  to?: string;
  country?: string;
  importance?: number;
}

export interface ScreenBody {
  filters: ScreenFilter[];
  sort: string;
  desc: boolean;
  limit: number;
  enrich?: boolean;
}

const liveApi = {
  status: () => request<Status>("/status"),
  search: (q: string) => request<SearchHit[]>(`/search${qs({ q, limit: 12 })}`),
  quotes: (tickers: string[]) => request<Quote[]>(`/quotes${qs({ tickers: tickers.join(",") })}`),
  history: (t: string) => request<History>(`/history/${enc(t)}`),
  intraday: (t: string, days: number) => request<Intraday>(`/intraday/${enc(t)}${qs({ days })}`),
  company: (t: string) => request<Company>(`/company/${enc(t)}`),
  financials: (t: string, period: string) => request<Financials>(`/financials/${enc(t)}${qs({ period })}`),
  earnings: (t: string) => request<Earnings>(`/earnings/${enc(t)}`),
  dividends: (t: string) => request<Dividends>(`/dividends/${enc(t)}`),
  news: (p: NewsParams) =>
    request<NewsPage>(`/news${qs({ tickers: p.tickers?.join(","), topic: p.topic, q: p.q, limit: p.limit, since: p.since })}`),
  indices: () => request<MarketRow[]>("/macro/indices"),
  fx: () => request<MarketRow[]>("/macro/fx"),
  commodities: () => request<MarketRow[]>("/macro/commodities"),
  curves: (countries: string[]) => request<Curve[]>(`/macro/curves${qs({ countries: countries.join(",") })}`),
  spreads: () => request<Series[]>("/macro/spreads"),
  calendar: (p: CalendarParams) =>
    request<EconEvent[]>(`/macro/calendar${qs({ from: p.from, to: p.to, country: p.country, importance: p.importance })}`),
  countries: (indicators?: string[]) => request<CountryTable>(`/macro/countries${qs({ indicators: indicators?.join(",") })}`),
  screenFields: () => request<ScreenField[]>("/screener/fields"),
  screen: (body: ScreenBody) =>
    request<ScreenResult>("/screener", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  movers: (exchange?: string) => request<Movers>(`/market/movers${qs({ exchange })}`),
  heatmap: (exchange?: string) => request<ScreenResult>(`/market/heatmap${qs({ exchange })}`),
};

export const api: typeof liveApi = IS_STATIC ? (staticApi as unknown as typeof liveApi) : liveApi;
