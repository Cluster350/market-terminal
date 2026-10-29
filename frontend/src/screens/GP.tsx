// GP – Kurschart mit Kerzen/Linie, Volumen, gleitenden Durchschnitten und Zeiträumen.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { fmt, fmtBig, fmtDate, fmtPct, fmtPrice, fmtTime, isNum, shiftMonths, tone } from "../lib/format";
import { useHistory, useIntraday } from "../lib/queries";
import type { ScreenProps } from "./types";

type Range = "1T" | "5T" | "1M" | "3M" | "6M" | "YTD" | "1J" | "5J" | "MAX";
type Kind = "candle" | "line" | "area";

const RANGES: { value: Range; label: string }[] = ["1T", "5T", "1M", "3M", "6M", "YTD", "1J", "5J", "MAX"].map((r) => ({ value: r as Range, label: r }));

const MA = [
  { n: 20, color: "#66b8ff" },
  { n: 50, color: "#ffa028" },
  { n: 200, color: "#c77dff" },
];

interface Bar {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  ts?: number; // Intraday: Original-Zeitstempel (UTC-Sekunden) für die Anzeige
}

function rangeStart(range: Range, last: string): string {
  const shift = (months: number) => shiftMonths(last, months); // mit Monatsende-Begrenzung
  switch (range) {
    case "1M": return shift(1);
    case "3M": return shift(3);
    case "6M": return shift(6);
    case "YTD": return `${last.slice(0, 4)}-01-01`;
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

export default function GP({ ticker }: ScreenProps) {
  const [range, setRange] = useState<Range>("1J");
  const [kind, setKind] = useState<Kind>("candle");
  const [mas, setMas] = useState<number[]>([50, 200]);
  const intradayRange = range === "1T" || range === "5T";
  const hist = useHistory(ticker);
  const intra = useIntraday(ticker, range === "1T" ? 1 : 5, intradayRange);

  const isYield = ticker?.endsWith(".GBOND") ?? false;

  const { bars, maLines } = useMemo(() => {
    if (intradayRange) {
      const d = intra.data;
      if (!d) return { bars: [] as Bar[], maLines: [] as { n: number; color: string; data: { time: Time; value: number }[] }[] };
      const bars: Bar[] = [];
      d.t.forEach((ts, i) => {
        const o = d.o[i], h = d.h[i], l = d.l[i], c = d.c[i];
        if (isNum(o) && isNum(h) && isNum(l) && isNum(c)) bars.push({ time: toLocal(ts), open: o, high: h, low: l, close: c, volume: d.v[i], ts });
      });
      return { bars, maLines: [] };
    }
    const h = hist.data;
    if (!h || !h.t.length) return { bars: [] as Bar[], maLines: [] };
    const start = rangeStart(range, h.t[h.t.length - 1]);
    const all: Bar[] = [];
    const idx: number[] = [];
    h.t.forEach((t, i) => {
      const c = h.c[i];
      if (!isNum(c)) return;
      const o = isNum(h.o[i]) ? h.o[i]! : c;
      const hi = isNum(h.h[i]) ? Math.max(h.h[i]!, o, c) : Math.max(o, c);
      const lo = isNum(h.l[i]) ? Math.min(h.l[i]!, o, c) : Math.min(o, c);
      all.push({ time: t as Time, open: o, high: hi, low: lo, close: c, volume: h.v[i] });
      idx.push(i);
    });
    const first = all.findIndex((b) => (b.time as string) >= start);
    const from = first < 0 ? 0 : first;
    const closes = all.map((b) => b.close);
    const lines = MA.filter((m) => mas.includes(m.n)).map((m) => {
      const s = sma(closes, m.n);
      const data: { time: Time; value: number }[] = [];
      for (let i = from; i < all.length; i++) if (s[i] !== null) data.push({ time: all[i].time, value: s[i]! });
      return { ...m, data };
    });
    return { bars: all.slice(from), maLines: lines };
  }, [hist.data, intra.data, range, mas, intradayRange]);

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
    vol: ISeriesApi<"Histogram">;
    ma: Map<number, ISeriesApi<"Line">>;
  } | null>(null);
  const barsRef = useRef<Map<string, Bar>>(new Map());
  const fitKey = useRef("");
  const [hover, setHover] = useState<Bar | null>(null);
  const hasData = bars.length > 0;
  const maKey = mas.slice().sort().join(",");

  // Chart nur bei neuer Darstellungsart aufbauen; neue Daten werden per setData eingespielt,
  // damit Zoom und Ausschnitt bei der automatischen Aktualisierung erhalten bleiben.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !hasData) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0a0a0a" }, textColor: "#8f8f8f", fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: "#151515" }, horzLines: { color: "#151515" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#555", labelBackgroundColor: "#2a2a2a" }, horzLine: { color: "#555", labelBackgroundColor: "#2a2a2a" } },
      rightPriceScale: { borderColor: "#262626", scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: "#262626", timeVisible: intradayRange, secondsVisible: false, rightOffset: 3 },
      localization: {
        locale: "de-DE",
        priceFormatter: (p: number) => (isYield ? `${fmt(p, 3)} %` : fmtPrice(p)),
      },
    });
    chartRef.current = chart;
    let main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
    if (kind === "candle") {
      main = chart.addCandlestickSeries({
        upColor: "#29d17d", downColor: "#ff5252", borderUpColor: "#29d17d", borderDownColor: "#ff5252",
        wickUpColor: "#29d17d", wickDownColor: "#ff5252", priceLineColor: "#ffa028",
      });
    } else if (kind === "line") {
      main = chart.addLineSeries({ color: "#ffa028", lineWidth: 2, priceLineColor: "#ffa028" });
    } else {
      main = chart.addAreaSeries({ lineColor: "#ffa028", topColor: "rgba(255,160,40,0.28)", bottomColor: "rgba(255,160,40,0.02)", lineWidth: 2 });
    }
    const vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const ma = new Map<number, ISeriesApi<"Line">>();
    for (const m of MA.filter((m) => maKey.split(",").includes(String(m.n)))) {
      ma.set(m.n, chart.addLineSeries({ color: m.color, lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }));
    }
    seriesRef.current = { main, vol, ma };
    fitKey.current = "";
    const onMove = (p: MouseEventParams) => {
      setHover(p.time !== undefined ? barsRef.current.get(String(p.time)) ?? null : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [hasData, kind, intradayRange, isYield, maKey]);

  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart || !bars.length) return;
    barsRef.current = new Map(bars.map((b) => [String(b.time), b]));
    if (kind === "candle") {
      (s.main as ISeriesApi<"Candlestick">).setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else {
      (s.main as ISeriesApi<"Line">).setData(bars.map((b) => ({ time: b.time, value: b.close })));
    }
    s.vol.setData(
      bars.some((b) => isNum(b.volume))
        ? bars.map((b) => ({ time: b.time, value: b.volume ?? 0, color: b.close >= b.open ? "rgba(41,209,125,0.35)" : "rgba(255,82,82,0.35)" }))
        : [],
    );
    for (const m of maLines) s.ma.get(m.n)?.setData(m.data);
    const key = `${ticker}|${range}|${kind}|${maKey}`;
    if (fitKey.current !== key) {
      chart.timeScale().fitContent();
      fitKey.current = key;
    }
  }, [bars, maLines, kind, range, ticker, maKey]);

  const loading = intradayRange ? intra.isPending : hist.isPending;
  const error = intradayRange ? intra.error : hist.error;
  const last = bars[bars.length - 1];
  const shown = hover ?? last;
  const shownIdx = shown ? bars.indexOf(shown) : -1;
  const prevClose = shownIdx > 0 ? bars[shownIdx - 1].close : null;
  const rangeChg = bars.length > 1 ? (last.close / bars[0].open - 1) * 100 : null;
  const rangeChgBp = bars.length > 1 ? (last.close - bars[0].open) * 100 : null;

  return (
    <>
      <div className="toolbar">
        <Seg label="Zeitraum" value={range} options={RANGES} onChange={setRange} />
        <span className="sep" />
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
        {!intradayRange && (
          <>
            <span className="sep" />
            {MA.map((m) => (
              <label key={m.n} className="check" style={{ color: mas.includes(m.n) ? m.color : undefined }}>
                <input type="checkbox" checked={mas.includes(m.n)} onChange={(e) => setMas((x) => (e.target.checked ? [...x, m.n] : x.filter((n) => n !== m.n)))} />
                SMA {m.n}
              </label>
            ))}
          </>
        )}
        {bars.length > 1 && (
          <span className="small" style={{ marginLeft: "auto" }}>
            <span className="muted">{range}: </span>
            {isYield ? <span className={tone(rangeChgBp)}>{`${rangeChgBp! >= 0 ? "+" : ""}${Math.round(rangeChgBp!)} bp`}</span> : <span className={tone(rangeChg)}>{fmtPct(rangeChg)}</span>}
          </span>
        )}
      </div>
      <div className="chart-wrap">
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
            {shown && (
              <div className="chart-ohlc">
                <span>
                  {/* Original-Zeitstempel statt Rückrechnung mit dem heutigen UTC-Offset (falsch über Sommerzeitwechsel) */}
                  {intradayRange && shown.ts !== undefined ? `${fmtDate(shown.ts)} ${fmtTime(shown.ts)}` : fmtDate(shown.time as string)}
                </span>
                <span>O <b>{fmtPrice(shown.open)}</b></span>
                <span>H <b>{fmtPrice(shown.high)}</b></span>
                <span>T <b>{fmtPrice(shown.low)}</b></span>
                <span>S <b>{fmtPrice(shown.close)}</b></span>
                {prevClose !== null && !isYield && <span className={tone(shown.close - prevClose)}>{fmtPct((shown.close / prevClose - 1) * 100)}</span>}
                {isNum(shown.volume) && <span>Vol <b>{fmtBig(shown.volume)}</b></span>}
              </div>
            )}
            <div className="chart-host" ref={hostRef} />
          </>
        )}
      </div>
    </>
  );
}
