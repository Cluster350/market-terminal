// KI-Helfer: Zugriff auf /api/ai (LM Studio oder Demo-KI) und React-Query-Hooks.
// Die KI liest nur Terminal-Daten; Vorschläge führt erst ein Klick aus.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiError, file, IS_STATIC, request } from "./api";
import type { NewsItem } from "./types";

export type AiMode = "lmstudio" | "demo" | "off" | "offline";
export type AiEngine = "lmstudio" | "demo";

export interface AiStatus {
  mode: AiMode;
  configured: string;
  baseUrl: string;
  model: string | null;
  models: string[];
  queue: number;
  message: string;
}

export interface NewsInsight {
  id: string;
  summary: string;
  sentiment: number;
  reason: string;
  tickers: string[];
  sectors: string[];
  event: string;
  relevance: number;
  horizon: "kurzfristig" | "strukturell";
  engine: AiEngine;
  model: string;
  created: string;
}

export interface NewsInsightResult {
  engine: AiEngine | null;
  insights: Record<string, NewsInsight>;
  pending: string[];
  failed: Record<string, string>;
}

export interface BriefPoint {
  text: string;
  sources: string[];
}

export interface Brief {
  headline: string;
  sections: { title: string; points: BriefPoint[] }[];
  news: Record<string, string>;
  engine: AiEngine;
  model: string;
  created: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskBody {
  question: string;
  ticker?: string | null;
  watchlist?: string[];
  history?: ChatTurn[];
}

export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  ok: boolean;
}

export interface Suggestion {
  label: string;
  fn: string | null;
  ticker: string | null;
}

export interface AskResult {
  answer: string;
  trace: ToolTrace[];
  unverified: string[];
  suggestions: Suggestion[];
  engine: AiEngine;
  model: string;
  steps: number;
  seconds: number;
}

export const EVENT_LABEL: Record<string, string> = {
  quartalszahlen: "Quartalszahlen", prognose: "Prognose", uebernahme: "Übernahme", analyst: "Analystenurteil",
  management: "Personalie", produkt: "Produkt", auftrag: "Auftrag", kapitalmassnahme: "Kapitalmaßnahme",
  rechtliches: "Rechtliches", restrukturierung: "Umbau", makro: "Konjunkturdaten", markt: "Marktbericht", sonstiges: "Sonstiges",
};

export const RELEVANCE_LABEL = ["unwichtig", "gering", "kursrelevant", "stark kursbewegend"];

/** Meldung so, wie das Backend sie zum Einordnen erwartet (Text wird dort als Daten behandelt). */
export function toNewsInput(n: NewsItem) {
  return {
    id: n.id.slice(0, 80),
    title: n.title.slice(0, 500),
    content: (n.content || "").slice(0, 4000),
    date: n.date,
    source: n.source,
    symbols: n.symbols.slice(0, 6),
    topic: n.topic,
    polarity: n.sentiment.polarity,
    urgent: n.urgent,
  };
}

const JSON_POST = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
  signal,
});

const liveAi = {
  status: () => request<AiStatus>("/ai/status", undefined, { quiet: true, timeoutMs: 10_000 }),
  news: (items: NewsItem[], priority: "high" | "normal") =>
    request<NewsInsightResult>("/ai/news", JSON_POST({ items: items.slice(0, 40).map(toNewsInput), priority }), { quiet: true }),
  // Ein lokales Modell braucht für Briefing und Fragen gern eine Minute oder länger
  brief: (tickers: string[], refresh: boolean) =>
    request<Brief>("/ai/brief", JSON_POST({ tickers: tickers.slice(0, 60), refresh }), { quiet: true, timeoutMs: 300_000 }),
  ask: (body: AskBody, signal?: AbortSignal) => request<AskResult>("/ai/ask", JSON_POST(body, signal), { quiet: true, timeoutMs: 600_000 }),
  examples: async (): Promise<string[] | null> => null,
};

// Statische Demo: vorab mit der Demo-KI berechnete Ergebnisse (scripts/export_static.py)
const STATIC_ASK_HINT =
  "In der statischen Demo sind nur die Beispielfragen hinterlegt. Für freie Fragen das Terminal lokal starten und in LM Studio ein Modell laden.";

const staticAi: typeof liveAi = {
  status: () => file<AiStatus>("ai/status.json"),
  async news(items: NewsItem[]) {
    const all = await file<Record<string, NewsInsight>>("ai/news.json");
    const insights: Record<string, NewsInsight> = {};
    for (const n of items) if (all[n.id]) insights[n.id] = all[n.id];
    return { engine: "demo", insights, pending: [], failed: {} };
  },
  brief: () => file<Brief>("ai/brief.json"),
  async ask(body: AskBody) {
    const all = await file<Record<string, AskResult>>("ai/ask.json");
    return all[body.question.trim()] ?? { answer: STATIC_ASK_HINT, trace: [], unverified: [], suggestions: [], engine: "demo", model: "Demo-KI", steps: 0, seconds: 0 };
  },
  examples: async () => Object.keys(await file<Record<string, AskResult>>("ai/ask.json")),
};

export const aiApi = IS_STATIC ? staticAi : liveAi;

export const aiAvailable = (s: AiStatus | undefined): boolean => !!s && (s.mode === "lmstudio" || s.mode === "demo");

export const useAiStatus = () =>
  useQuery({
    queryKey: ["ai-status"],
    queryFn: aiApi.status,
    refetchInterval: IS_STATIC ? false : 30_000,
    staleTime: 10_000,
    retry: false,
  });

/**
 * Einordnungen für Meldungen. Solange das Modell noch arbeitet (pending), wird nachgefragt;
 * die Liste fragt seltener nach als die gerade gelesene Meldung (priority "high").
 */
export function useNewsInsights(items: NewsItem[], priority: "high" | "normal", status: AiStatus | undefined) {
  const on = aiAvailable(status);
  const ids = items.map((n) => n.id).join(",");
  return useQuery({
    queryKey: ["ai-news", status?.mode, priority, ids],
    queryFn: () => aiApi.news(items, priority),
    enabled: on && items.length > 0,
    refetchInterval: (q) => (q.state.data?.pending.length ? (priority === "high" ? 1500 : 4000) : false),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  });
}

export function engineLabel(engine: AiEngine | null | undefined, model?: string | null): string {
  if (engine === "lmstudio") return `LM Studio · ${model || "Modell"}`;
  if (engine === "demo") return "Demo-KI (regelbasiert)";
  return "–";
}

export function aiErrorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Beispielfragen; mit aktivem Wertpapier passend zu ihm. */
export function exampleQuestions(display: string | null): string[] {
  const generic = ["Wie riskant ist mein Depot?", "Wie laufen die Märkte?", "Welche Termine stehen heute an?", "Wer berichtet diese Woche Quartalszahlen?"];
  if (!display) return generic;
  return [`Wie steht ${display}?`, `Ist ${display} teuer im Vergleich zur Branche?`, ...generic, `Wie waren die letzten Quartalszahlen von ${display}?`];
}
