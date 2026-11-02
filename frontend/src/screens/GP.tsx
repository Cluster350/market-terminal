// GP – Kurschart mit Kerzen/Linie, Volumen, gleitenden Durchschnitten und Zeiträumen.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { ErrorState, Loading, Seg } from "../components/ui";
import { alertStatus, alertsApi, useAlerts, useAlertsRefresh, type Alert } from "../lib/alerts";
import { api, ApiError, IS_STATIC } from "../lib/api";
import { normalizeTicker, unknownSecurityMessage } from "../lib/commands";
import { displayTicker, fmt, fmtBig, fmtBp, fmtDate, fmtPct, fmtPrice, fmtTime, isEquity, isNum, priceDigits, shiftMonths, tone } from "../lib/format";
import { isBool, isNumberList, isOneOf, usePersistentState } from "../lib/persist";
import { retry, useEarnings, useHistory, useIntraday } from "../lib/queries";
import type { EarningsItem, History, Intraday } from "../lib/types";
import type { ScreenProps } from "./types";

type Range = "1T" | "5T" | "1M" | "3M" | "6M" | "YTD" | "1J" | "5J" | "MAX";
type Kind = "candle" | "line" | "area";

const RANGE_VALUES = ["1T", "5T", "1M", "3M", "6M", "YTD", "1J", "5J", "MAX"] as const;
const RANGES: { value: Range; label: string }[] = RANGE_VALUES.map((r) => ({ value: r, label: r }));
const KINDS = ["candle", "line", "area"] as const;

const MA = [
  { n: 20, color: "#66b8ff" },
  { n: 50, color: "#ffa028" },
  { n: 200, color: "#c77dff" },
];

export interface Bar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  ts?: number; // Intraday: Original-Zeitstempel (UTC-Sekunden) für die Anzeige
}

export function rangeStart(range: Range, last: string): string {
  const shift = (months: number) => shiftMonths(last, months); // mit Monatsende-Begrenzung
  switch (range) {
    case "1M": return shift(1);
    case "3M": return shift(3);
    case "6M": return shift(6);
    // Stichtag 31.12. des Vorjahres: Der erste Balken des Jahres (auch ein 1. Januar, z. B. bei
    // Krypto) liegt danach. Mit "01-01" als Stichtag fand sich am 1.1. kein Balken und der Chart
    // fiel auf die gesamte Historie zurück.
    case "YTD": return `${Number(last.slice(0, 4)) - 1}-12-31`;
    case "1J": return shift(12);
    case "5J": return shift(60);
    default: return "0000-00-00";
  }
}

// Zeitstempel so verschieben, dass die Achse lokale Uhrzeit zeigt
const toLocal = (ts: number) => (ts - new Date(ts * 1000).getTimezoneOffset() * 60) as UTCTimestamp;

function sma(values: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let count = 0;
  const window: number[] = [];
  for (const v of values) {
    if (isNum(v)) {
      window.push(v);
      sum += v;
      count++;
      if (window.length > n) {
        sum -= window.shift()!;
        count--;
      }
    }
    out.push(count === n ? sum / n : null);
  }
  return out;
}

/**
 * Intraday-Balken mit Ortszeit-Achse. lightweight-charts verlangt streng aufsteigende Zeiten:
 * Bei der Zeitumstellung im Herbst wiederholt sich eine Ortsstunde (z. B. BTC rund um die Uhr),
 * deren zweite Hälfte wird übersprungen statt den Chart mit ungeordneten Daten zu füttern.
 */
export function intradayBars(d: Intraday, toTime: (ts: number) => UTCTimestamp = toLocal): Bar[] {
  const bars: Bar[] = [];
  d.t.forEach((ts, i) => {
    const o = d.o[i], h = d.h[i], l = d.l[i], c = d.c[i];
    const time = toTime(ts);
    if (bars.length && time <= (bars[bars.length - 1].time as number)) return;
    if (isNum(o) && isNum(h) && isNum(l) && isNum(c)) bars.push({ time, open: o, high: h, low: l, close: c, volume: d.v[i], ts });
  });
  return bars;
}

/** Tagesbalken; doppelte oder unsortierte Tage (Datenfehler der Quelle) werden übersprungen. */
export function dailyBars(h: History): Bar[] {
  const all: Bar[] = [];
  h.t.forEach((t, i) => {
    const c = h.c[i];
    if (!isNum(c)) return;
    if (all.length && t <= (all[all.length - 1].time as string)) return;
    const o = isNum(h.o[i]) ? h.o[i]! : c;
    const hi = isNum(h.h[i]) ? Math.max(h.h[i]!, o, c) : Math.max(o, c);
    const lo = isNum(h.l[i]) ? Math.min(h.l[i]!, o, c) : Math.min(o, c);
    all.push({ time: t as Time, open: o, high: hi, low: lo, close: c, volume: h.v[i] });
  });
  return all;
}

const MONTHS_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/**
 * Achsenbeschriftung auf Deutsch. Tagesmarken mit Monat ("12.10." statt "12"), damit sie
 * zwischen Monatsnamen nicht wie eine Jahreszahl oder ein Monat wirken.
 */
