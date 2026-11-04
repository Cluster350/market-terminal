// WMAP – Weltkarte: Länder eingefärbt nach Aktienmarkt, Zinsen oder Konjunktur.

import { useMemo } from "react";
import EChart, { registerMap, TOOLTIP } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg } from "../components/ui";
import { explain } from "../lib/glossary";
import { escapeHtml, fmt, fmtDate, fmtPrice } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import {
  colorRange,
  GROUP_LABEL,
  MAP_NAME,
  METRIC_BY_KEY,
  METRICS,
  useWorldMap,
  VIEWS,
  worldGeoJson,
  type Metric,
  type WorldCountry,
  type WorldGroup,
} from "../lib/worldmap";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

registerMap(MAP_NAME, worldGeoJson() as never);

const GROUPS = ["equity", "rates", "macro"] as const;
const VIEW_KEYS = Object.keys(VIEWS) as (keyof typeof VIEWS)[];

export function formatMetric(m: Metric, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const shown = Number(v.toFixed(m.digits)) === 0 ? 0 : v; // kein „+0,0 %“ neben „0,0 %“
  const sign = m.signed && shown > 0 ? "+" : "";
  return `${sign}${fmt(Math.abs(shown) === 0 ? 0 : shown, m.digits)}${m.unit === "bp" ? " bp" : " %"}`;
}

/** Farbe eines Werts: nur bei Veränderungen (grün gut, rot schlecht; steigende Renditen rot). */
export function toneOf(m: Metric, v: number): string {
  if (m.scale !== "diverging" && m.scale !== "inverse") return "";
  const good = m.scale === "diverging" ? v > 0 : v < 0;
  return v === 0 ? "" : good ? "up" : "down";
}

function detail(c: WorldCountry, m: Metric): string {
  if (m.group === "equity" && c.index) return `${c.index.name} ${fmtPrice(c.index.last)}`;
  if (m.group === "rates" && c.bond) return `10 J. ${fmt(c.bond.value, 2)} % · 1 M ${c.bond.chg1mBp === null ? "–" : `${c.bond.chg1mBp > 0 ? "+" : ""}${fmt(c.bond.chg1mBp, 0)} bp`}`;
  if (m.group === "macro" && m.macroKey) {
    const year = c.macro[m.macroKey]?.year;
    return year ? `Stand ${year}` : "";
  }
  return "";
}

