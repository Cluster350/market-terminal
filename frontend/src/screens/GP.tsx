// GP – Kurschart mit Kerzen/Linie, Volumen, gleitenden Durchschnitten und Zeiträumen.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { ErrorState, Loading, Seg } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { normalizeTicker, unknownSecurityMessage } from "../lib/commands";
import { displayTicker, fmt, fmtBig, fmtDate, fmtPct, fmtPrice, fmtTime, isNum, shiftMonths, tone } from "../lib/format";
import { retry, useHistory, useIntraday } from "../lib/queries";
import type { History, Intraday } from "../lib/types";
import type { ScreenProps } from "./types";

type Range = "1T" | "5T" | "1M" | "3M" | "6M" | "YTD" | "1J" | "5J" | "MAX";
type Kind = "candle" | "line" | "area";

const RANGES: { value: Range; label: string }[] = ["1T", "5T", "1M", "3M", "6M", "YTD", "1J", "5J", "MAX"].map((r) => ({ value: r as Range, label: r }));

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
const COMPARE_COLORS = ["#66b8ff", "#c77dff", "#29d17d", "#ff8a65"];

export default function GP({ ticker }: ScreenProps) {
  const [range, setRange] = useState<Range>("1J");
  const [kind, setKind] = useState<Kind>("candle");
  const [mas, setMas] = useState<number[]>([50, 200]);
  const [boll, setBoll] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareInput, setCompareInput] = useState("");
  const [compareErr, setCompareErr] = useState<string | null>(null);
  const intradayRange = range === "1T" || range === "5T";
  const hist = useHistory(ticker);
  const intra = useIntraday(ticker, range === "1T" ? 1 : 5, intradayRange);
  const isYield = ticker?.endsWith(".GBOND") ?? false;
  const comparing = compare.length > 0 && !intradayRange;

  // Wertpapierwechsel: Vergleichsliste leeren
  useEffect(() => {
    setCompare([]);
    setCompareErr(null); // Meldung gehörte zum vorherigen Wertpapier
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
      const data = all.slice(idx).map((b) => ({ time: b.time, value: (b.close / b0 - 1) * 100 }));
      return { label, color, data };
    };
    const own = norm(hist.data, ticker ? displayTicker(ticker) : "", "#ffa028");
    const others = compare.map((t, i) => norm(compareQ[i]?.data, displayTicker(t), COMPARE_COLORS[i % COMPARE_COLORS.length]));
    return [own, ...others].filter((x): x is NonNullable<typeof x> => !!x);
  }, [comparing, bars, hist.data, compare, compareQ, ticker]);

  const hostRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | null;
    vol: ISeriesApi<"Histogram"> | null;
    ma: Map<number, ISeriesApi<"Line">>;
    bands: ISeriesApi<"Line">[];
    cmp: ISeriesApi<"Line">[];
    rsi: ISeriesApi<"Line"> | null;
  } | null>(null);
  const barsRef = useRef<Map<string, Bar>>(new Map());
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
      timeScale: { borderColor: "#262626", timeVisible: intradayRange, secondsVisible: false, rightOffset: 3 },
    };
    const chart = createChart(host, {
      ...baseOptions,
      rightPriceScale: { borderColor: "#262626", scaleMargins: { top: 0.08, bottom: comparing ? 0.05 : 0.22 } },
      localization: {
        locale: "de-DE",
        priceFormatter: (p: number) => (comparing ? `${p >= 0 ? "+" : ""}${fmt(p, 1)} %` : isYield ? `${fmt(p, 3)} %` : fmtPrice(p, tickerRef.current)),
      },
    });
    chartRef.current = chart;
    const refs: NonNullable<typeof seriesRef.current> = { main: null, vol: null, ma: new Map(), bands: [], cmp: [], rsi: null };
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
        rightPriceScale: { borderColor: "#262626", scaleMargins: { top: 0.1, bottom: 0.1 } },
        localization: { locale: "de-DE", priceFormatter: (p: number) => fmt(p, 0) },
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
    fitKey.current = "";
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
  }, [hasData, kind, intradayRange, isYield, maKey, boll, showRsi, cmpKey]);

  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart || !bars.length) return;
    barsRef.current = new Map(bars.map((b) => [String(b.time), b]));
    if (s.main) {
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
  }, [bars, maLines, bands, rsi, compareLines, comparing, kind, range, ticker, maKey, cmpKey, showRsi]);

  // Vergleichswerte erst nach Prüfung übernehmen: ein Tippfehler soll keinen leeren Chip erzeugen
  const [checkingCompare, setCheckingCompare] = useState(false);
  async function addCompare(raw: string) {
    const base = ticker;
    let t = normalizeTicker(raw);
    if (!t) return setCompareErr("Ticker nicht erkannt.");
    if (t === ticker || compare.includes(t)) return setCompareErr("Bereits im Chart.");
    if (compare.length >= 4) return setCompareErr("Höchstens vier Vergleichswerte.");
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
        <label className="check" style={{ color: showRsi ? "#c77dff" : undefined }}>
          <input type="checkbox" checked={showRsi} onChange={(e) => setShowRsi(e.target.checked)} />
          RSI 14
        </label>
        {!isYield && !intradayRange && (
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
              {!compare.includes(benchmark) && benchmark !== ticker && (
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
        {bars.length > 0 && (
          <span className="small" style={{ marginLeft: "auto" }} title="Veränderung gegenüber dem Schlusskurs vor Beginn des Zeitraums">
            <span className="muted">{range}: </span>
            {isYield ? (
              <span className={tone(rangeChgBp)}>{isNum(rangeChgBp) ? `${rangeChgBp >= 0 ? "+" : ""}${Math.round(rangeChgBp)} bp` : "–"}</span>
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
                {isNum(prevClose) && isYield && <span className={tone(shown.close - prevClose)}>{`${shown.close - prevClose >= 0 ? "+" : ""}${Math.round((shown.close - prevClose) * 100)} bp`}</span>}
                {isNum(shown.volume) && <span>Vol <b>{fmtBig(shown.volume)}</b></span>}
              </div>
            )}
            {comparing && (
              <div className="chart-ohlc">
                {compareLines.map((l) => (
                  <span key={l.label} style={{ color: l.color }}>
                    {l.label} <b>{fmtPct(l.data[l.data.length - 1]?.value)}</b>
                  </span>
                ))}
              </div>
            )}
            <div style={{ position: "relative", flex: showRsi ? "1 1 74%" : "1 1 100%", minHeight: 0 }}>
              <div className="chart-host" ref={hostRef} />
            </div>
            {showRsi && (
              <div style={{ position: "relative", flex: "0 0 26%", minHeight: 70, borderTop: "1px solid var(--rule)" }}>
                <span className="xs" style={{ position: "absolute", left: 8, top: 2, zIndex: 3, color: "#c77dff" }}>RSI 14</span>
                <div className="chart-host" ref={rsiRef} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="notes">Charts: <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener">TradingView Lightweight Charts</a></div>
    </>
  );
}
