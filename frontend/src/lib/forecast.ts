// Prognose mit Unsicherheitsbändern (Chronos-2 oder eingebaute Statistik) samt Rückblick-Test.
// Die Bänder sind ehrlich kalibriert: Der Server prüft, wie oft sie früher getroffen hätten.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiError, IS_STATIC, qs, request } from "./api";
import { fmt, fmtShortDate } from "./format";

export interface FcSeries {
  t: string[];
  v: (number | null)[];
}

export interface FcBand {
  t: string[];
  median: number[];
  lo50: number[];
  hi50: number[];
  lo80: number[];
  hi80: number[];
}

export interface FcEngineScore {
  engine: string;
  label: string;
  mae: number | null;
  skill: number | null;
}

export interface FcQuality {
  origins: number;
  pairs: number;
  mae: number | null;
  maeNaive: number | null;
  skill: number | null;
  cover50: number | null;
  cover80: number | null;
  rawCover80: number | null;
  bandScale: number;
  compared: FcEngineScore[];
  modelMae1: number | null;
  consensusMae: number | null;
  consensusN: number;
}

export interface FcFeature {
  key: string;
  label: string;
  mae: number | null;
  gain: number | null;
}

/** Vergleich der Prognose mit und ohne die gewählten Einflussgrößen (gleicher Rückblick-Test). */
export interface FcFeatureEffect {
  features: FcFeature[];
  maeBase: number | null;
  maeWith: number | null;
  gain: number | null;
  helps: boolean | null;
  text: string;
  baseline: FcBand | null;
  baseEngineLabel: string | null;
  points: number;
  notes: string[];
}

export interface FcFeatureOption {
  key: string;
  label: string;
  group: string;
}

export const MAX_FEATURES = 5;

export type Verdict = "gut" | "knapp" | "schwach" | "wenig";

export interface ForecastResult {
  kind: "macro" | "event" | "vol";
  key: string;
  label: string;
  unit: string | null;
  freq: "year" | "release" | "month";
  history: FcSeries;
  consensus: FcSeries | null;
  nextConsensus: number | null;
  forecast: FcBand;
  engine: string;
  engineLabel: string;
  quality: FcQuality;
  verdict: Verdict;
  verdictText: string;
  note: string | null;
  extra: Record<string, number | null>;
  features?: FcFeatureEffect | null;
}

export interface ForecastStatus {
  mode: "auto" | "chronos" | "simple" | "off";
  active: string | null;
  engines: { name: string; label: string; ready: boolean; loading: boolean; error: string | null }[];
  model: string | null;
  device: string | null;
  installed: boolean;
  message: string | null;
}

export const forecastApi = {
  status: () => request<ForecastStatus>("/forecast/status"),
  macro: (country: string, indicator: string, h = 3, x: string[] = []) =>
    request<ForecastResult>(`/forecast/macro${qs({ country, indicator, h })}${xQuery(x)}`, undefined, { timeoutMs: x.length ? 180_000 : 60_000 }),
  event: (country: string, event: string, h = 3, x: string[] = []) =>
    request<ForecastResult>(`/forecast/event${qs({ country, event, h })}${xQuery(x)}`, undefined, { timeoutMs: x.length ? 240_000 : 90_000 }),
  features: (kind: "macro" | "event", country: string) => request<FcFeatureOption[]>(`/forecast/features${qs({ kind, country })}`),
  vol: (ticker: string, h = 3, iv?: number | null) =>
    request<ForecastResult>(`/forecast/vol/${encodeURIComponent(ticker)}${qs({ h, iv: iv ?? undefined })}`, undefined, { timeoutMs: 60_000 }),
};

/** Einflussgrößen als wiederholter Parameter x (hinter den übrigen Parametern). */
export const xQuery = (x: string[]) => x.map((k) => `&x=${encodeURIComponent(k)}`).join("");

/** Auswahl bereinigen: ohne Leeres und Doppeltes, höchstens MAX_FEATURES. */
export function cleanFeatures(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const k of x) {
    const s = typeof k === "string" ? k.trim() : "";
    if (s && s.length <= 140 && !out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_FEATURES);
}

export const isFeatureList = (x: unknown): x is string[] => Array.isArray(x) && x.length <= MAX_FEATURES && x.every((k) => typeof k === "string" && k.length <= 140);

