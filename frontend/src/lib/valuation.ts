// Bewertungstrend (BWT): KGVs von Sektoren und Ländern über die Jahre und Analystenschätzungen.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";
import { fmt } from "./format";

export type ValKind = "sector" | "country";
export type ValRegion = "all" | "us" | "eu";

export interface ValRow {
  key: string;
  label: string;
  kind: ValKind;
  region: string;
  n: number;
  peYears: Record<string, number | null>;
  coverage?: Record<string, number>;
  negativeYears: number[];
  peTtm: number | null;
  avg: number | null;
  low: number | null;
  high: number | null;
  position: number | null;
  chg12m: number | null;
  growthNext: number | null;
  rev30: number | null;
  rev90: number | null;
  up30: number;
  down30: number;
  dist52: number | null;
  state: "baer" | "korrektur" | "nahe";
}

export interface ValOverview {
  kind: ValKind;
  region: ValRegion;
  years: number[];
  estYears: number[];
  rows: ValRow[];
  state: "building" | "ready" | "error";
  done: number;
  total: number;
  builtAt: string | null;
  message: string | null;
  note: string;
}

export interface ValMember {
  ticker: string;
  name: string;
  mcap: number;
  peYears: Record<string, number | null>;
  peTtm: number | null;
  rev90: number | null;
  dist52: number | null;
  notes: string[];
}

export interface ValSeries {
  t: string[];
  v: (number | null)[];
}

export interface ValDetail {
  row: ValRow;
  years: number[];
  estYears: number[];
  monthly: ValSeries;
  forwardPath: ValSeries;
  recorded: ValSeries;
  decomposition: Record<string, { price: number | null; earnings: number | null; pe: number | null }>;
  coverage: Record<string, number>;
  members: ValMember[];
}

export const valuationApi = {
  overview: (kind: ValKind, region: ValRegion) => request<ValOverview>(`/valuation/overview${qs({ kind, region })}`),
  detail: (kind: ValKind, key: string, region: ValRegion) => request<ValDetail>(`/valuation/detail${qs({ kind, key, region })}`),
  refresh: (kind: ValKind, region: ValRegion) => request<ValOverview>(`/valuation/refresh${qs({ kind, region })}`, { method: "POST" }),
};

export const useValuationOverview = (kind: ValKind, region: ValRegion) =>
  useQuery({
    queryKey: ["valuation", kind, region],
    queryFn: () => valuationApi.overview(kind, region),
    enabled: !IS_STATIC,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
    // während der Berechnung den Fortschritt nachfragen
    refetchInterval: (q) => (q.state.data?.state === "building" ? 2000 : false),
  });

export const useValuationDetail = (kind: ValKind, key: string | null, region: ValRegion) =>
  useQuery({
    queryKey: ["valuation-detail", kind, key, region],
    queryFn: () => valuationApi.detail(kind, key!, region),
    enabled: !IS_STATIC && !!key,
    staleTime: 300_000,
  });

// --- Anzeige ------------------------------------------------------------------------

/** KGV mit einer Nachkommastelle; Verlustjahr als „neg.“, fehlend als Strich. */
export function fmtPe(v: number | null | undefined, negative = false): string {
  if (negative) return "neg.";
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (v <= 0) return "neg.";
  return v >= 1000 ? ">999" : fmt(v, 1);
}

/** Lage in der 10-Jahres-Spanne als fünf Kästchen (0 = günstigster, 1 = teuerster Stand). */
export function positionBlocks(p: number | null | undefined): string {
  if (p === null || p === undefined) return "";
  const filled = Math.max(1, Math.min(5, Math.ceil(p * 5)));
  return "▮".repeat(filled) + "▯".repeat(5 - filled);
}

/** Einfärbung eines Jahres-KGV gegenüber dem eigenen 10-Jahres-Durchschnitt. */
export function peTone(v: number | null | undefined, avg: number | null | undefined): string {
  if (v === null || v === undefined || !avg || v <= 0) return "";
  if (v > avg * 1.15) return "pe-hi";
  if (v < avg * 0.85) return "pe-lo";
  return "";
}

export const STATE_LABEL: Record<ValRow["state"], string> = {
  baer: "Bärenmarkt: mehr als 20 % unter dem 52-Wochen-Hoch",
  korrektur: "Korrektur: 10–20 % unter dem Hoch",
  nahe: "Nahe am Hoch: weniger als 10 % darunter",
};

export type Grouping = "state" | "region" | "none";

/** Zeilen in Abschnitte gliedern: nach Zustand (Abstand zum Hoch), nach Region oder gar nicht. */
export function groupRows(rows: ValRow[], by: Grouping): { title: string | null; rows: ValRow[] }[] {
  if (by === "none") return [{ title: null, rows }];
  if (by === "region") {
    const order: string[] = [];
    const map = new Map<string, ValRow[]>();
    for (const r of rows) {
      if (!map.has(r.region)) {
        map.set(r.region, []);
        order.push(r.region);
      }
      map.get(r.region)!.push(r);
    }
    return order.map((k) => ({ title: k, rows: map.get(k)! }));
  }
  return (["baer", "korrektur", "nahe"] as const)
    .map((s) => ({ title: STATE_LABEL[s], rows: rows.filter((r) => r.state === s) }))
    .filter((g) => g.rows.length);
}

/** Satz zur Zerlegung: Hat sich das KGV durch Kurse oder durch Gewinne verändert? */
export function decompositionText(label: string, d: { price: number | null; earnings: number | null; pe: number | null }): string {
  if (d.price === null || d.earnings === null || d.pe === null) return `${label}: zu wenig Daten`;
  const p = (x: number) => `${x >= 0 ? "+" : "−"}${fmt(Math.abs(x * 100), 0)} %`;
  const verdict = Math.abs(d.pe) < 0.05 ? "Bewertung etwa gleich" : d.pe > 0 ? "teurer geworden" : "günstiger geworden";
  return `${label}: Kurse ${p(d.price)}, Gewinne ${p(d.earnings)} → KGV ${p(d.pe)} (${verdict})`;
}

/** Quadrant der Bewertungs-Landkarte in Worten. */
export function quadrant(position: number | null, rev90: number | null): string {
  if (position === null || rev90 === null) return "";
  const cheap = position < 0.5;
  const up = rev90 >= 0;
  if (cheap && up) return "günstig, Schätzungen steigen – Erholungskandidat";
  if (!cheap && up) return "teuer, Schätzungen steigen – Stärke, aber eingepreist";
  if (cheap && !up) return "günstig, Schätzungen sinken – billig aus gutem Grund?";
  return "teuer, Schätzungen sinken – Vorsicht, die Hoffnung bröckelt";
}
