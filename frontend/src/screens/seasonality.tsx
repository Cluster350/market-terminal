// SAIS – Saisonalität: Wochentags-, Monats- und Monatswechsel-Muster eines Werts und der durchschnittliche
// Jahresverlauf – jeweils mit ehrlichem Vergleich zum Zufall.

import { useMemo } from "react";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg, useSize } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { useCsvExport } from "../lib/exporter";
import { DASH, displayTicker, fmt, fmtDate, isNum } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import { chance, dayLabel, monthShort, monthTicks, pct, useSeasonality, VERDICT_WORD, type SeasonBlock, type Seasonality } from "../lib/seasonality";
import type { ScreenProps } from "./types";
import { PAL } from "../theme/palette";

const SPANS = [
  { value: "10", label: "10 Jahre" },
  { value: "25", label: "25 Jahre" },
] as const;
type Span = (typeof SPANS)[number]["value"];

const UP = PAL.up;
const DOWN = PAL.down;

function pathOption(s: Seasonality): EOption {
  const p = s.path;
  const year = new Date(s.last).getFullYear();
  return {
    animation: false,
    grid: { left: 46, right: 46, top: 26, bottom: 22 },
    legend: { top: 0, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6 },
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: (ps: { axisValue: number; seriesName: string; value: [number, number | null] }[]) => {
        const arr = Array.isArray(ps) ? ps : [ps];
        const day = Number(arr[0]?.value?.[0] ?? arr[0]?.axisValue);
        return [dayLabel(day), ...arr.map((x) => `${x.seriesName}: ${x.seriesName.startsWith("Jahre") ? `${fmt(x.value[1], 0)} %` : pct(x.value[1])}`)].join("<br/>");
      },
    },
    xAxis: {
      type: "value",
      min: 1,
      max: 365,
      interval: 1,
      ...AXIS,
      axisLabel: { ...AXIS.axisLabel, customValues: monthTicks, formatter: (v: number) => monthShort[monthTicks.indexOf(v)] ?? "" },
      axisTick: { ...AXIS.axisTick, customValues: monthTicks },
      splitLine: { show: true, lineStyle: { color: PAL.grid }, showMinLine: false },
    },
    yAxis: [
      { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${fmt(v, 0)} %` } },
      { type: "value", min: 0, max: 100, ...AXIS, splitLine: { show: false }, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${v} %` } },
    ],
    series: [
      {
        name: `Jahre im Plus bis zum Tag`,
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        data: p.days.map((d, i) => [d, p.plusShare[i]]),
        lineStyle: { width: 0 },
        areaStyle: { color: "rgba(102,184,255,0.10)" },
        itemStyle: { color: PAL.c2 },
      },
      {
        name: `Durchschnitt ${p.years[0] ?? ""}–${p.years[p.years.length - 1] ?? ""}`,
        type: "line",
        showSymbol: false,
        data: p.days.map((d, i) => [d, p.average[i]]),
        lineStyle: { width: 2, color: PAL.c1 },
        itemStyle: { color: PAL.c1 },
        markLine: { silent: true, symbol: "none", lineStyle: { color: "#444", type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] },
      },
      {
        name: `${year} bisher`,
        type: "line",
        showSymbol: false,
        data: p.days.map((d, i) => [d, p.current[i] ?? null]),
        lineStyle: { width: 1.3, color: PAL.c3 },
        itemStyle: { color: PAL.c3 },
      },
    ],
  };
}