export function WMAP(_: ScreenProps) {
  const ws = useWorkspace();
  const [group, setGroup] = usePersistentState<WorldGroup>("wmap.group", "equity", isOneOf(GROUPS));
  const [metricKey, setMetricKey] = usePersistentState<string>("wmap.metric", "eq_1d", (x): x is string => typeof x === "string" && x in METRIC_BY_KEY);
  const [view, setView] = usePersistentState<keyof typeof VIEWS>("wmap.view", "welt", isOneOf(VIEW_KEYS));
  const metric = METRIC_BY_KEY[metricKey]?.group === group ? METRIC_BY_KEY[metricKey] : METRICS.find((m) => m.group === group)!;
  const q = useWorldMap(group);

  const rows = useMemo(
    () =>
      (q.data?.countries ?? [])
        .map((c) => ({ c, v: metric.value(c) }))
        .filter((r): r is { c: WorldCountry; v: number } => r.v !== null && Number.isFinite(r.v))
        .sort((a, b) => b.v - a.v),
    [q.data, metric],
  );
  // Rangliste und Farbskala nur aus den Ländern des Ausschnitts
  const members = VIEWS[view]?.members;
  const inView = useMemo(() => (members ? rows.filter((r) => members.includes(r.c.iso3)) : rows), [rows, members]);

  function open(c: WorldCountry) {
    if (metric.group === "equity" && c.index) ws.setSecurity(c.index.ticker, { open: "GP", stay: true });
    else if (metric.group === "rates" && c.bond) ws.setSecurity(c.bond.ticker, { open: "GP", stay: true });
    else if (metric.group === "macro") ws.openFn("ECST");
  }

  const option = useMemo(() => {
    const range = colorRange(inView.map((r) => r.v), metric.scale, metric.domain);
    const vals = inView.map((r) => r.v);
    // Werte außerhalb der Skala kennzeichnen (≤/≥), statt die Skala stillschweigend zu kappen
    const hiMark = vals.some((x) => x > range.max + 1e-9) ? "≥ " : "";
    const loMark = vals.some((x) => x < range.min - 1e-9) ? "≤ " : "";
    const v = VIEWS[view];
    const byIso = new Map(rows.map((r) => [r.c.iso3, r]));
    return {
      tooltip: {
        ...TOOLTIP,
        trigger: "item",
        formatter: (p: { name: string; data?: { value: number; label: string; detail: string } }) =>
          p.data
            ? `<b>${escapeHtml(p.data.label)}</b><br/>${escapeHtml(metric.label)}: <b>${escapeHtml(formatMetric(metric, p.data.value))}</b>${p.data.detail ? `<br/><span style="color:#8f8f8f">${escapeHtml(p.data.detail)}</span>` : ""}`
            : `${escapeHtml(p.name)}<br/><span style="color:#8f8f8f">keine Daten</span>`,
      },
      visualMap: {
        type: "continuous",
        min: range.min,
        max: range.max,
        calculable: false,
        orient: "horizontal",
        left: 8,
        bottom: 6,
        itemWidth: 9,
        itemHeight: 130,
        text: [hiMark + formatMetric(metric, range.max), loMark + formatMetric(metric, range.min)],
        textGap: 6,
        textStyle: { color: "#8f8f8f", fontSize: 10 },
        inRange: { color: range.colors },
        seriesIndex: 0,
      },
      series: [
        {
          type: "map",
          map: MAP_NAME,
          roam: false,
          zoom: v.zoom,
          center: v.center,
          aspectScale: 0.82,
          selectedMode: false,
          label: { show: false },
          itemStyle: { areaColor: "#141414", borderColor: "#353535", borderWidth: 0.5 },
          emphasis: { label: { show: false }, itemStyle: { areaColor: "#ffa028", borderColor: "#ffa028" } },
          data: Array.from(byIso.values()).map((r) => ({ name: r.c.iso3, value: r.v, label: r.c.name, detail: detail(r.c, metric) })),
        },
      ],
    };
  }, [rows, inView, metric, view]);

  const best = inView[0];
  const worst = inView[inView.length - 1];
  const groupMetrics = METRICS.filter((m) => m.group === group);

  return (
    <>
      <div className="toolbar">
        <Seg label="Bereich" value={group} options={GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] }))} onChange={(g) => { setGroup(g); setMetricKey(METRICS.find((m) => m.group === g)!.key); }} />
        <Seg label="Kennzahl" value={metric.key} options={groupMetrics.map((m) => ({ value: m.key, label: m.label }))} onChange={setMetricKey} />
        <span className="sep" />
        <Seg label="Ausschnitt" value={view} options={VIEW_KEYS.map((k) => ({ value: k, label: VIEWS[k].label }))} onChange={setView} />
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {inView.length} Länder{q.data?.asOf ? ` · Stand ${fmtDate(q.data.asOf)}` : ""}
        </span>
      </div>
      <div className="panel-body wmap-body">
        {q.isPending ? (
          <Loading rows={8} />
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !rows.length ? (
          <Empty>Für diese Kennzahl liegen keine Länderdaten vor.</Empty>
        ) : (
          <div className="wmap-grid">
            <div className="wmap-map">
              <EChart
                option={option}
                onClick={(p) => {
                  const iso = p.name;
                  const r = rows.find((x) => x.c.iso3 === iso);
                  if (r) open(r.c);
                }}
              />
              {best && worst && best !== worst && (
                <div className="wmap-extremes">
                  <span className={toneOf(metric, best.v)}>Höchster: {best.c.name} {formatMetric(metric, best.v)}</span>
                  <span className={toneOf(metric, worst.v)}>Niedrigster: {worst.c.name} {formatMetric(metric, worst.v)}</span>
                </div>
              )}
            </div>
            <div className="wmap-list" role="list" aria-label={`Rangliste ${metric.label}`}>
              {inView.map((r, i) => (
                <button key={r.c.iso3} type="button" role="listitem" className="wmap-row" onClick={() => open(r.c)} title={detail(r.c, metric)}>
                  <span className="dim">{i + 1}</span>
                  <span className="wmap-name">{r.c.name}</span>
                  <span className={toneOf(metric, r.v)}>{formatMetric(metric, r.v)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="notes" title={explain("Weltkarte")}>
          {q.data?.note ?? ""} Klick auf ein Land öffnet {group === "equity" ? "den Index-Chart" : group === "rates" ? "den Renditechart" : "die Länderdaten (ECST)"}.
        </div>
      </div>
    </>
  );
}