/** Nutzen einer Einflussgröße in Worten: „+12 %“ genauer, „−5 %“ ungenauer. */
export function gainText(gain: number | null | undefined): string {
  if (gain === null || gain === undefined) return "–";
  const pct = Math.round(gain * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)} %`;
}

export const useFeatureOptions = (kind: "macro" | "event", country: string | null) =>
  useQuery({
    queryKey: ["fc-features", kind, country],
    queryFn: () => forecastApi.features(kind, country!),
    enabled: !IS_STATIC && !!country,
    staleTime: 3_600_000,
    retry: noRetry,
  });

const noRetry = (n: number, e: Error) => !(e instanceof ApiError && e.status >= 400 && e.status < 600) && n < 1;

export const useForecastStatus = () =>
  useQuery({ queryKey: ["forecast-status"], queryFn: forecastApi.status, enabled: !IS_STATIC, staleTime: 15_000, refetchInterval: (q) => (q.state.data?.engines.some((e) => e.loading) ? 3000 : 60_000) });

export const useMacroForecast = (country: string | null, indicator: string, h = 3, x: string[] = []) =>
  useQuery({
    queryKey: ["fc-macro", country, indicator, h, x.join("|")],
    queryFn: () => forecastApi.macro(country!, indicator, h, x),
    placeholderData: keepPreviousData,
    enabled: !IS_STATIC && !!country,
    staleTime: 3_600_000,
    retry: noRetry,
  });

export const useEventForecast = (country: string | null, event: string | null, h = 3, x: string[] = []) =>
  useQuery({
    queryKey: ["fc-event", country, event, h, x.join("|")],
    queryFn: () => forecastApi.event(country!, event!, h, x),
    enabled: !IS_STATIC && !!country && !!event,
    staleTime: 600_000,
    retry: noRetry,
  });

export const useVolForecast = (ticker: string | null, iv: number | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ["fc-vol", ticker, iv == null ? null : Math.round(iv * 10) / 10],
    queryFn: () => forecastApi.vol(ticker!, 3, iv),
    enabled: !IS_STATIC && enabled && !!ticker,
    staleTime: 1_800_000,
    retry: noRetry,
    placeholderData: keepPreviousData,
  });

// --- Anzeige ------------------------------------------------------------------------

const monthYear = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Zeitpunkt passend zur Reihe: Jahr, Veröffentlichungstag oder (bei langen Zeiträumen) Monat und Jahr. */
export function fcTime(t: string, freq: ForecastResult["freq"], long = false): string {
  if (freq === "year") return t;
  if (freq === "month" || long) {
    const d = new Date(`${t.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? t : monthYear.format(d);
  }
  return fmtShortDate(t);
}

export function digitsFor(r: Pick<ForecastResult, "unit" | "history">): number {
  const vals = r.history.v.filter((x): x is number => typeof x === "number");
  const mag = Math.max(...vals.map((x) => Math.abs(x)), 0);
  return mag >= 1000 ? 0 : mag >= 50 ? 1 : 2;
}

export function fmtVal(x: number | null | undefined, r: Pick<ForecastResult, "unit" | "history">): string {
  const unit = r.unit && r.unit !== "USD" ? ` ${r.unit}` : "";
  return `${fmt(x, digitsFor(r))}${unit}`;
}

/** Kurzzeile zum Rückblick-Test. */
export function qualityLine(q: FcQuality, digits = 2): string {
  if (!q.origins || q.mae === null) return "Zu wenig Verlauf für einen Rückblick-Test.";
  const parts = [`Rückblick-Test an ${q.origins} früheren Zeitpunkten: Fehler ${fmt(q.mae, digits)}`];
  if (q.maeNaive !== null) parts.push(`„bleibt wie zuletzt“ ${fmt(q.maeNaive, digits)}`);
  if (q.cover80 !== null) parts.push(`80-%-Band traf ${Math.round(q.cover80 * 100)} %`);
  return parts.join(" · ");
}

export function verdictClass(v: Verdict): string {
  return v === "gut" ? "up" : v === "schwach" ? "down" : "flat";
}

