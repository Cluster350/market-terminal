// Spiegel der Backend-Modelle (backend/app/models.py), Feldnamen in camelCase.

export type Num = number | null;

export interface Quote {
  ticker: string;
  name: string | null;
  last: Num;
  change: Num;
  changePct: Num;
  open: Num;
  high: Num;
  low: Num;
  prevClose: Num;
  volume: Num;
  timestamp: string | null;
  delayed: boolean;
  currency: string | null;
}

export interface History {
  ticker: string;
  currency: string | null;
  t: string[];
  o: Num[];
  h: Num[];
  l: Num[];
  c: Num[];
  v: Num[];
}

export interface Intraday {
  ticker: string;
  interval: string;
  t: number[];
  o: Num[];
  h: Num[];
  l: Num[];
  c: Num[];
  v: Num[];
}

export interface Company {
  ticker: string;
  name: string;
  exchange: string | null;
  currency: string | null;
  country: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  employees: Num;
  website: string | null;
  ipoDate: string | null;
  isin: string | null;
  marketCap: Num;
  officers: { name: string; title: string | null }[];
  valuation: {
    pe: Num; forwardPe: Num; peg: Num; priceSales: Num; priceBook: Num; ev: Num; evRevenue: Num; evEbitda: Num;
  };
  profitability: {
    profitMargin: Num; operatingMargin: Num; roe: Num; roa: Num; revenueTtm: Num; ebitda: Num;
    revenueGrowthYoy: Num; earningsGrowthYoy: Num;
  };
  perShare: {
    eps: Num; epsEstimateCy: Num; epsEstimateNy: Num; bookValue: Num; dividendShare: Num; dividendYield: Num;
  };
  technicals: { beta: Num; high52: Num; low52: Num; ma50: Num; ma200: Num };
  shares: { outstanding: Num; floatShares: Num; pctInsiders: Num; pctInstitutions: Num };
  analyst: {
    rating: Num; targetPrice: Num; strongBuy: Num; buy: Num; hold: Num; sell: Num; strongSell: Num;
  };
  updatedAt: string | null;
}

export interface StatementRow {
  key: string;
  label: string;
  values: Num[];
  kind: "money" | "ratio" | "pershare";
  emphasis: boolean;
}

export interface Financials {
  ticker: string;
  period: "annual" | "quarterly";
  currency: string | null;
  periods: string[];
  income: StatementRow[];
  balance: StatementRow[];
  cashflow: StatementRow[];
}

export interface EarningsItem {
  date: string;
  reportDate: string | null;
  epsActual: Num;
  epsEstimate: Num;
  surprisePct: Num;
  timing: string | null;
}

export interface Earnings {
  ticker: string;
  currency: string | null;
  history: EarningsItem[];
  next: EarningsItem | null;
}

export interface Dividends {
  ticker: string;
  dividends: { exDate: string; payDate: string | null; value: Num; currency: string | null }[];
  splits: { date: string; ratio: string }[];
  ttm: Num;
  yieldTtm: Num;
}

export type NewsTopic = "company" | "earnings" | "analyst" | "mna" | "macro" | "markets";

export interface NewsItem {
  id: string;
  date: string;
  title: string;
  content: string;
  link: string | null;
  source: string | null;
  symbols: string[];
  tags: string[];
  topic: NewsTopic;
  sentiment: { polarity: Num; pos: Num; neu: Num; neg: Num };
  urgent: boolean;
}

export interface NewsPage {
  items: NewsItem[];
  sourcesNote: string | null;
}

export interface MarketRow {
  ticker: string;
  name: string;
  region: string | null;
  last: Num;
  change: Num;
  changePct: Num;
  chg1w: Num;
  chg1m: Num;
  chgYtd: Num;
  spark: number[];
  asOf: string | null;
}

export interface CurvePoint {
  tenor: string;
  years: number;
  y: Num;
  y1m: Num;
  y1y: Num;
}

export interface Curve {
  country: string;
  name: string;
  asOf: string | null;
  points: CurvePoint[];
}

export interface Series {
  key: string;
  label: string;
  unit: string;
  t: string[];
  v: Num[];
}

export interface EconEvent {
  id: string;
  date: string;
  country: string;
  event: string;
  period: string | null;
  actual: Num;
  estimate: Num;
  previous: Num;
  surprise: Num;
  importance: number;
  unit: string | null;
}

export interface CountryValue {
  year: number | null;
  value: Num;
}

export interface CountryTable {
  indicators: { key: string; label: string; unit: string }[];
  rows: {
    country: string;
    name: string;
    values: Record<string, CountryValue>;
    history: Record<string, CountryValue[]>;
  }[];
  note: string | null;
}

export interface ScreenRow {
  ticker: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  price: Num;
  chg1d: Num;
  chg5d: Num;
  marketCap: Num;
  eps: Num;
  pe: Num;
  divYield: Num;
  avgVol: Num;
  perf1m: Num;
  perf3m: Num;
  perf12m: Num;
  rsi14: Num;
  vol1y: Num;
  dist52wHigh: Num;
}

export interface ScreenResult {
  rows: ScreenRow[];
  total: number;
  truncated: boolean;
  notes: string[];
}

export interface ScreenField {
  key: string; // snake_case wie im Backend
  label: string;
  group: "descriptive" | "fundamental" | "technical";
  kind: "number" | "percent" | "money" | "text" | "choice";
  choices: string[];
  enriched: boolean;
}

export type ScreenOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "in" | "contains";

export interface ScreenFilter {
  field: string;
  op: ScreenOp;
  value: number | string | string[];
}

export interface Movers {
  gainers: ScreenRow[];
  losers: ScreenRow[];
  active: ScreenRow[];
  asOf: string | null;
}

export interface SearchHit {
  ticker: string;
  name: string;
  exchange: string | null;
  type: string | null;
  country: string | null;
  currency: string | null;
}

export interface Status {
  mode: "demo" | "eodhd" | "static";
  serverTime: string;
  cache?: { entries: number; hits: number; misses: number; staleServed: number };
  defaults: {
    watchlist: string[];
    news: string[];
    screenerExchanges: string[];
    heatmapExchange: string;
    curveCountries: string[];
  };
  budget?: { day: string; used: number; limit: number; byEndpoint: Record<string, number> };
  account?: { plan: string | null; apiRequests: number | null; dailyRateLimit: number | null };
  accountError?: string;
  note?: string;
}