export function tickLabel(time: Time, type: TickMarkType): string {
  let d: Date;
  if (typeof time === "number") d = new Date(time * 1000);
  else if (typeof time === "string") d = new Date(`${time}T00:00:00Z`);
  else d = new Date(Date.UTC(time.year, time.month - 1, time.day));
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  switch (type) {
    case TickMarkType.Year:
      return String(d.getUTCFullYear());
    case TickMarkType.Month:
      return MONTHS_DE[d.getUTCMonth()];
    case TickMarkType.DayOfMonth:
      return `${dd}.${mm}.`;
    default:
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

/** VWAP je Handelstag (setzt an jedem neuen Tag zurück); ohne Volumen leer. */
export function vwapSeries(bars: Bar[]): { time: Time; value: number }[] {
  const out: { time: Time; value: number }[] = [];
  let day = "";
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    // b.ts sind UTC-Sekunden: als Millisekunden gelesen lagen alle Balken im Januar 1970 am
    // selben Tag, und der VWAP setzte über die 5T-Ansicht nie zurück
    const d = b.ts !== undefined ? new Date(b.ts * 1000).toISOString().slice(0, 10) : String(b.time);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    if (!isNum(b.volume) || b.volume <= 0) continue;
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    vol += b.volume;
    out.push({ time: b.time, value: pv / vol });
  }
  return out;
}

/**
 * Earnings-Marker: am Reaktionstag (vorbörslich: Berichtstag, nachbörslich: nächster Handelstag),
 * grün bei Übertreffen, rot bei Verfehlen der Schätzung.
 */
export function earningsMarkers(items: EarningsItem[], bars: Bar[]) {
  const times = bars.map((b) => String(b.time));
  const out: { time: Time; position: "aboveBar"; color: string; shape: "circle"; text: string }[] = [];
  for (const e of items) {
    if (!e.reportDate || !isNum(e.epsActual)) continue;
    const after = e.timing === "AfterMarket";
    const idx = times.findIndex((t) => (after ? t > e.reportDate! : t >= e.reportDate!));
    if (idx < 0) continue;
    const beat = isNum(e.epsEstimate) ? e.epsActual >= e.epsEstimate : true;
    out.push({ time: bars[idx].time, position: "aboveBar", color: beat ? "#29d17d" : "#ff5252", shape: "circle", text: "E" });
  }
  return out.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

/** Datum/Zeit im Fadenkreuz auf Deutsch (statt "29 Sep '26"). */
function crosshairTime(time: Time): string {
  if (typeof time === "number") {
    const d = new Date(time * 1000);
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}. ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  const iso = typeof time === "string" ? time : `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Bollinger-Bänder (n, k·σ) über Schlusskurse. */
function bollinger(values: number[], n = 20, k = 2): { upper: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const w = values.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    upper.push(m + k * sd);
    lower.push(m - k * sd);
  }
  return { upper, lower };
}

/** RSI nach Wilder für jede Position (null in der Anlaufphase). */
export function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    g += Math.max(d, 0);
    l += Math.max(-d, 0);
  }
  g /= period;
  l /= period;
  out[period] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/**
 * Basis für die Periodenrendite: Schlusskurs vor Periodenbeginn (wie Bloomberg/Reuters),
 * nicht der Eröffnungskurs des ersten Balkens. Nur ohne Vorperiode (MAX) zählt der erste Kurs.
 */
export function periodBase(all: Bar[], from: number): number | null {
  if (!all.length) return null;
  return from > 0 ? all[from - 1].close : all[0].open;
}

/** Letzter Tagesschluss vor einem Datum (Basis für 1T/5T). */
export function closeBefore(h: History | undefined, isoDate: string): number | null {
  if (!h) return null;
  let base: number | null = null;
  for (let i = 0; i < h.t.length; i++) {
    if (h.t[i] >= isoDate) break;
    if (isNum(h.c[i])) base = h.c[i];
  }
  return base;
}

type RsiPoint = { time: Time; value?: number };

/**
 * RSI-Punkte auf die Zeitachse des Kurscharts bringen. Im Vergleichsmodus enthält die Achse
 * auch Handelstage der Vergleichswerte (andere Feiertage); ohne Leerpunkte für diese Tage
 * liefe der über den logischen Bereich gekoppelte RSI-Chart seitlich versetzt.
 */
export function alignRsi(rsi: RsiPoint[], lines: { data: { time: Time }[] }[]): RsiPoint[] {
  const times = new Set(rsi.map((p) => String(p.time)));
  const before = times.size;
  for (const l of lines) for (const p of l.data) times.add(String(p.time));
  if (times.size === before) return rsi;
  const by = new Map(rsi.map((p) => [String(p.time), p]));
  return Array.from(times)
    .sort()
    .map((t) => by.get(t) ?? { time: t as Time });
}

// Stabile Referenz: useQueries liefert ohne combine bei jedem Render ein neues Array, wodurch
// der Daten-Effekt bei jeder Mausbewegung (Hover) alle Serien neu gesetzt hätte.
const combineCompare = (results: { data?: History; isError: boolean }[]) => results.map((r) => ({ data: r.data, isError: r.isError }));

const BENCHMARK: Record<string, string> = {
  US: "GSPC.INDX", XETRA: "GDAXI.INDX", PA: "FCHI.INDX", AS: "STOXX50E.INDX", SW: "SSMI.INDX", LSE: "FTSE.INDX",
};
// Unterscheidbar vom eigenen Kurs (orange), den SMAs (blau/orange/lila) und dem RSI (lila)
const COMPARE_COLORS = ["#4dd0e1", "#f06292", "#aed581", "#fff176"];

/** Aussehen einer Kursmarke im Chart je Zustand. */
export function markStyle(a: Pick<Alert, "alarm" | "active" | "triggeredAt" | "note">): { color: string; style: LineStyle; title: string } {
  if (!a.alarm) return { color: "#66b8ff", style: LineStyle.Dashed, title: a.note ? a.note.slice(0, 18) : "" };
  if (a.active) return { color: "#ffa028", style: LineStyle.Solid, title: "🔔" };
  return a.triggeredAt ? { color: "#29d17d", style: LineStyle.Dotted, title: "✓" } : { color: "#5c5c5c", style: LineStyle.Dotted, title: "" };
}

export default function GP({ ticker }: ScreenProps) {
  // Darstellung bleibt über Seiten- und Tickerwechsel sowie das Neuladen erhalten
  const [range, setRange] = usePersistentState<Range>("gp.range", "1J", isOneOf(RANGE_VALUES));
  const [kind, setKind] = usePersistentState<Kind>("gp.kind", "candle", isOneOf(KINDS));
  const [mas, setMas] = usePersistentState<number[]>("gp.mas", [50, 200], isNumberList([20, 50, 200]));
  const [boll, setBoll] = usePersistentState("gp.boll", false, isBool);
  const [showRsi, setShowRsi] = usePersistentState("gp.rsi", false, isBool);
  const [showVwap, setShowVwap] = usePersistentState("gp.vwap", true, isBool);
  const [compare, setCompare] = useState<string[]>([]);
  const [placing, setPlacing] = useState(false);
  const [markMsg, setMarkMsg] = useState<string | null>(null);
  const [chartGen, setChartGen] = useState(0);
  const alertsQ = useAlerts();
  const refreshAlerts = useAlertsRefresh();
  const marks = useMemo(() => (alertsQ.data?.alerts ?? []).filter((a) => a.ticker === ticker && a.kind === "price"), [alertsQ.data, ticker]);
  const [compareInput, setCompareInput] = useState("");
  const [compareErr, setCompareErr] = useState<string | null>(null);
  const intradayRange = range === "1T" || range === "5T";
  const hist = useHistory(ticker);
  const intra = useIntraday(ticker, range === "1T" ? 1 : 5, intradayRange);
  const isYield = ticker?.endsWith(".GBOND") ?? false;
  const comparing = compare.length > 0 && !intradayRange;

  const earn = useEarnings(ticker && isEquity(ticker) ? ticker : null);

  // Wertpapierwechsel: Vergleichswerte bleiben (ohne das neue Wertpapier selbst und nur gleicher
  // Art – Renditen werden in bp, Kurse in % verglichen)
  useEffect(() => {
    setCompare((c) => c.filter((x) => x !== ticker && x.endsWith(".GBOND") === isYield));
    setCompareErr(null); // Meldung gehörte zum vorherigen Wertpapier
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const compareQ = useQueries({
    queries: compare.map((t) => ({ queryKey: ["history", t], queryFn: () => api.history(t), staleTime: 60_000, retry })),
    combine: combineCompare,
  });

  const view = useMemo(() => {
    type Line = { time: Time; value: number };
    const empty = { bars: [] as Bar[], maLines: [] as { n: number; color: string; data: Line[] }[], base: null as number | null, bands: null as null | { upper: Line[]; lower: Line[] }, rsi: [] as (Line | { time: Time })[], start: "" };
    if (intradayRange) {
      const d = intra.data;
      if (!d || !d.t.length) return empty;
      const bars = intradayBars(d);
      const firstDay = new Date(d.t[0] * 1000).toISOString().slice(0, 10);
      const closes = bars.map((b) => b.close);
      const r = rsiSeries(closes);
      return { ...empty, bars, base: closeBefore(hist.data, firstDay) ?? bars[0]?.open ?? null, rsi: bars.map((b, i) => (r[i] === null ? { time: b.time } : { time: b.time, value: r[i]! })) };
    }
    const h = hist.data;
    if (!h || !h.t.length) return empty;
    const start = rangeStart(range, h.t[h.t.length - 1]);
    const all = dailyBars(h);
    // Erster Balken nach dem Stichtag (Stichtag = gleicher Kalendertag vor N Monaten)
    const first = all.findIndex((b) => (b.time as string) > start);
    const from = first < 0 ? 0 : range === "MAX" ? 0 : first;
    const closes = all.map((b) => b.close);
    const lines = MA.filter((m) => mas.includes(m.n)).map((m) => {
      const s = sma(closes, m.n);
      const data: Line[] = [];
      for (let i = from; i < all.length; i++) if (s[i] !== null) data.push({ time: all[i].time, value: s[i]! });
      return { ...m, data };
    });
    let bands: { upper: Line[]; lower: Line[] } | null = null;
    if (boll) {
      const b = bollinger(closes);
      bands = { upper: [], lower: [] };
      for (let i = from; i < all.length; i++) {
        if (b.upper[i] !== null) bands.upper.push({ time: all[i].time, value: b.upper[i]! });
        if (b.lower[i] !== null) bands.lower.push({ time: all[i].time, value: b.lower[i]! });
      }
    }
    const r = rsiSeries(closes);
    const rsi = all.slice(from).map((b, k) => (r[from + k] === null ? { time: b.time } : { time: b.time, value: r[from + k]! }));
    return { bars: all.slice(from), maLines: lines, base: periodBase(all, from), bands, rsi, start };
  }, [hist.data, intra.data, range, mas, intradayRange, boll]);

  const { bars, maLines, base, bands, rsi } = view;

  // Vergleich: Wertentwicklung in % ab Periodenbeginn, je Serie auf ihren Schluss vor dem Start normiert
  const compareLines = useMemo(() => {
    if (!comparing || !bars.length) return [];
    const startTime = bars[0].time as string;
    const norm = (h: History | undefined, label: string, color: string) => {
      if (!h) return null;
      const all = dailyBars(h);
      const idx = all.findIndex((b) => (b.time as string) >= startTime);
      if (idx < 0) return null;
      const b0 = periodBase(all, idx);
      if (!isNum(b0) || b0 === 0) return null;
      // Renditen: Veränderung in bp; Kurse: Wertentwicklung in %
      const data = all.slice(idx).map((b) => ({ time: b.time, value: isYield ? (b.close - b0) * 100 : (b.close / b0 - 1) * 100 }));
      return { label, color, data };
    };
    const own = norm(hist.data, ticker ? displayTicker(ticker) : "", "#ffa028");
    const others = compare.map((t, i) => norm(compareQ[i]?.data, displayTicker(t), COMPARE_COLORS[i % COMPARE_COLORS.length]));
    return [own, ...others].filter((x): x is NonNullable<typeof x> => !!x);
  }, [comparing, bars, hist.data, compare, compareQ, ticker, isYield]);

  const hostRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | null;
    vol: ISeriesApi<"Histogram"> | null;
    vwap: ISeriesApi<"Line"> | null;
    ma: Map<number, ISeriesApi<"Line">>;
    bands: ISeriesApi<"Line">[];
    cmp: ISeriesApi<"Line">[];
    rsi: ISeriesApi<"Line"> | null;
  } | null>(null);
  const barsRef = useRef<Map<string, Bar>>(new Map());
  const prevLineRef = useRef<ReturnType<ISeriesApi<"Line">["createPriceLine"]> | null>(null);
  const fitKey = useRef("");
  const [hover, setHover] = useState<Bar | null>(null);
  const hasData = bars.length > 0;
  const maKey = mas.slice().sort().join(",");
  const cmpKey = comparing ? compare.join(",") : "";
  // Der Preisformatierer lebt so lange wie der Chart; bei Tickerwechsel mit Daten im Cache wird
  // der Chart nicht neu gebaut – sonst zeigte EUR/USD nach einer Aktie nur zwei Nachkommastellen
  const tickerRef = useRef(ticker);
  tickerRef.current = ticker;

  // Chart nur bei neuer Darstellungsart aufbauen; neue Daten werden per setData eingespielt,
  // damit Zoom und Ausschnitt bei der automatischen Aktualisierung erhalten bleiben.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasData) return;
    const baseOptions = {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0a0a0a" }, textColor: "#8f8f8f", fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "#151515" }, horzLines: { color: "#151515" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#555", labelBackgroundColor: "#2a2a2a" }, horzLine: { color: "#555", labelBackgroundColor: "#2a2a2a" } },
      timeScale: { borderColor: "#262626", timeVisible: intradayRange, secondsVisible: false, rightOffset: 3, tickMarkFormatter: tickLabel },
    };
    // Gleich breite Preisachsen: sonst stehen Kurs- und RSI-Bereich gegeneinander versetzt
    const axisWidth = 76;
    const chart = createChart(host, {
      ...baseOptions,
      rightPriceScale: { borderColor: "#262626", minimumWidth: axisWidth, scaleMargins: { top: 0.08, bottom: comparing ? 0.05 : 0.22 } },
      localization: {
        locale: "de-DE",
        timeFormatter: crosshairTime,
        priceFormatter: (p: number) =>
          comparing ? (isYield ? fmtBp(p, false) : `${p >= 0 ? "+" : ""}${fmt(p, 1)} %`) : isYield ? `${fmt(p, 3)} %` : fmtPrice(p, tickerRef.current),
      },
    });
    chartRef.current = chart;
    const refs: NonNullable<typeof seriesRef.current> = { main: null, vol: null, vwap: null, ma: new Map(), bands: [], cmp: [], rsi: null };
    if (comparing) {
      for (let i = 0; i < compare.length + 1; i++) {
        refs.cmp.push(chart.addLineSeries({ color: i === 0 ? "#ffa028" : COMPARE_COLORS[(i - 1) % COMPARE_COLORS.length], lineWidth: i === 0 ? 2 : 1, priceLineVisible: false }));
      }
    } else {
      if (kind === "candle") {
        refs.main = chart.addCandlestickSeries({
          upColor: "#29d17d", downColor: "#ff5252", borderUpColor: "#29d17d", borderDownColor: "#ff5252",
          wickUpColor: "#29d17d", wickDownColor: "#ff5252", priceLineColor: "#ffa028",
        });
      } else if (kind === "line") {
        refs.main = chart.addLineSeries({ color: "#ececec", lineWidth: 2, priceLineColor: "#ececec" });
      } else {
        refs.main = chart.addAreaSeries({ lineColor: "#ececec", topColor: "rgba(236,236,236,0.22)", bottomColor: "rgba(236,236,236,0.02)", lineWidth: 2 });
      }
      refs.vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      for (const m of MA.filter((m) => maKey.split(",").includes(String(m.n)))) {
        refs.ma.set(m.n, chart.addLineSeries({ color: m.color, lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }));
      }
      if (intradayRange && showVwap) {
        refs.vwap = chart.addLineSeries({ color: "#f2c200", lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      }
      if (boll && !intradayRange) {
        for (let i = 0; i < 2; i++) {
          refs.bands.push(chart.addLineSeries({ color: "rgba(102,184,255,0.55)", lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }));
        }
      }
    }
    let rsiChart: IChartApi | null = null;
    const syncers: (() => void)[] = [];
    if (showRsi && rsiRef.current) {
      rsiChart = createChart(rsiRef.current, {
        ...baseOptions,
        rightPriceScale: { borderColor: "#262626", minimumWidth: axisWidth, scaleMargins: { top: 0.1, bottom: 0.1 } },
        localization: { locale: "de-DE", timeFormatter: crosshairTime, priceFormatter: (p: number) => fmt(p, 0) },
        timeScale: { ...baseOptions.timeScale, visible: false },
        handleScroll: false,
        handleScale: false,
      });
      rsiChartRef.current = rsiChart;
      refs.rsi = rsiChart.addLineSeries({ color: "#c77dff", lineWidth: 1, priceLineVisible: false });
      refs.rsi.createPriceLine({ price: 70, color: "#ff5252", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" });
      refs.rsi.createPriceLine({ price: 30, color: "#29d17d", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" });
      // Zeitachsen koppeln: Zoom und Scrollen im Kurschart bewegen den RSI mit
      const onRange = (r: unknown) => r && rsiChart?.timeScale().setVisibleLogicalRange(r as never);
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      syncers.push(() => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));
    }
    seriesRef.current = refs;
    prevLineRef.current = null;
    setChartGen((g) => g + 1); // Kursmarken auf dem neuen Chart neu zeichnen
    fitKey.current = "";
    // Panelgröße geändert (Maximieren, Layout, Fenster): Inhalt neu einpassen, sonst blieb nach
    // dem Maximieren der linke Teil des Charts leer
    let lastWidth = host.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - lastWidth) < 40) return;
      lastWidth = host.clientWidth;
      chart.timeScale().fitContent();
      rsiChart?.timeScale().fitContent();
    });
    ro.observe(host);
    syncers.push(() => ro.disconnect());
    const onMove = (p: MouseEventParams) => {
      setHover(p.time !== undefined ? barsRef.current.get(String(p.time)) ?? null : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      syncers.forEach((f) => f());
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      rsiChart?.remove();
      chartRef.current = null;
      rsiChartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, kind, intradayRange, isYield, maKey, boll, showRsi, cmpKey, showVwap]);

  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart || !bars.length) return;
    barsRef.current = new Map(bars.map((b) => [String(b.time), b]));
    if (s.main) {
      // Achsenschritte passend zum Instrument (EUR/USD in Pips statt 0,01)
      const digits = isYield ? 3 : priceDigits(bars[bars.length - 1].close, ticker);
      s.main.applyOptions({ priceFormat: { type: "price", precision: digits, minMove: 10 ** -digits } });
      if (kind === "candle") {
        (s.main as ISeriesApi<"Candlestick">).setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      } else {
        (s.main as ISeriesApi<"Line">).setData(bars.map((b) => ({ time: b.time, value: b.close })));
      }
    }
    s.vol?.setData(
      bars.some((b) => isNum(b.volume))
        ? bars.map((b) => ({ time: b.time, value: b.volume ?? 0, color: b.close >= b.open ? "rgba(41,209,125,0.35)" : "rgba(255,82,82,0.35)" }))
        : [],
    );
    for (const m of maLines) s.ma.get(m.n)?.setData(m.data);
    s.vwap?.setData(vwapSeries(bars));
    if (s.main) {
      // Vortagesschluss als Linie im Intraday-Chart; Earnings-Marker im Tageschart
      if (prevLineRef.current) s.main.removePriceLine(prevLineRef.current);
      prevLineRef.current =
        intradayRange && isNum(base)
          ? s.main.createPriceLine({ price: base, color: "#777", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Vortag" })
          : null;
      s.main.setMarkers(!intradayRange && earn.data ? earningsMarkers(earn.data.history, bars) : []);
    }
    if (bands && s.bands.length === 2) {
      s.bands[0].setData(bands.upper);
      s.bands[1].setData(bands.lower);
    }
    compareLines.forEach((l, i) => s.cmp[i]?.setData(l.data));
    s.rsi?.setData((comparing ? alignRsi(rsi, compareLines) : rsi) as never);
    const key = `${ticker}|${range}|${kind}|${maKey}|${cmpKey}|${showRsi}`;
    if (fitKey.current !== key) {
      chart.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
      fitKey.current = key;
    }
  }, [bars, maLines, bands, rsi, compareLines, comparing, kind, range, ticker, maKey, cmpKey, showRsi, base, intradayRange, earn.data, isYield]);

  // Kursmarken und Alarme als waagerechte Linien (nicht im Prozent-Vergleich)
  const markLines = useRef<IPriceLine[]>([]);
  const marksKey = marks.map((m) => `${m.id}:${m.level}:${m.alarm}:${m.active}:${m.triggeredAt ?? ""}:${m.note}`).join("|");
  useEffect(() => {
    const main = seriesRef.current?.main;
    for (const l of markLines.current) {
      try {
        main?.removePriceLine(l);
      } catch {
        /* Linie gehörte zum vorigen Chart */
      }
    }
    markLines.current = [];
    if (!main || comparing) return;
    markLines.current = marks.map((m) => {
      const st = markStyle(m);
      return main.createPriceLine({ price: m.level, color: st.color, lineWidth: 1, lineStyle: st.style, axisLabelVisible: true, title: st.title });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksKey, chartGen, comparing]);

  // „＋ Marke“: nächster Klick in den Chart setzt eine Kursmarke mit Alarm
  useEffect(() => {
    const chart = chartRef.current;
    const main = seriesRef.current?.main;
    if (!placing || !chart || !main || !ticker) return;
    const onClick = (p: MouseEventParams) => {
      if (!p.point) return;
      const raw = main.coordinateToPrice(p.point.y);
      if (raw === null || !isNum(raw) || raw <= 0) return;
      const digits = isYield ? 3 : priceDigits(raw, ticker);
      const level = Number(raw.toFixed(digits));
      setPlacing(false);
      alertsApi
        .create({ ticker, kind: "price", level, direction: null, alarm: true })
        .then(() => setMarkMsg(null))
        .catch((e: unknown) => setMarkMsg(e instanceof Error ? e.message : String(e)))
        .finally(() => refreshAlerts());
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // nur das Setzen abbrechen, nicht im Panel zurückgehen
      setPlacing(false);
    };
    chart.subscribeClick(onClick);
    window.addEventListener("keydown", onKey, true);
    return () => {
      chart.unsubscribeClick(onClick);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing, chartGen, ticker, isYield]);

  useEffect(() => {
    setPlacing(false);
    setMarkMsg(null);
  }, [ticker]);

  async function markAction(fn: () => Promise<unknown>) {
    try {
      await fn();
      setMarkMsg(null);
    } catch (e) {
      setMarkMsg(e instanceof Error ? e.message : String(e));
    } finally {
      refreshAlerts();
    }
  }

  // Vergleichswerte erst nach Prüfung übernehmen: ein Tippfehler soll keinen leeren Chip erzeugen
  const [checkingCompare, setCheckingCompare] = useState(false);
  async function addCompare(raw: string) {
    const base = ticker;
    let t = normalizeTicker(raw);
    if (!t) return setCompareErr("Ticker nicht erkannt.");
    if (t === ticker || compare.includes(t)) return setCompareErr("Bereits im Chart.");
    if (compare.length >= 4) return setCompareErr("Höchstens vier Vergleichswerte.");
    if (t.endsWith(".GBOND") !== isYield) {
      return setCompareErr(isYield ? "Renditen werden in bp verglichen – bitte eine Anleihe (z. B. DE10Y Govt)." : "Renditen lassen sich nicht in % vergleichen – im Renditechart vergleichen.");
    }
    setCheckingCompare(true);
    try {
      t = (await api.resolve(t)).ticker;
    } catch (e) {
      // Inzwischen anderes Wertpapier: keine Meldung zum alten Vergleich beim neuen Chart zeigen
      if (tickerRef.current !== base) return;
      setCompareErr(e instanceof ApiError && e.status === 404 ? unknownSecurityMessage(raw, t, e.message) : "Ticker konnte nicht geprüft werden.");
      return;
    } finally {
      setCheckingCompare(false);
    }
    if (tickerRef.current !== base) return; // inzwischen anderes Wertpapier
    const added = t;
    setCompare((c) => (c.includes(added) || added === ticker || c.length >= 4 ? c : [...c, added]));
    setCompareInput("");
    setCompareErr(null);
  }

  const loading = intradayRange ? intra.isPending : hist.isPending;
  const error = intradayRange ? intra.error : hist.error;
  const last = bars[bars.length - 1];
  const shown = hover ?? last;
  const shownIdx = shown ? bars.indexOf(shown) : -1;
  const prevClose = shownIdx > 0 ? bars[shownIdx - 1].close : shownIdx === 0 ? base : null;
  const rangeChg = bars.length && isNum(base) && base !== 0 ? (last.close / base - 1) * 100 : null;
  const rangeChgBp = bars.length && isNum(base) ? (last.close - base) * 100 : null;
  const exch = ticker?.slice(ticker.lastIndexOf(".") + 1) ?? "";
  const benchmark = BENCHMARK[exch] ?? "GSPC.INDX";
  const compareFailed = compare.filter((_, i) => compareQ[i]?.isError);

  return (
    <>
      <div className="toolbar">
        <Seg label="Zeitraum" value={range} options={RANGES} onChange={setRange} />
        <span className="sep" />
        {!comparing && (
          <Seg
            label="Darstellung"
            value={kind}
            options={[
              { value: "candle", label: "Kerzen" },
              { value: "line", label: "Linie" },
              { value: "area", label: "Fläche" },
            ]}
            onChange={setKind}
          />
        )}
        {!intradayRange && !comparing && (
          <>
            {MA.map((m) => (
              <label key={m.n} className="check" style={{ color: mas.includes(m.n) ? m.color : undefined }}>
                <input type="checkbox" checked={mas.includes(m.n)} onChange={(e) => setMas((x) => (e.target.checked ? [...x, m.n] : x.filter((n) => n !== m.n)))} />
                SMA {m.n}
              </label>
            ))}
            <label className="check" style={{ color: boll ? "#66b8ff" : undefined }} title="Bollinger-Bänder 20 Tage, ±2 Standardabweichungen">
              <input type="checkbox" checked={boll} onChange={(e) => setBoll(e.target.checked)} />
              BB 20
            </label>
          </>
        )}
        {intradayRange && !isYield && (
          <label className="check" style={{ color: showVwap ? "#f2c200" : undefined }} title="Volumengewichteter Durchschnittskurs je Handelstag">
            <input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)} />
            VWAP
          </label>
        )}
        <label className="check" style={{ color: showRsi ? "#c77dff" : undefined }}>
          <input type="checkbox" checked={showRsi} onChange={(e) => setShowRsi(e.target.checked)} />
          RSI 14
        </label>
        {intradayRange && compare.length > 0 && <span className="small muted">Vergleich ab 1M</span>}
        {!intradayRange && (
          <>
            <span className="sep" />
            <form
              style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!checkingCompare) void addCompare(compareInput);
              }}
            >
              <input
                className="field"
                style={{ width: 96 }}
                placeholder="Vergleich +"
                aria-label="Vergleichswert hinzufügen"
                value={compareInput}
                onChange={(e) => {
                  setCompareInput(e.target.value);
                  setCompareErr(null);
                }}
              />
              {!isYield && !compare.includes(benchmark) && benchmark !== ticker && (
                <button type="button" className="btn" disabled={checkingCompare} onClick={() => void addCompare(benchmark)} title={`Mit ${displayTicker(benchmark)} vergleichen`}>
                  Index
                </button>
              )}
            </form>
            {compare.map((t, i) => (
              <span key={t} className="tag" style={{ borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length], color: COMPARE_COLORS[i % COMPARE_COLORS.length] }}>
                {displayTicker(t)}{" "}
                <button className="tool" style={{ height: 14, padding: 0 }} aria-label={`${t} entfernen`} onClick={() => setCompare((c) => c.filter((x) => x !== t))}>
                  ×
                </button>
              </span>
            ))}
            {compareErr && <span className="small down">{compareErr}</span>}
            {compareFailed.length > 0 && <span className="small down">Keine Kurse für {compareFailed.map(displayTicker).join(", ")}</span>}
          </>
        )}
        {!comparing && !IS_STATIC && hasData && (
          <>
            <span className="sep" />
            <button
              type="button"
              className={`btn ${placing ? "primary" : ""}`}
              aria-pressed={placing}
              title="Kursmarke mit Alarm setzen: danach in den Chart auf die gewünschte Höhe klicken (Esc bricht ab)"
              onClick={() => setPlacing((p) => !p)}
            >
              ＋ Marke
            </button>
          </>
        )}
        {bars.length > 0 && (
          <span className="small" style={{ marginLeft: "auto" }} title="Veränderung gegenüber dem Schlusskurs vor Beginn des Zeitraums">
            <span className="muted">{range}: </span>
            {isYield ? (
              <span className={tone(rangeChgBp, 0)}>{isNum(rangeChgBp) ? fmtBp(rangeChgBp, false) : "–"}</span>
            ) : (
              <span className={tone(rangeChg)}>{fmtPct(rangeChg)}</span>
            )}
          </span>
        )}
      </div>
      <div className="chart-wrap" style={{ display: "flex", flexDirection: "column" }}>
        {loading ? (
          <Loading rows={4} />
        ) : error && !hasData ? (
          // Bei vorhandenen Daten bleibt der Chart stehen: Würde der Host bei einem fehlgeschlagenen
          // Hintergrund-Abruf ausgehängt, bliebe er danach leer (der Chart wird nicht neu erzeugt).
          <ErrorState error={error} onRetry={() => (intradayRange ? intra.refetch() : hist.refetch())} />
        ) : !bars.length ? (
          <div className="state">
            {intradayRange ? "Keine Intraday-Daten für diesen Zeitraum (Plan oder Handelszeit)." : "Keine Kursdaten."}
          </div>
        ) : (
          <>
            {shown && !comparing && (
              <div className="chart-ohlc">
                <span>
                  {/* Original-Zeitstempel statt Rückrechnung mit dem heutigen UTC-Offset (falsch über Sommerzeitwechsel) */}
                  {intradayRange && shown.ts !== undefined ? `${fmtDate(shown.ts)} ${fmtTime(shown.ts)}` : fmtDate(shown.time as string)}
                </span>
                <span>E <b>{fmtPrice(shown.open, ticker)}</b></span>
                <span>H <b>{fmtPrice(shown.high, ticker)}</b></span>
                <span>T <b>{fmtPrice(shown.low, ticker)}</b></span>
                <span>S <b>{fmtPrice(shown.close, ticker)}</b></span>
                {isNum(prevClose) && !isYield && <span className={tone(shown.close - prevClose)}>{fmtPct((shown.close / prevClose - 1) * 100)}</span>}
                {isNum(prevClose) && isYield && <span className={tone(shown.close - prevClose, 2)}>{fmtBp(shown.close - prevClose)}</span>}
                {isNum(shown.volume) && <span>Vol <b>{fmtBig(shown.volume)}</b></span>}
              </div>
            )}
            {comparing && (
              <div className="chart-ohlc">
                {hover && <span>{fmtDate(hover.time as string)}</span>}
                {compareLines.map((l) => {
                  // Beim Überfahren der Wert zum Datum unter dem Fadenkreuz, sonst der letzte
                  const at = hover ? l.data.find((p) => p.time === hover.time) : l.data[l.data.length - 1];
                  return (
                    <span key={l.label} style={{ color: l.color }}>
                      {l.label} <b>{isYield ? fmtBp(at?.value, false) : fmtPct(at?.value)}</b>
                    </span>
                  );
                })}
              </div>
            )}
            <div style={{ position: "relative", flex: showRsi ? "1 1 74%" : "1 1 100%", minHeight: 0 }}>
              {placing && <div className="placing-hint">In den Chart klicken, um die Marke zu setzen · Esc bricht ab</div>}
              <div className={`chart-host ${placing ? "placing" : ""}`} ref={hostRef} />
            </div>
            {showRsi && (
              <div style={{ position: "relative", flex: "0 0 26%", minHeight: 70, borderTop: "1px solid var(--rule)" }}>
                <span className="xs" style={{ position: "absolute", left: 8, top: 2, zIndex: 3, color: "#c77dff" }}>RSI 14</span>
                <div className="chart-host" ref={rsiRef} />
              </div>
            )}
            {!comparing && (marks.length > 0 || markMsg) && (
              <div className="chart-marks" aria-label="Kursmarken">
                <span className="muted">Marken</span>
                {marks
                  .slice()
                  .sort((a, b) => b.level - a.level)
                  .map((m) => {
                    const st = alertStatus(m);
                    return (
                      <span key={m.id} className={`mark-chip ${st === "armed" ? "armed" : ""}`} title={m.note || undefined}>
                        <button
                          type="button"
                          title={m.alarm ? "Alarm aus (Marke bleibt)" : "Alarm einschalten"}
                          onClick={() => markAction(() => alertsApi.update(m.id, { alarm: !m.alarm }))}
                        >
                          {st === "armed" ? "🔔" : st === "fired" ? "✓" : st === "mark" ? "🔕" : "○"}
                        </button>
                        {fmtPrice(m.level, ticker)}
                        {(st === "fired" || st === "off") && (
                          <button type="button" title="Wieder scharf schalten" onClick={() => markAction(() => alertsApi.update(m.id, { active: true }))}>
                            ↻
                          </button>
                        )}
                        <button type="button" title="Marke löschen" aria-label={`Marke ${fmtPrice(m.level, ticker)} löschen`} onClick={() => markAction(() => alertsApi.remove(m.id))}>
                          ×
                        </button>
                      </span>
                    );
                  })}
                {markMsg && <span className="down">{markMsg}</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div className="notes">Charts: <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">TradingView Lightweight Charts</a></div>
    </>
  );
}
