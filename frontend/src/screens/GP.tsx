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
import { VolumeProfilePrimitive } from "../components/volumeProfile";
import { volumeProfile } from "../lib/profile";
import { alertStatus, alertsApi, conditionLabel, useAlerts, useAlertsRefresh, type Alert } from "../lib/alerts";
import { api, ApiError, IS_STATIC } from "../lib/api";
import { coneLines, useVolForecast } from "../lib/forecast";
import { useCsvExport, type CsvDataset } from "../lib/exporter";
import { BAND_KEYS, bandsCsv, bandTestText, bandTestVerdict, gapText, REGION_LABEL, useStockBands } from "../lib/valuation";
import { normalizeTicker, unknownSecurityMessage } from "../lib/commands";
import { displayTicker, fmt, fmtBig, fmtBp, fmtDate, fmtPct, fmtPrice, fmtShortDate, fmtTime, isEquity, isNum, priceDigits, shiftMonths, tone } from "../lib/format";
import { isBool, isNumberList, isOneOf, readPersistent, usePersistentState } from "../lib/persist";
import {
  OSC_INFO,
  OSC_LABEL,
  OSC_STYLE,
  OSCILLATORS,
  OVERLAY_INFO,
  OVERLAY_LABEL,
  OVERLAY_STYLE,
  OVERLAYS,
  oscillatorLines,
  overlayLines,
  type Oscillator,
  type Overlay,
} from "../lib/ehlers";
import { DOT_SERIES, DOT_TIERS, dotSeriesIndex, dotTier, randomRank, SCAN_INFO, SCAN_LABEL, SCAN_MODES, scanParams, trendScan, tscanLevels, type ScanMode } from "../lib/trendscan";
import { INTERVAL_LABEL, INTERVAL_SECONDS, INTERVALS, type Interval } from "../lib/intervals";
import { retry, useEarnings, useHistory, useIntraday } from "../lib/queries";
import { live, useLiveStatus } from "../lib/realtime";
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
    if (times.length && e.reportDate < times[0]) continue; // Berichte vor dem Zeitraum stapelten sich am ersten Balken
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
  // Unterfenster unter dem Kurs (früher nur „RSI 14“ an/aus – die alte Einstellung wird übernommen) und
  // Ehlers-Linie auf dem Kurs
  const [osc, setOsc] = usePersistentState<Oscillator>("gp.osc", readPersistent("gp.rsi", false, isBool) ? "rsi" : "off", isOneOf(OSCILLATORS));
  const showRsi = osc !== "off";
  const [ehlers, setEhlers] = usePersistentState<Overlay>("gp.ehlers", "off", isOneOf(OVERLAYS));
  // Trend-Scanning als Hintergrundfarbe (Rückblick = folgender Trend, laufend = bisheriger Trend)
  const [scan, setScan] = usePersistentState<ScanMode>("gp.scan", "off", isOneOf(SCAN_MODES));
  const [showVwap, setShowVwap] = usePersistentState("gp.vwap", true, isBool);
  const [showVp, setShowVp] = usePersistentState("gp.vp", false, isBool);
  const [showCone, setShowCone] = usePersistentState("gp.cone", false, isBool);
  const [showBand, setShowBand] = usePersistentState("gp.peband", false, isBool);
  const [bandBase, setBandBase] = usePersistentState<"own" | "sector">("gp.bandBase", "own", isOneOf(["own", "sector"] as const));
  const [compare, setCompare] = useState<string[]>([]);
  // Setzen einer Marke: "alarm" = Kursmarke mit Alarm, "line" = nur Linie (ohne Alarm)
  const [placing, setPlacing] = useState<false | "alarm" | "line">(false);
  const [markMsg, setMarkMsg] = useState<string | null>(null);
  const [chartGen, setChartGen] = useState(0);
  const alertsQ = useAlerts();
  const refreshAlerts = useAlertsRefresh();
  const marks = useMemo(() => (alertsQ.data?.alerts ?? []).filter((a) => a.ticker === ticker && a.kind === "price"), [alertsQ.data, ticker]);
  const [compareInput, setCompareInput] = useState("");
  const [compareErr, setCompareErr] = useState<string | null>(null);
  const intradayRange = range === "1T" || range === "5T";
  const hist = useHistory(ticker);
  const [interval, setInterval_] = usePersistentState<Interval>("gp.interval", "5m", isOneOf(INTERVALS));
  const intra = useIntraday(ticker, range === "1T" ? 1 : 5, intradayRange, interval);
  const liveStatus = useLiveStatus();
  const isLive = !!ticker && !!liveStatus?.live.includes(ticker);
  const isYield = ticker?.endsWith(".GBOND") ?? false;
  const comparing = compare.length > 0 && !intradayRange;
  // Schwankungskegel: erwartete Spanne der nächsten 21 Handelstage aus der Schwankungsprognose
  const coneOn = showCone && !intradayRange && !comparing && !isYield && !IS_STATIC;
  const volFc = useVolForecast(ticker, null, coneOn);
  // KGV-Band: Kurs beim üblichen KGV (Median, 25–75 %, 10–90 %), rechts mit den Analystenschätzungen
  const bandOn = showBand && !intradayRange && !comparing && !isYield && !IS_STATIC && !!ticker && isEquity(ticker);
  const bandQ = useStockBands(ticker, bandOn);
  // Basis der Bänder: eigenes KGV oder übliches Verhältnis zum Sektor-KGV (falls vorhanden)
  const bandSector = bandQ.data?.sector ?? null;
  const shownBands = bandBase === "sector" && bandSector?.bands ? bandSector.bands : bandQ.data;

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
    type Gap = Line | { time: Time };
    type OscLine = { name: string; color: string; data: Gap[] };
    type EhlLine = { name: string; color: string; data: Line[] };
    type ScanRow = { time: Time; close: number; t: number | null; rank: number | null; len: number | null; ret: number | null; other: Bar | null };
    const empty = { bars: [] as Bar[], maLines: [] as { n: number; color: string; data: Line[] }[], base: null as number | null, prevDay: null as number | null, bands: null as null | { upper: Line[]; lower: Line[] }, oscLines: [] as OscLine[], ehlLines: [] as EhlLine[], scanRows: [] as ScanRow[], start: "" };
    // Unterfenster (RSI oder Ehlers-Oszillator) und Ehlers-Linie: über alle geladenen Balken gerechnet (keine
    // Anlaufphase im sichtbaren Bereich), gezeigt ab ``from``
    const indicators = (src: Bar[], from: number) => {
      const closes = src.map((b) => b.close);
      const raw =
        osc === "off"
          ? []
          : osc === "rsi"
            ? [{ name: "RSI 14", color: "#c77dff", values: rsiSeries(closes) }]
            : osc === "tscan"
              ? [{ name: "Trend-Scan laufend 20 t-Wert", color: "#c77dff", values: trendScan(closes, "backward", 20).map((p) => p.t) }]
              : oscillatorLines(osc, src).lines;
      const oscLines: OscLine[] = raw.map((l) => ({
        name: l.name,
        color: l.color,
        data: src.slice(from).map((b, k) => (l.values[from + k] === null ? { time: b.time } : { time: b.time, value: l.values[from + k]! })),
      }));
      const ehlLines: EhlLine[] = overlayLines(ehlers, src).map((l) => {
        const data: Line[] = [];
        for (let i = from; i < src.length; i++) if (l.values[i] !== null) data.push({ time: src[i].time, value: l.values[i]! });
        return { name: l.name, color: l.color, data };
      });
      const sp = scanParams(scan);
      const pts = sp ? trendScan(closes, sp.direction, sp.window) : [];
      const scanRows: ScanRow[] = sp
        ? src.slice(from).map((b, k) => {
            const p = pts[from + k];
            return { time: b.time, close: b.close, t: p.t, rank: randomRank(p.t, sp.window), len: p.len, ret: p.ret, other: p.other !== null ? src[p.other] : null };
          })
        : [];
      return { oscLines, ehlLines, scanRows };
    };
    if (intradayRange) {
      const d = intra.data;
      if (!d || !d.t.length) return empty;
      const bars = intradayBars(d);
      const firstDay = new Date(d.t[0] * 1000).toISOString().slice(0, 10);
      const lastDay = new Date(d.t[d.t.length - 1] * 1000).toISOString().slice(0, 10);
      // base: Bezug der Veränderung über den Zeitraum (Schluss vor dem ersten Tag);
      // prevDay: Linie „Vortag“ = Schluss vor dem letzten Tag (im 5T-Chart früher der Schluss vor dem Fenster)
      return {
        ...empty,
        bars,
        base: closeBefore(hist.data, firstDay) ?? bars[0]?.open ?? null,
        prevDay: closeBefore(hist.data, lastDay),
        ...indicators(bars, 0),
      };
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
    return { bars: all.slice(from), maLines: lines, base: periodBase(all, from), prevDay: null, bands, ...indicators(all, from), start };
  }, [hist.data, intra.data, range, mas, intradayRange, boll, osc, ehlers, scan]);

  const { bars, maLines, base, prevDay, bands, oscLines, ehlLines, scanRows } = view;
  const scanOn = scan !== "off" && !comparing;

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

  // CSV-Knopf des Panels: Kurse (OHLCV) mit gleitenden Durchschnitten, Vergleich, KGV-Band und Kegel
  useCsvExport(() => {
    if (!bars.length) return [];
    const name = ticker ? displayTicker(ticker) : "";
    const label = (t: Time) => (typeof t === "number" ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : String(t));
    const maMaps = maLines.map((m) => new Map(m.data.map((p) => [String(p.time), p.value])));
    const bollUp = new Map((bands?.upper ?? []).map((p) => [String(p.time), p.value]));
    const bollLo = new Map((bands?.lower ?? []).map((p) => [String(p.time), p.value]));
    const ehlMaps = ehlLines.map((l) => new Map(l.data.map((p) => [String(p.time), p.value])));
    const oscMaps = oscLines.map((l) => new Map(l.data.map((p) => [String(p.time), "value" in p ? p.value : null])));
    const scanMap = new Map(scanRows.map((r) => [String(r.time), r]));
    const scanBack = scan.startsWith("back");
    const sets: CsvDataset[] = [
      {
        title: `Kursverlauf ${name} (${range})`,
        columns: [
          intradayRange ? "Zeit (UTC)" : "Datum",
          "Eröffnung",
          "Hoch",
          "Tief",
          "Schluss",
          "Volumen",
          ...maLines.map((m) => `SMA ${m.n}`),
          ...(bands ? ["Bollinger oben", "Bollinger unten"] : []),
          ...ehlLines.map((l) => `Ehlers ${l.name}`),
          ...oscLines.map((l) => l.name),
          ...(scanOn
            ? [`Trend-Scan ${SCAN_LABEL[scan]} t-Wert`, "Trend-Scan stärker als Zufall [%]", "Trend-Scan Länge (Balken)", "Trend-Scan Veränderung [%]", scanBack ? "Trend-Scan bis" : "Trend-Scan ab"]
            : []),
        ],
        rows: bars.map((b) => {
          const k = String(b.time);
          return [
            label(b.time), b.open, b.high, b.low, b.close, b.volume, ...maMaps.map((mm) => mm.get(k) ?? null),
            ...(bands ? [bollUp.get(k) ?? null, bollLo.get(k) ?? null] : []),
            ...ehlMaps.map((mm) => mm.get(k) ?? null), ...oscMaps.map((mm) => mm.get(k) ?? null),
            ...(scanOn
              ? (() => {
                  const r = scanMap.get(k);
                  return [r?.t ?? null, isNum(r?.rank) ? r!.rank! * 100 : null, r?.len ?? null, isNum(r?.ret) ? r!.ret! * 100 : null, r?.other ? label(r.other.time) : null];
                })()
              : []),
          ];
        }),
      },
    ];
    if (compareLines.length) {
      const times = compareLines[0].data.map((p) => String(p.time));
      const maps = compareLines.map((l) => new Map(l.data.map((p) => [String(p.time), p.value])));
      sets.push({
        title: isYield ? "Vergleich (Veränderung in bp)" : "Vergleich (Wertentwicklung in %)",
        columns: ["Datum", ...compareLines.map((l) => `${l.label} [${isYield ? "bp" : "%"}]`)],
        rows: times.map((t) => [t, ...maps.map((m) => m.get(t) ?? null)]),
      });
    }
    const b = bandOn ? shownBands : null;
    if (b) {
      const viaSector = bandBase === "sector" && !!bandSector?.bands;
      sets.push(bandsCsv(b, `KGV-Band ${name}${viaSector ? " (über das Sektor-KGV)" : ""}`, "Kurs", String(bars[0].time)));
    }
    const vol = coneOn ? volFc.data?.forecast.median[0] : null;
    if (isNum(vol) && vol > 0) {
      const last = bars[bars.length - 1];
      const c = coneLines(String(last.time), last.close, vol);
      sets.push({
        title: `Schwankungskegel 21 Handelstage (σ ${fmt(vol, 1)} % p. a.)`,
        columns: ["Datum", "2σ unten", "1σ unten", "1σ oben", "2σ oben"],
        rows: c.up1.map((p, i) => [p.time, c.lo2[i].value, c.lo1[i].value, p.value, c.up2[i].value]),
      });
    }
    return sets;
  });

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
    osc: ISeriesApi<"Line">[];
    ehl: ISeriesApi<"Line">[];
    scan: ISeriesApi<"Line">[];
    scanHalo: ISeriesApi<"Line">[];
    cone: ISeriesApi<"Line">[];
    band: ISeriesApi<"Line">[];
  } | null>(null);
  const barsRef = useRef<Map<string, Bar>>(new Map());
  const prevLineRef = useRef<ReturnType<ISeriesApi<"Line">["createPriceLine"]> | null>(null);
  const vpRef = useRef<VolumeProfilePrimitive | null>(null);
  const vpLines = useRef<IPriceLine[]>([]);
  const markLines = useRef<IPriceLine[]>([]);
  const marksRef = useRef<Alert[]>([]); // Marken in derselben Reihenfolge wie markLines
  const placingRef = useRef<false | "alarm" | "line">(false);
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
    const refs: NonNullable<typeof seriesRef.current> = { main: null, vol: null, vwap: null, ma: new Map(), bands: [], cmp: [], osc: [], ehl: [], scan: [], scanHalo: [], cone: [], band: [] };
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
      for (const st of OVERLAY_STYLE[ehlers]) {
        refs.ehl.push(chart.addLineSeries({
          color: st.color, lineWidth: 2, lineStyle: st.dashed ? LineStyle.Dashed : LineStyle.Solid,
          lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
        }));
      }
      if (intradayRange && showVwap) {
        refs.vwap = chart.addLineSeries({ color: "#f2c200", lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      }
      if (bandOn) {
        // erst die fünf Bänder (Vergangenheit), dann ihre Fortsetzung mit den Schätzungen
        const look = [
          ["rgba(255,160,40,0.4)", LineStyle.Dotted, 1], ["rgba(255,160,40,0.7)", LineStyle.Dashed, 1], ["#ffa028", LineStyle.Solid, 2],
          ["rgba(255,160,40,0.7)", LineStyle.Dashed, 1], ["rgba(255,160,40,0.4)", LineStyle.Dotted, 1],
        ] as const;
        for (const future of [false, true]) {
          look.forEach(([color, style, width], i) => {
            refs.band.push(chart.addLineSeries({
              color, lineWidth: width as 1 | 2, lineStyle: future ? LineStyle.SparseDotted : style, priceLineVisible: false, crosshairMarkerVisible: false,
              lastValueVisible: future, title: future ? ["10 %", "25 %", "Median", "75 %", "90 %"][i] : "",
            }));
          });
        }
      }
      if (coneOn) {
        for (const [color, style] of [["rgba(255,128,0,0.9)", LineStyle.Dashed], ["rgba(255,128,0,0.9)", LineStyle.Dashed], ["rgba(255,128,0,0.45)", LineStyle.Dotted], ["rgba(255,128,0,0.45)", LineStyle.Dotted]] as const) {
          refs.cone.push(chart.addLineSeries({ color, lineWidth: 1, lineStyle: style, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false }));
        }
      }
      if (boll && !intradayRange) {
        for (let i = 0; i < 2; i++) {
          refs.bands.push(chart.addLineSeries({ color: "rgba(102,184,255,0.55)", lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }));
        }
      }
      if (scanOn) {
        // Trend-Scan als Punkte auf dem Schlusskurs (wie im Buch von López de Prado): Farbe = Richtung, Größe = Stärke
        // im Vergleich zum Zufall – je Stufe und Richtung eine Reihe ohne Linie, zuletzt angelegt, damit sie über den Kerzen liegt
        // dunkler Rand unter den farbigen Punkten (Stufe 1–4), damit grüne Punkte auf grünen Kerzen sichtbar bleiben
        for (const d of DOT_TIERS.slice(1)) {
          refs.scanHalo.push(chart.addLineSeries({
            color: "#0a0a0a", lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: d.radius + 1.5,
            lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
          }));
        }
        for (const d of DOT_SERIES) {
          refs.scan.push(chart.addLineSeries({
            color: d.color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: d.radius,
            lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
          }));
        }
      }
    }
    let rsiChart: IChartApi | null = null;
    const syncers: (() => void)[] = [];
    if (refs.scan.length) {
      // Punktgröße folgt dem Zoom: bei vielen Balken (z. B. MAX) kleiner, damit die Kerzen sichtbar bleiben
      let lastF = -1;
      const fitDots = () => {
        const r = chart.timeScale().getVisibleLogicalRange();
        const w = chart.timeScale().width();
        if (!r || !w) return;
        const f = Math.round(Math.max(0.4, Math.min(1, w / Math.max(1, r.to - r.from) / 6)) * 20) / 20;
        if (f === lastF) return;
        lastF = f;
        refs.scan.forEach((series, i) => series.applyOptions({ pointMarkersRadius: DOT_SERIES[i].radius * f }));
        refs.scanHalo.forEach((series, k) => series.applyOptions({ pointMarkersRadius: (DOT_TIERS[k + 1].radius + 1.5) * f }));
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(fitDots);
      syncers.push(() => chart.timeScale().unsubscribeVisibleLogicalRangeChange(fitDots));
    }
    if (showRsi && rsiRef.current) {
      const os = OSC_STYLE[osc];
      rsiChart = createChart(rsiRef.current, {
        ...baseOptions,
        rightPriceScale: { borderColor: "#262626", minimumWidth: axisWidth, scaleMargins: { top: 0.1, bottom: 0.1 } },
        // Roofing-Filter in Kurseinheiten (auch Kleinstkurse), sonst feste Nachkommastellen
        localization: { locale: "de-DE", timeFormatter: crosshairTime, priceFormatter: (p: number) => (osc === "roof" ? fmtPrice(p) : fmt(p, os.digits)) },
        timeScale: { ...baseOptions.timeScale, visible: false },
        handleScroll: false,
        handleScale: false,
      });
      rsiChartRef.current = rsiChart;
      os.colors.forEach((color, i) => refs.osc.push(rsiChart!.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: i === 0 })));
      // Trend-Scan: Hilfslinien an den Zufallsgrenzen (typischer Zufall, stärker als 90 % Zufall) statt fester Werte
      for (const lv of osc === "tscan" ? tscanLevels(20) : os.levels.map((l) => ({ ...l, label: l.value !== 0 }))) {
        refs.osc[0]?.createPriceLine({ price: lv.value, color: lv.color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: lv.label, title: "" });
      }
      // Zeitachsen koppeln: Zoom und Scrollen im Kurschart bewegen den RSI mit
      const onRange = (r: unknown) => r && rsiChart?.timeScale().setVisibleLogicalRange(r as never);
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      syncers.push(() => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange));
    }
    seriesRef.current = refs;
    prevLineRef.current = null;
    vpLines.current = [];
    vpRef.current = null;
    if (refs.main) {
      const vp = new VolumeProfilePrimitive();
      refs.main.attachPrimitive(vp);
      vpRef.current = vp;
    }
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
      // Volumenprofil und Linien gehören zu diesem Chart: nach remove() nicht mehr ansprechen
      vpRef.current = null;
      vpLines.current = [];
      markLines.current = [];
      chart.remove();
      rsiChart?.remove();
      chartRef.current = null;
      rsiChartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, kind, intradayRange, isYield, maKey, boll, osc, ehlers, scanOn, cmpKey, showVwap, coneOn, bandOn]);

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
        intradayRange && isNum(prevDay)
          ? s.main.createPriceLine({ price: prevDay, color: "#777", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Vortag" })
          : null;
      s.main.setMarkers(!intradayRange && earn.data ? earningsMarkers(earn.data.history, bars) : []);
    }
    if (bands && s.bands.length === 2) {
      s.bands[0].setData(bands.upper);
      s.bands[1].setData(bands.lower);
    }
    if (s.band.length === 10) {
      const b = shownBands;
      const first = String(bars[0].time);
      BAND_KEYS.forEach((k, i) => {
        const past = b ? b.t.map((t, j) => ({ time: t, value: b.lines[k][j] })).filter((p) => p.time >= first && isNum(p.value)) : [];
        const fut = b ? b.futureT.map((t, j) => ({ time: t, value: b.future[k][j] })).filter((p) => isNum(p.value)) : [];
        s.band[i].setData(past as never);
        s.band[i + 5].setData(fut as never);
      });
    }
    if (s.cone.length === 4) {
      const vol = volFc.data?.forecast.median[0];
      const last = bars[bars.length - 1];
      if (isNum(vol) && vol > 0) {
        const c = coneLines(String(last.time), last.close, vol);
        [c.up1, c.lo1, c.up2, c.lo2].forEach((d, i) => s.cone[i].setData(d as never));
      } else {
        s.cone.forEach((x) => x.setData([]));
      }
    }
    compareLines.forEach((l, i) => s.cmp[i]?.setData(l.data));
    s.ehl.forEach((ser, i) => ser.setData((ehlLines[i]?.data ?? []) as never));
    // ohne Ergebnis (Rand, „noch offen“) ganz blass grau, schwacher Trend ohne Farbe
    if (s.scan.length) {
      const perSeries: { time: Time; value: number }[][] = DOT_SERIES.map(() => []);
      for (const r of scanRows) {
        if (r.t === null || r.rank === null) continue;
        perSeries[dotSeriesIndex(r.t, dotTier(r.rank))].push({ time: r.time, value: r.close });
      }
      s.scan.forEach((series, k) => series.setData(perSeries[k]));
      // Rand je Stufe: Punkte beider Richtungen, zeitlich sortiert
      s.scanHalo.forEach((series, k) =>
        series.setData(
          DOT_SERIES.flatMap((d, i) => (d.tier === k + 1 ? perSeries[i] : [])).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)),
        ),
      );
    }
    s.osc.forEach((ser, i) => {
      const d = oscLines[i]?.data ?? [];
      ser.setData((comparing ? alignRsi(d, compareLines) : d) as never);
    });
    const key = `${ticker}|${range}|${kind}|${maKey}|${cmpKey}|${osc}`;
    if (fitKey.current !== key) {
      chart.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
      fitKey.current = key;
    }
  }, [bars, maLines, bands, oscLines, ehlLines, scanRows, compareLines, comparing, kind, range, ticker, maKey, cmpKey, osc, base, prevDay, intradayRange, earn.data, isYield, volFc.data, chartGen, shownBands]);

  // Laufende Kerze: Ticks des Echtzeit-Stroms (US-Werte, Devisen, Krypto) bzw. verzögerte Kurse
  // (übrige Börsen) schreiben die letzte Kerze fort, ohne den ganzen Chart neu zu zeichnen
  const liveBar = useRef<Bar | null>(null);
  useEffect(() => {
    liveBar.current = bars.length ? { ...bars[bars.length - 1] } : null;
  }, [bars]);
  useEffect(() => {
    if (!ticker || comparing || IS_STATIC) return;
    const release = live.want([ticker]);
    const step = INTERVAL_SECONDS[interval];
    const off = live.onTicks((ticks) => {
      const s = seriesRef.current;
      for (const tk of ticks) {
        const cur = liveBar.current;
        if (tk.t !== ticker || !s?.main || !cur) continue;
        let time: Time;
        if (intradayRange) {
          const sec = Math.floor(tk.ts / 1000);
          time = toLocal(sec - (sec % step));
        } else {
          // Tageskerze: nur den laufenden Tag fortschreiben (ein neuer Tag kommt mit der Kursreihe)
          if (new Date(tk.ts).toISOString().slice(0, 10) !== String(cur.time)) continue;
          time = cur.time;
        }
        let bar: Bar;
        if (time === cur.time) {
          bar = { ...cur, high: Math.max(cur.high, tk.p), low: Math.min(cur.low, tk.p), close: tk.p, volume: tk.v ? (cur.volume ?? 0) + tk.v : cur.volume };
        } else if ((time as number) > (cur.time as number)) {
          bar = { time, open: tk.p, high: tk.p, low: tk.p, close: tk.p, volume: tk.v ?? null };
        } else {
          continue; // älter als die letzte Kerze
        }
        liveBar.current = bar;
        try {
          if (kind === "candle") (s.main as ISeriesApi<"Candlestick">).update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
          else (s.main as ISeriesApi<"Line">).update({ time: bar.time, value: bar.close });
          if (s.vol && isNum(bar.volume)) {
            s.vol.update({ time: bar.time, value: bar.volume, color: bar.close >= bar.open ? "rgba(41,209,125,0.35)" : "rgba(255,82,82,0.35)" });
          }
        } catch {
          /* Chart wurde gerade neu aufgebaut */
        }
      }
    });
    return () => {
      off();
      release();
    };
  }, [ticker, interval, intradayRange, kind, comparing, chartGen]);

  // Volumenprofil des gezeigten Zeitraums (1T/5T aus 5-Minuten-Kerzen, sonst aus Tageskerzen geschätzt)
  const vp = useMemo(
    () => (showVp && !comparing && !isYield ? volumeProfile(bars.map((b, i) => ({ t: i, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })), { rows: 48 }) : null),
    [showVp, comparing, isYield, bars],
  );
  useEffect(() => {
    const main = seriesRef.current?.main;
    vpRef.current?.setProfile(vp);
    for (const l of vpLines.current) {
      try {
        main?.removePriceLine(l);
      } catch {
        /* Linie gehörte zum vorigen Chart */
      }
    }
    vpLines.current = [];
    if (!main || !vp) return;
    vpLines.current = [
      main.createPriceLine({ price: vp.poc, color: "#ff8000", lineWidth: 1, lineStyle: LineStyle.LargeDashed, axisLabelVisible: true, title: "POC" }),
      main.createPriceLine({ price: vp.vah, color: "#8f8f8f", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "VAH" }),
      main.createPriceLine({ price: vp.val, color: "#8f8f8f", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "VAL" }),
    ];
  }, [vp, chartGen]);

  // Kursmarken und Alarme als waagerechte Linien (nicht im Prozent-Vergleich)
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
    marksRef.current = marks;
    markLines.current = marks.map((m) => {
      const st = markStyle(m);
      return main.createPriceLine({ price: m.level, color: st.color, lineWidth: 1, lineStyle: st.style, axisLabelVisible: true, title: st.title });
    });
    requestAnimationFrame(() => declutterRef.current());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksKey, chartGen, comparing]);

  // Beschriftungen an der Preisachse entzerren: Liegt eine Marke weniger als 13 Pixel neben dem
  // aktuellen Kurs, einer VP-Linie oder einer anderen Marke, bleibt nur die Linie (Wert steht in
  // der Markenleiste unter dem Chart)
  const declutterRef = useRef<() => void>(() => {});
  declutterRef.current = () => {
    const main = seriesRef.current?.main;
    if (!main) return;
    const taken: number[] = [];
    const lastClose = liveBar.current?.close;
    if (isNum(lastClose)) {
      const c = main.priceToCoordinate(lastClose);
      if (c !== null) taken.push(c);
    }
    for (const l of vpLines.current) {
      const c = main.priceToCoordinate(l.options().price);
      if (c !== null) taken.push(c);
    }
    marksRef.current
      .map((m, i) => ({ i, c: main.priceToCoordinate(m.level), armed: m.alarm && m.active }))
      .sort((a, b) => Number(b.armed) - Number(a.armed)) // scharfe Alarme zuerst beschriften
      .forEach(({ i, c }) => {
        const show = c !== null && taken.every((t) => Math.abs(t - c) > 13);
        try {
          markLines.current[i]?.applyOptions({ axisLabelVisible: show });
        } catch {
          /* Linie gehörte zum vorigen Chart */
        }
        if (show && c !== null) taken.push(c);
      });
  };

  // Marken mit der Maus verschieben: Linie greifen (Mauszeiger ↕), ziehen, loslassen
  useEffect(() => {
    const host = hostRef.current;
    const chart = chartRef.current;
    const main = seriesRef.current?.main;
    if (!host || !chart || !main || comparing || IS_STATIC) return;
    let drag: { idx: number; id: string; startY: number; moved: boolean } | null = null;
    const yOf = (e: MouseEvent) => e.clientY - host.getBoundingClientRect().top;
    const near = (y: number) => {
      let best = -1;
      let dist = 6;
      marksRef.current.forEach((m, i) => {
        const c = main.priceToCoordinate(m.level);
        if (c !== null && Math.abs(c - y) <= dist) {
          best = i;
          dist = Math.abs(c - y);
        }
      });
      return best;
    };
    const down = (e: PointerEvent) => {
      if (placingRef.current || e.button !== 0) return;
      const i = near(yOf(e));
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation(); // der Chart soll dabei nicht verschoben werden
      drag = { idx: i, id: marksRef.current[i].id, startY: yOf(e), moved: false };
      chart.applyOptions({ handleScroll: false, handleScale: false });
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* ältere Browser */
      }
    };
    const block = (e: MouseEvent) => {
      if (drag) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const move = (e: PointerEvent) => {
      const y = yOf(e);
      if (!drag) {
        host.style.cursor = !placingRef.current && near(y) >= 0 ? "ns-resize" : "";
        return;
      }
      if (Math.abs(y - drag.startY) > 2) drag.moved = true;
      const price = main.coordinateToPrice(y);
      if (price !== null && isNum(price) && price > 0) markLines.current[drag.idx]?.applyOptions({ price });
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      try {
        host.releasePointerCapture(e.pointerId);
      } catch {
        /* schon freigegeben */
      }
      if (!d.moved || !ticker) return;
      const raw = main.coordinateToPrice(yOf(e));
      if (raw === null || !isNum(raw) || raw <= 0) return;
      const level = Number(raw.toFixed(isYield ? 3 : priceDigits(raw, ticker)));
      void markAction(() => alertsApi.update(d.id, { level }));
    };
    const onRange = () => declutterRef.current();
    host.addEventListener("pointerdown", down, true);
    host.addEventListener("mousedown", block, true);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => {
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("mousedown", block, true);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      } catch {
        /* Chart schon entfernt */
      }
      host.style.cursor = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartGen, comparing, ticker, isYield]);

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
      // Umschalt-Taste beim Klick: nur Linie, auch wenn „＋ Marke“ gewählt ist
      const shift = (p.sourceEvent as { shiftKey?: boolean } | undefined)?.shiftKey ?? false;
      const alarm = placing === "alarm" && !shift;
      setPlacing(false);
      alertsApi
        .create({ ticker, kind: "price", level, direction: null, alarm })
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
  placingRef.current = placing;

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
        {intradayRange && (
          <Seg
            label="Intervall"
            value={interval}
            options={INTERVALS.map((v) => ({ value: v, label: INTERVAL_LABEL[v] }))}
            onChange={setInterval_}
          />
        )}
        {ticker && liveStatus && liveStatus.mode !== "aus" && (
          <span
            className={`live-badge ${isLive ? "on" : ""}`}
            title={
              isLive
                ? "Echtzeit-Kurse: die letzte Kerze läuft mit jedem Abschluss mit"
                : "Für diesen Wert gibt es keinen Echtzeit-Strom (Indizes, Anleihen, Rohstoffe, einzelne Börsen) oder er ist nicht freigeschaltet bzw. über der Grenze von 50 Werten: Kurse verzögert"
            }
          >
            {isLive ? "● Echtzeit" : "verzögert"}
          </span>
        )}
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
            {!isYield && !IS_STATIC && (
              <label
                className="check"
                style={{ color: showCone ? "#ff8000" : undefined }}
                title={
                  "Schwankungskegel: erwartete Spanne der nächsten 21 Handelstage (gestrichelt ±1 Standardabweichung ≈ 68 %, gepunktet ±2 ≈ 95 %), " +
                  "aus der Prognose der Schwankung (Chronos-2 bzw. Statistik). Keine Aussage über die Richtung." +
                  (volFc.data ? `\n${volFc.data.verdictText}` : "")
                }
              >
                <input type="checkbox" checked={showCone} onChange={(e) => setShowCone(e.target.checked)} />
                Kegel{coneOn && volFc.data ? ` σ ${fmt(volFc.data.forecast.median[0], 0)} %` : ""}
              </label>
            )}
            {coneOn && volFc.isError && <span className="small muted">Kegel: {(volFc.error as Error).message}</span>}
            {!isYield && !IS_STATIC && ticker && isEquity(ticker) && (
              <label
                className="check"
                style={{ color: showBand ? "#ffa028" : undefined }}
                title={
                  "KGV-Band: Kurs, der dem üblichen KGV dieser Aktie entspräche – Median (durchgezogen), 25–75 % (gestrichelt), " +
                  "10–90 % (gepunktet) der letzten zehn Jahre; rechts mit den Gewinnschätzungen der Analysten fortgesetzt." +
                  (bandQ.data ? `\n\nRückblick (je Monat nur mit der Vorgeschichte): ${bandTestText(bandQ.data.test)}\n\n${bandQ.data.note}` : "")
                }
              >
                <input type="checkbox" checked={showBand} onChange={(e) => setShowBand(e.target.checked)} />
                KGV-Band
              </label>
            )}
            {bandOn && bandQ.data && (
              <span className="small muted" title={bandTestText(bandQ.data.test)}>
                {bandQ.data.loss || !isNum(bandQ.data.peNow)
                  ? "zurzeit Verlust – kein KGV"
                  : `KGV ${fmt(bandQ.data.peNow, 1)} · üblich ${fmt(bandQ.data.pct.p50, 1)}`}
                {isNum(bandQ.data.fairNext) && (
                  <>
                    {" · "}Fair Value {bandQ.data.fairYear}: <b className="lbl">{fmtPrice(bandQ.data.fairNext, ticker)}</b>{" "}
                    <span className={isNum(bandQ.data.fairGap) && bandQ.data.fairGap >= 0 ? "up" : "down"}>
                      ({isNum(bandQ.data.fairGap) ? `${bandQ.data.fairGap >= 0 ? "+" : "−"}${fmt(Math.abs(bandQ.data.fairGap * 100), 0)} %` : ""})
                    </span>
                  </>
                )}
                {bandSector && (
                  <span
                    title={
                      `Sektor ${bandSector.label} (${REGION_LABEL[bandSector.region]}, ${bandSector.n} Firmen ohne diese Aktie): KGV aufs nächste Jahr ${fmt(bandSector.peNext, 1)}.\n` +
                      `Nach Sektor-KGV: Kurs, wenn die Aktie so bewertet wäre wie ihr Sektor.\n` +
                      `Relativ: übliches Verhältnis zum Sektor (×${fmt(bandSector.relMedian, 2)}, heute ×${fmt(bandSector.relNow, 2)}) auf das heutige Sektor-KGV – berücksichtigt Firmenqualität und Marktlage.` +
                      (bandSector.bands ? `\nRückblick relativ: ${bandTestText(bandSector.bands.test)}` : "")
                    }
                  >
                    {" · "}Sektor-KGV {fmt(bandSector.peNext, 1)}:{" "}
                    {isNum(bandSector.fairSector) ? fmtPrice(bandSector.fairSector, ticker) : "–"}{" "}
                    <span className={isNum(bandSector.fairSectorGap) && bandSector.fairSectorGap >= 0 ? "up" : "down"}>({gapText(bandSector.fairSectorGap)})</span>
                    {" · "}relativ ×{fmt(bandSector.relMedian, 2)}:{" "}
                    {isNum(bandSector.fairRelative) ? fmtPrice(bandSector.fairRelative, ticker) : "–"}{" "}
                    <span className={isNum(bandSector.fairRelativeGap) && bandSector.fairRelativeGap >= 0 ? "up" : "down"}>({gapText(bandSector.fairRelativeGap)})</span>
                  </span>
                )}
                {" · "}Band früher: {bandTestVerdict(shownBands?.test)}
              </span>
            )}
            {bandOn && bandSector?.bands && (
              <Seg
                label="Basis der KGV-Bänder"
                value={bandBase}
                options={[
                  { value: "own", label: "eigenes KGV" },
                  { value: "sector", label: "relativ zum Sektor" },
                ]}
                onChange={setBandBase}
              />
            )}
            {bandOn && bandQ.isError && <span className="small muted">KGV-Band: {(bandQ.error as Error).message}</span>}
          </>
        )}
        {intradayRange && !isYield && (
          <label className="check" style={{ color: showVwap ? "#f2c200" : undefined }} title="Volumengewichteter Durchschnittskurs je Handelstag">
            <input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)} />
            VWAP
          </label>
        )}
        {!comparing && (
          <label className="small muted" style={{ color: ehlers !== "off" ? "#4dd0e1" : undefined }} title={OVERLAY_INFO[ehlers]}>
            Ehlers{" "}
            <select className="field" aria-label="Ehlers-Linie auf dem Kurs" value={ehlers} onChange={(e) => setEhlers(e.target.value as Overlay)}>
              {OVERLAYS.map((o) => (
                <option key={o} value={o} title={OVERLAY_INFO[o]}>
                  {OVERLAY_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
        )}
        {!comparing && (
          <label className="small muted" style={{ color: scanOn ? "#29d17d" : undefined }} title={SCAN_INFO[scan]}>
            Trend-Scan{" "}
            <select className="field" aria-label="Trend-Scanning" value={scan} onChange={(e) => setScan(e.target.value as ScanMode)}>
              <option value="off">{SCAN_LABEL.off}</option>
              <optgroup label="Rückblick (folgender Trend)">
                <option value="back20" title={SCAN_INFO.back20}>{SCAN_LABEL.back20}</option>
                <option value="back60" title={SCAN_INFO.back60}>{SCAN_LABEL.back60}</option>
              </optgroup>
              <optgroup label="Laufend (bisheriger Trend)">
                <option value="live20" title={SCAN_INFO.live20}>{SCAN_LABEL.live20}</option>
                <option value="live60" title={SCAN_INFO.live60}>{SCAN_LABEL.live60}</option>
              </optgroup>
            </select>
          </label>
        )}
        {scanOn && scan.startsWith("back") && <span className="small dim" title={SCAN_INFO[scan]}>Rückblick: nutzt spätere Kurse, kein Signal</span>}
        <label className="small muted" style={{ color: showRsi ? "#c77dff" : undefined }} title={OSC_INFO[osc]}>
          Unterfenster{" "}
          <select className="field" aria-label="Unterfenster" value={osc} onChange={(e) => setOsc(e.target.value as Oscillator)}>
            <option value="off">{OSC_LABEL.off}</option>
            <optgroup label="Klassisch">
              <option value="rsi" title={OSC_INFO.rsi}>{OSC_LABEL.rsi}</option>
            </optgroup>
            <optgroup label="Ehlers">
              {OSCILLATORS.filter((o) => o !== "off" && o !== "rsi" && o !== "tscan").map((o) => (
                <option key={o} value={o} title={OSC_INFO[o]}>
                  {OSC_LABEL[o]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Trend-Scanning">
              <option value="tscan" title={OSC_INFO.tscan}>{OSC_LABEL.tscan}</option>
            </optgroup>
          </select>
        </label>
        {!comparing && !isYield && (
          <label
            className="check"
            style={{ color: showVp ? "#ff8000" : undefined }}
            title={
              intradayRange
                ? "Volumenprofil: Umsatz je Preisstufe aus den Intraday-Kerzen, mit POC und Value Area (70 %)"
                : "Volumenprofil: Umsatz je Preisstufe im Zeitraum, aus Tageskerzen geschätzt (Volumen gleichmäßig über Tageshoch bis -tief verteilt), mit POC und Value Area (70 %)"
            }
          >
            <input type="checkbox" checked={showVp} onChange={(e) => setShowVp(e.target.checked)} />
            VP
          </label>
        )}
        {showVp && !comparing && !isYield && hasData && !vp && <span className="small muted">VP: keine Umsätze</span>}
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
              className={`btn ${placing === "alarm" ? "primary" : ""}`}
              aria-pressed={placing === "alarm"}
              title="Kursmarke mit Alarm setzen: danach in den Chart auf die gewünschte Höhe klicken (Umschalt+Klick: nur Linie, Esc bricht ab). Marken lassen sich mit der Maus verschieben."
              onClick={() => setPlacing((p) => (p === "alarm" ? false : "alarm"))}
            >
              ＋ Marke
            </button>
            <button
              type="button"
              className={`btn ${placing === "line" ? "primary" : ""}`}
              aria-pressed={placing === "line"}
              title="Linie ohne Alarm setzen (z. B. Unterstützung, Ziel): danach in den Chart klicken"
              onClick={() => setPlacing((p) => (p === "line" ? false : "line"))}
            >
              ＋ Linie
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
                {scanOn && (() => {
                  const r = scanRows.find((x) => x.time === shown.time);
                  const back = scan.startsWith("back");
                  // Intraday: Uhrzeit, bei anderem Tag (5T-Chart) mit Datum davor
                  const when = (b: Bar | null) =>
                    !b
                      ? ""
                      : intradayRange && b.ts !== undefined
                        ? (shown.ts !== undefined && fmtShortDate(b.ts) !== fmtShortDate(shown.ts) ? `${fmtShortDate(b.ts)} ` : "") + fmtTime(b.ts)
                        : fmtDate(b.time as string);
                  if (!r || r.t === null) return <span className="dim">{back ? "Trend danach: noch offen" : "Trend bisher: zu wenig Verlauf"}</span>;
                  const tier = r.rank === null ? 0 : dotTier(r.rank);
                  const tTxt = `${r.t > 0 ? "+" : r.t < 0 ? "−" : ""}${fmt(Math.abs(r.t), 1)}`;
                  if (tier === 0) return <span className="dim" title={SCAN_INFO[scan]}>{back ? "Trend danach" : "Trend bisher"}: kein Trend erkennbar (t {tTxt}, im Zufallsbereich)</span>;
                  const vsRandom = `stärker als ${Math.min(99, Math.floor((r.rank ?? 0) * 100))} % Zufall`;
                  return (
                    <span className={r.t > 0 ? "up" : "down"} title={SCAN_INFO[scan]}>
                      {back ? "Trend danach" : "Trend bisher"} {r.t > 0 ? "▲" : "▼"} {r.len} Balken {back ? `bis ${when(r.other)}` : `seit ${when(r.other)}`} · t{" "}
                      <b>{tTxt}</b> · {DOT_TIERS[tier].text}, {vsRandom} · {fmtPct(isNum(r.ret) ? r.ret * 100 : null, 1)}
                    </span>
                  );
                })()}
                {ehlLines.map((l) => {
                  const at = l.data.find((p) => p.time === shown.time);
                  return (
                    <span key={l.name} style={{ color: l.color }} title={OVERLAY_INFO[ehlers]}>
                      {l.name} <b>{at ? fmtPrice(at.value, ticker) : "–"}</b>
                    </span>
                  );
                })}
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
              {placing && (
                <div className="placing-hint">
                  {placing === "alarm" ? "In den Chart klicken: Marke mit Alarm · Umschalt+Klick: nur Linie" : "In den Chart klicken: Linie ohne Alarm"} · Esc bricht ab
                </div>
              )}
              <div className={`chart-host ${placing ? "placing" : ""}`} ref={hostRef} />
            </div>
            {showRsi && (
              <div style={{ position: "relative", flex: "0 0 26%", minHeight: 70, borderTop: "1px solid var(--rule)" }}>
                <span className="xs gp-osc-label" title={OSC_INFO[osc]}>
                  <span style={{ color: "#c77dff" }}>{OSC_LABEL[osc]}</span>
                  {oscLines.map((l) => {
                    const t = (hover ?? bars[bars.length - 1])?.time;
                    const at = l.data.find((p) => p.time === t);
                    const v = at && "value" in at ? at.value : null;
                    return (
                      <span key={l.name} style={{ color: l.color }}>
                        {oscLines.length > 1 ? `${l.name} ` : ""}
                        {isNum(v) ? (osc === "roof" ? fmtPrice(v) : fmt(v, OSC_STYLE[osc].digits)) : "–"}
                      </span>
                    );
                  })}
                </span>
                <div className="chart-host" ref={rsiRef} />
              </div>
            )}
            {/* Leiste schon beim Setzen zeigen: Erscheint sie erst nach dem ersten Klick, skaliert der Chart neu
                und der zweite Klick landete auf einem anderen Kurs */}
            {!comparing && (marks.length > 0 || markMsg || placing) && (
              <div className="chart-marks" aria-label="Kursmarken">
                <span className="muted">Marken</span>
                {!marks.length && <span className="muted">noch keine</span>}
                {marks
                  .slice()
                  .sort((a, b) => b.level - a.level)
                  .map((m) => {
                    const st = alertStatus(m);
                    return (
                      <span key={m.id} className={`mark-chip ${st === "armed" ? "armed" : ""}`} title={`${conditionLabel(m)}${m.note ? ` · ${m.note}` : ""}`}>
                        <button
                          type="button"
                          title={m.alarm ? "Alarm aus (Marke bleibt)" : "Alarm einschalten"}
                          onClick={() => markAction(() => alertsApi.update(m.id, { alarm: !m.alarm }))}
                        >
                          {st === "armed" ? "🔔" : st === "fired" ? "✓" : st === "mark" ? "🔕" : "○"}
                        </button>
                        {m.alarm ? (m.direction === "above" ? "↑ " : "↓ ") : ""}
                        {fmtPrice(m.level, ticker)}
                        {m.note ? <span className="muted"> {m.note.slice(0, 18)}</span> : null}
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