function barOption(b: SeasonBlock, short: (label: string) => string, digits: number): EOption {
  const faint = b.verdict === "zufall" || b.verdict === "wenig";
  return {
    animation: false,
    grid: { left: 44, right: 8, top: 8, bottom: 20 },
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: (ps: { dataIndex: number }[]) => {
        const g = b.groups[(Array.isArray(ps) ? ps : [ps])[0].dataIndex];
        return `${g.label}<br/>Ø ${pct(g.mean, digits)} · Median ${pct(g.median, digits)}<br/>im Plus: ${fmt(g.plus, 0)} % von ${g.n} Fällen<br/>Allein für sich: so groß in ${chance(g.p)} der Zufallsmischungen`;
      },
    },
    xAxis: { type: "category", data: b.groups.map((g) => short(g.label)), ...AXIS, axisLabel: { ...AXIS.axisLabel, interval: 0 } },
    yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${fmt(v, digits)}` } },
    series: [
      {
        type: "bar",
        data: b.groups.map((g) => ({
          value: g.mean,
          itemStyle: { color: (g.mean ?? 0) >= 0 ? UP : DOWN, opacity: faint ? 0.45 : 0.9 },
        })),
        barMaxWidth: 28,
        markLine: { silent: true, symbol: "none", lineStyle: { color: "#666", type: "dashed" }, label: { show: false }, data: [{ yAxis: b.overall ?? 0 }] },
      },
    ],
  };
}

function Verdict({ b }: { b: SeasonBlock }) {
  return (
    <div className="sais-verdict">
      <span className={`sais-badge ${b.verdict}`} title={b.verdictText}>
        {VERDICT_WORD[b.verdict]}
      </span>
      <div className="sais-text">
        {b.sentence} {b.verdictText}
        {b.stable ? ` Beständigkeit: ${b.stable}.` : ""}
      </div>
    </div>
  );
}

function BlockCard({ b, short, digits, hint }: { b: SeasonBlock; short: (l: string) => string; digits: number; hint: string }) {
  const opt = useMemo(() => barOption(b, short, digits), [b, short, digits]);
  return (
    <div className="sais-card">
      <div className="section-title" title={hint}>
        {b.title} · Ø Rendite {b.unit} (Strich = Durchschnitt aller)
      </div>
      <div className="sais-bars">
        <EChart option={opt} csv={false} />
      </div>
      <Verdict b={b} />
    </div>
  );
}

function GroupTable({ b, digits }: { b: SeasonBlock; digits: number }) {
  return (
    <table className="t sais-table" data-export-title={`${b.title}: Rendite ${b.unit}`}>
      <thead>
        <tr>
          <th>{b.title === "Monate" ? "Monat" : b.title === "Wochentage" ? "Wochentag" : "Abschnitt"}</th>
          <th className="num">Ø</th>
          <th className="num">Median</th>
          <th className="num" title="Anteil der Fälle mit Kursplus">im Plus</th>
          <th className="num">Fälle</th>
          <th className="num col-opt1" title="Durchschnitt in der ersten bzw. zweiten Hälfte der Jahre">1. Hälfte</th>
          <th className="num col-opt1">2. Hälfte</th>
          <th className="num col-opt2" title="Allein für sich betrachtet: In wie vielen Zufallsmischungen war die Abweichung ebenso groß? Bei vielen Gruppen ist ein kleiner Wert bei einer davon normal – maßgeblich ist das Urteil für das ganze Muster.">
            Zufall
          </th>
        </tr>
      </thead>
      <tbody>
        {b.groups.map((g) => (
          <tr key={g.key}>
            <td>{g.label}</td>
            <td className={`num ${(g.mean ?? 0) >= 0 ? "up" : "down"}`}>{pct(g.mean, digits)}</td>
            <td className="num">{pct(g.median, digits)}</td>
            <td className="num">{isNum(g.plus) ? `${fmt(g.plus, 0)} %` : DASH}</td>
            <td className="num">{g.n}</td>
            <td className="num col-opt1">{pct(g.first, digits)}</td>
            <td className={`num col-opt1 ${g.same === false ? "muted" : ""}`} title={g.same === false ? "Richtung hat gewechselt" : undefined}>
              {pct(g.second, digits)}
              {g.same === false ? " ⇄" : ""}
            </td>
            <td className="num col-opt2">{chance(g.p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const shortMonth = (l: string) => l.slice(0, 3);
const shortDay = (l: string) => l.slice(0, 2);
const shortTurn = (l: string) => (l.startsWith("Monatswechsel") ? "Wechsel" : "übrige");

export function SAIS({ ticker }: ScreenProps) {
  const [span, setSpan] = usePersistentState<Span>("sais.span", "10", isOneOf(SPANS.map((s) => s.value)));
  const q = useSeasonality(ticker, Number(span));
  const s = q.data;
  const [ref, size] = useSize<HTMLDivElement>();
  const wide = size.w >= 900;
  const path = useMemo(() => (s ? pathOption(s) : null), [s]);

  useCsvExport(() => {
    if (!s) return [];
    return [
      {
        title: `Durchschnittlicher Jahresverlauf ${displayTicker(s.ticker)} (% seit Jahresbeginn)`,
        columns: ["Tag", "Durchschnitt", `${new Date(s.last).getFullYear()} bisher`, "Jahre im Plus bis zum Tag (%)"],
        rows: s.path.days.map((d, i) => [dayLabel(d), s.path.average[i], s.path.current[i] ?? null, s.path.plusShare[i]]),
      },
    ];
  });

  if (IS_STATIC) return <Empty>Die Saisonalität braucht den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;
  if (!ticker) return <Empty>Kein Wertpapier gewählt.</Empty>;

  return (
    <div className="panel-body flush sais" ref={ref}>
      <div className="toolbar">
        <Seg label="Zeitraum" value={span} options={SPANS.map((x) => ({ value: x.value, label: x.label }))} onChange={setSpan} />
        <span className="spacer" />
        {s && (
          <span className="muted sais-meta" title={s.name}>
            {displayTicker(s.ticker)} · {fmtDate(s.first)} – {fmtDate(s.last)} · {s.years} volle Jahre
          </span>
        )}
      </div>
      {q.isPending ? (
        <Loading rows={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !s ? null : (
        <div className="sais-body">
          <div className="sais-path">
            <div className="section-title" title="Kurs je Kalendertag gegenüber dem Jahresschluss des Vorjahres, gemittelt über alle vollen Jahre. Blaue Fläche: Anteil der Jahre, die bis zu diesem Tag im Plus lagen.">
              Durchschnittlicher Jahresverlauf · {s.name}
            </div>
            <div className="sais-path-chart">{path && <EChart option={path} csv={false} />}</div>
          </div>
          <div className={`sais-cards${wide ? " wide" : ""}`}>
            <BlockCard b={s.months} short={shortMonth} digits={1} hint="Monatsrendite (Monatsschluss gegen Vormonat) je Kalendermonat" />
            <BlockCard b={s.weekdays} short={shortDay} digits={2} hint="Tagesrendite je Wochentag" />
            <BlockCard b={s.turn} short={shortTurn} digits={3} hint="Tagesrendite am Monatswechsel (letzter Handelstag und die ersten drei des neuen Monats) gegen alle übrigen Tage" />
          </div>
          <div className={`sais-tables${wide ? " wide" : ""}`}>
            <GroupTable b={s.months} digits={1} />
            <div>
              <GroupTable b={s.weekdays} digits={2} />
              <GroupTable b={s.turn} digits={3} />
            </div>
          </div>
          <div className="notes">{s.note}</div>
        </div>
      )}
    </div>
  );
}