export function verdictLabel(v: Verdict): string {
  return { gut: "Rückblick: gut", knapp: "Rückblick: knapp", schwach: "Rückblick: schwach", wenig: "wenig Daten" }[v];
}

/** Vergleich der Methoden im Rückblick-Test (Auto-Auswahl). */
export function comparedText(q: FcQuality, digits = 2): string {
  if (q.compared.length < 2) return "";
  return "Auto-Auswahl nach Rückblick-Fehler: " + q.compared.map((c) => `${c.label.split(" (")[0]} ${fmt(c.mae, digits)}`).join(" · ");
}

export interface FanData {
  categories: string[];
  hist: (number | null)[];
  median: (number | null)[];
  lo80: (number | null)[];
  band80: (number | null)[];
  lo50: (number | null)[];
  band50: (number | null)[];
  consensus: (number | null)[] | null;
  baseline: (number | null)[] | null; // Prognose ohne Einflussgrößen (nur wenn welche gewählt sind)
  splitIndex: number; // erster Prognosepunkt
}

/**
 * Daten fürs Fächerdiagramm: Verlauf (gekürzt auf `maxHist`), dann die Prognose. Der Fächer
 * beginnt am letzten Ist-Wert. Bänder als Stapel (Unterkante + Breite) für ECharts.
 */
export function fanData(r: ForecastResult, maxHist = 36): FanData {
  const start = Math.max(0, r.history.t.length - maxHist);
  const ht = r.history.t.slice(start);
  const hv = r.history.v.slice(start);
  const n = ht.length;
  const f = r.forecast;
  const h = f.t.length;
  const last = hv[n - 1] ?? null;
  const pad = (xs: (number | null)[]) => [...Array(n - 1).fill(null), last, ...xs];
  const lo80 = pad(f.lo80);
  const hi80 = pad(f.hi80);
  const lo50 = pad(f.lo50);
  const hi50 = pad(f.hi50);
  const diff = (hi: (number | null)[], lo: (number | null)[]) => hi.map((x, i) => (x === null || lo[i] === null ? null : x - (lo[i] as number)));
  let consensus: (number | null)[] | null = null;
  if (r.consensus) {
    consensus = [...r.consensus.v.slice(start), r.nextConsensus ?? null, ...Array(Math.max(0, h - 1)).fill(null)];
  }
  // Mehr als etwa ein Jahr Verlauf: Monat und Jahr statt Tag und Monat
  const long = r.freq === "release" && n > 1 && Date.parse(f.t[h - 1] ?? ht[n - 1]) - Date.parse(ht[0]) > 330 * 86_400_000;
  return {
    categories: [...ht, ...f.t].map((t) => fcTime(t, r.freq, long)),
    hist: [...hv, ...Array(h).fill(null)],
    median: pad(f.median),
    lo80,
    band80: diff(hi80, lo80),
    lo50,
    band50: diff(hi50, lo50),
    consensus,
    baseline: r.features?.baseline && r.features.features.length ? pad(r.features.baseline.median) : null,
    splitIndex: n,
  };
}

// --- Schwankungskegel im Kurschart ----------------------------------------------------

/** Die nächsten `n` Werktage (Mo–Fr) nach `date` (JJJJ-MM-TT); Feiertage werden nicht beachtet. */
export function nextBusinessDays(date: string, n: number): string[] {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  const out: string[] = [];
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface ConeLine {
  time: string;
  value: number;
}

/**
 * Erwartete Schwankungsbreite ab dem letzten Schlusskurs: ±1 und ±2 Standardabweichungen über
 * `days` Handelstage, aus der Jahres-Volatilität in % (z. B. 28 für 28 % p. a.). Lognormal, ohne Richtung.
 */
export function coneLines(lastTime: string, lastClose: number, volPct: number, days = 21): { up1: ConeLine[]; lo1: ConeLine[]; up2: ConeLine[]; lo2: ConeLine[] } {
  const sigma = volPct / 100;
  const times = [lastTime.slice(0, 10), ...nextBusinessDays(lastTime, days)];
  const at = (k: number, z: number) => lastClose * Math.exp(z * sigma * Math.sqrt(k / 252));
  const line = (z: number) => times.map((time, k) => ({ time, value: at(k, z) }));
  return { up1: line(1), lo1: line(-1), up2: line(2), lo2: line(-2) };
}
