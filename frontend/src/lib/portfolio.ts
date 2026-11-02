// Depot: Positionen laden/speichern (/api/portfolio) und Kennzahlen (/api/portfolio/analytics).
// Im statischen Demo-Build sind Depot und Kennzahlen vorab berechnet und nur lesbar.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiError, file, IS_STATIC, request } from "./api";
import { normalizeTicker } from "./commands";

export type Base = "EUR" | "USD" | "CHF" | "GBP";
export const BASES: Base[] = ["EUR", "USD", "CHF", "GBP"];

export interface Position {
  id: string;
  ticker: string;
  quantity: number;
  cost: number | null;
  opened: string | null;
  currency: string | null;
  note: string;
}

export interface Portfolio {
  version: number;
  base: Base;
  benchmark: string | null;
  cash: number;
  positions: Position[];
  updated: string | null;
  sample: boolean;
}

export interface PositionRow {
  id: string;
  ticker: string;
  name: string | null;
  quantity: number;
  cost: number | null;
  opened: string | null;
  note: string;
  currency: string | null;
  price: number | null;
  changePct: number | null;
  fx: number | null;
  value: number | null;
  weight: number | null;
  dayPnl: number | null;
  pnl: number | null;
  pnlPct: number | null;
  pnlPctBase: number | null;
  sector: string | null;
  country: string | null;
  vol: number | null;
  beta: number | null;
  riskShare: number | null;
  issue: string | null;
}

export interface Slice {
  key: string;
  value: number;
  weight: number;
}

export interface Analytics {
  base: Base;
  benchmark: string | null;
  benchmarkName: string | null;
  asOf: string | null;
  summary: {
    value: number;
    positionsValue: number;
    cash: number;
    invested: number | null;
    dayPnl: number | null;
    dayPnlPct: number | null;
    pnl: number | null;
    pnlPct: number | null;
    count: number;
  };
  rows: PositionRow[];
  allocation: Record<string, Slice[]>;
  risk: {
    days: number;
    vol: number | null;
    beta: number | null;
    return1y: number | null;
    benchReturn1y: number | null;
    benchVol: number | null;
    maxDrawdown: number | null;
    drawdownPeak: string | null;
    drawdownTrough: string | null;
    var95: number | null;
    var95Pct: number | null;
    es95: number | null;
    effectiveN: number | null;
    top5Weight: number | null;
    largest: string | null;
    largestWeight: number | null;
  };
  series: { t: string[]; portfolio: number[]; benchmark: (number | null)[] };
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  notes: string[];
}

const liveApi = {
  get: () => request<Portfolio>("/portfolio"),
  save: (p: Portfolio) =>
    request<Portfolio>("/portfolio", { method: "PUT", body: JSON.stringify(p), headers: { "Content-Type": "application/json" } }),
  analytics: () => request<Analytics>("/portfolio/analytics", undefined, { timeoutMs: 90_000 }),
};

const staticApi: typeof liveApi = {
  get: () => file<Portfolio>("portfolio/portfolio.json"),
  save: async () => {
    throw new ApiError(403, "static", "In der statischen Demo lässt sich das Depot nicht ändern. Lokal gestartet wird es gespeichert.");
  },
  analytics: () => file<Analytics>("portfolio/analytics.json"),
};

export const portfolioApi = IS_STATIC ? staticApi : liveApi;

export const usePortfolio = () => useQuery({ queryKey: ["portfolio"], queryFn: portfolioApi.get, staleTime: 30_000 });

export const usePortfolioAnalytics = (version: number | undefined) =>
  useQuery({
    queryKey: ["portfolio-analytics", version],
    queryFn: portfolioApi.analytics,
    enabled: version !== undefined,
    refetchInterval: IS_STATIC ? false : 60_000,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
  });

/** Neue Position ins Depot; gibt es den Wert schon, werden Stück und Durchschnittskurs zusammengeführt. */
export function mergePosition(positions: Position[], add: Position): { positions: Position[]; merged: boolean } {
  const i = positions.findIndex((p) => p.ticker === add.ticker);
  if (i < 0) return { positions: [...positions, add], merged: false };
  const old = positions[i];
  const qty = old.quantity + add.quantity;
  let cost: number | null = null;
  if (old.cost !== null && add.cost !== null && qty !== 0 && Math.sign(old.quantity) === Math.sign(add.quantity)) {
    cost = (old.cost * old.quantity + add.cost * add.quantity) / qty;
  } else {
    cost = old.cost ?? add.cost;
  }
  const opened = [old.opened, add.opened].filter((d): d is string => !!d).sort()[0] ?? null;
  const merged: Position = { ...old, quantity: qty, cost: cost === null ? null : Math.round(cost * 10000) / 10000, opened, note: old.note || add.note };
  const next = positions.slice();
  if (qty === 0) next.splice(i, 1);
  else next[i] = merged;
  return { positions: next, merged: true };
}

/** Zahl in deutscher oder englischer Schreibweise (1.234,5 / 1,234.5 / 1234,5). */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/\s|€|\$|£|%/g, "");
  if (!s) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) s = s.replace(/,/g, "");
  else if (comma < 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 1.000 = tausend
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

/** Datum als JJJJ-MM-TT aus 2026-01-05 oder 05.01.2026. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export interface CsvResult {
  positions: Position[];
  errors: string[];
}

/**
 * Depotliste aus CSV oder kopierten Tabellenzeilen: Ticker; Stück; Einstandskurs; Kaufdatum; Notiz.
 * Trennzeichen Semikolon, Tab oder Komma (dann mit Punkt als Dezimaltrenner). Kopfzeile wird erkannt.
 */
export function parseCsv(text: string): CsvResult {
  const errors: string[] = [];
  let positions: Position[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, n) => {
    const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    const cells = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    if (n === 0 && /ticker|symbol|wertpapier|isin|name/i.test(cells[0])) return; // Kopfzeile
    const ticker = normalizeTicker(cells[0] ?? "");
    const qty = parseNumber(cells[1] ?? "");
    if (!ticker) {
      errors.push(`Zeile ${n + 1}: Ticker „${cells[0] ?? ""}“ nicht erkannt.`);
      return;
    }
    if (qty === null || qty === 0) {
      errors.push(`Zeile ${n + 1}: Stückzahl fehlt.`);
      return;
    }
    const cost = cells[2] ? parseNumber(cells[2]) : null;
    if (cells[2] && (cost === null || cost <= 0)) {
      errors.push(`Zeile ${n + 1}: Einstandskurs „${cells[2]}“ ungültig – ohne Kurs übernommen.`);
    }
    const opened = cells[3] ? parseDate(cells[3]) : null;
    if (cells[3] && !opened) errors.push(`Zeile ${n + 1}: Datum „${cells[3]}“ nicht erkannt (TT.MM.JJJJ).`);
    const pos: Position = {
      id: "",
      ticker,
      quantity: qty,
      cost: cost !== null && cost > 0 ? cost : null,
      opened,
      currency: null,
      note: (cells[4] ?? "").slice(0, 200),
    };
    positions = mergePosition(positions, pos).positions;
  });
  return { positions, errors };
}

const csvNum = (x: number | null) => (x === null ? "" : String(x).replace(".", ","));

export function toCsv(p: Portfolio): string {
  const head = "Ticker;Stück;Einstandskurs;Kaufdatum;Notiz";
  const rows = p.positions.map((x) => [x.ticker, csvNum(x.quantity), csvNum(x.cost), x.opened ?? "", x.note.replace(/[;\r\n]/g, " ")].join(";"));
  return [head, ...rows].join("\r\n") + "\r\n";
}
