// BWT – Bewertungstrend: KGVs von Sektoren und Ländern über die Jahre (tatsächlich) und die
// Analystenschätzungen für dieses und nächstes Jahr, mit der Richtung der Schätzungen.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg, TickerLink } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { fmt, fmtBig, fmtDate, isNum } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import { useCsvExport, type CsvDataset } from "../lib/exporter";
import {
  BAND_KEYS,
  bandsCsv,
  bandTestText,
  bandTestVerdict,
  decompositionText,
  fmtPe,
  groupRows,
  peTone,
  positionBlocks,
  quadrant,
  useValuationDetail,
  useValuationOverview,
  valuationApi,
  type BandKey,
  type Grouping,
  type ValDetail,
  type ValKind,
  type ValOverview,
  type ValRegion,
  type ValRow,
} from "../lib/valuation";
import type { ScreenProps } from "./types";

const pct = (x: number | null | undefined, digits = 1) =>
  !isNum(x) ? "–" : Math.abs(x * 100) < 0.5 * 10 ** -digits ? `${fmt(0, digits)} %` : `${x >= 0 ? "+" : "−"}${fmt(Math.abs(x * 100), digits)} %`;
const tone = (x: number | null | undefined) => (isNum(x) ? (x > 0.0005 ? "up" : x < -0.0005 ? "down" : "") : "");

export function BWT(_: ScreenProps) {
  const [kind, setKind] = usePersistentState<ValKind>("bwt.kind", "sector", isOneOf(["sector", "country"] as const));
  const [region, setRegion] = usePersistentState<ValRegion>("bwt.region", "all", isOneOf(["all", "us", "eu"] as const));
  const [view, setView] = usePersistentState<"table" | "map">("bwt.view", "table", isOneOf(["table", "map"] as const));
  const [grouping, setGrouping] = usePersistentState<Grouping>("bwt.group", "state", isOneOf(["state", "region", "none"] as const));
  const [selected, setSelected] = useState<string | null>(null);
  const q = useValuationOverview(kind, kind === "sector" ? region : "all");
  const qc = useQueryClient();
  const detail = useValuationDetail(kind, selected, kind === "sector" ? region : "all");

  if (IS_STATIC) return <Empty>Der Bewertungstrend braucht den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;

  const by: Grouping = kind === "sector" && grouping === "region" ? "state" : grouping;
  return (
    <>
      <div className="toolbar">
        <Seg
          label="Gruppen"
          value={kind}
          options={[
            { value: "sector", label: "Sektoren" },
            { value: "country", label: "Länder" },
          ]}
          onChange={(v) => {
            setKind(v);
            setSelected(null);
          }}
        />
        {kind === "sector" && (
          <Seg
            label="Region"
            value={region}
            options={[
              { value: "all", label: "USA + Europa" },
              { value: "us", label: "USA" },
              { value: "eu", label: "Europa" },
            ]}
            onChange={(v) => {
              setRegion(v);
              setSelected(null);
            }}
          />
        )}
        <Seg
          label="Ansicht"
          value={view}
          options={[
            { value: "table", label: "Tabelle" },
            { value: "map", label: "Landkarte" },
          ]}
          onChange={setView}
        />
        {view === "table" && (
          <Seg
            label="Gliederung"
            value={by}
            options={[
              { value: "state", label: "nach Zustand" },
              ...(kind === "country" ? [{ value: "region" as const, label: "nach Region" }] : []),
              { value: "none", label: "ohne" },
            ]}
            onChange={setGrouping}
          />
        )}
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {q.data?.builtAt ? `Stand ${fmtDate(q.data.builtAt)}` : ""}
        </span>
        <button
          type="button"
          className="tool"
          title="Neu berechnen (z. B. nach neuen Quartalszahlen). Mit EODHD kostet das API-Abrufe."
          disabled={q.data?.state === "building"}
          onClick={async () => {
            await valuationApi.refresh(kind, region);
            void qc.invalidateQueries({ queryKey: ["valuation"] });
          }}
        >
          ↻
        </button>
      </div>
      <div className="panel-body flush">
        {q.isPending ? (
          <Loading rows={8} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.rows.length ? (
          <Building o={q.data} />
        ) : (
          <>
            {q.data.state === "building" && <div className="bwt-progress small">Wird neu berechnet … {q.data.done} von {q.data.total} Firmen</div>}
            <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto" }}>
              {view === "table" ? (
                <ValTable o={q.data} by={by} selected={selected} onSelect={(k) => setSelected(k === selected ? null : k)} />
              ) : (
                <ValMap o={q.data} onSelect={setSelected} />
              )}
            </div>
            {selected && <Detail q={detail} onClose={() => setSelected(null)} />}
            <div className="notes">{q.data.note}</div>
          </>
        )}
      </div>
    </>
  );
}

function Building({ o }: { o: ValOverview | undefined }) {
  if (o?.state === "error") return <Empty>{o.message ?? "Berechnung fehlgeschlagen."}</Empty>;
  const share = o && o.total ? Math.round((o.done / o.total) * 100) : 0;
  return (
    <div className="state">
      <span>Bewertungstrend wird berechnet … {o && o.total ? `${o.done} von ${o.total} Firmen (${share} %)` : "Firmen werden ausgewählt"}</span>
      <span className="muted small">Einmal täglich; mit EODHD beim ersten Mal etwa ein bis zwei Minuten.</span>
    </div>
  );
}

function ValTable({ o, by, selected, onSelect }: { o: ValOverview; by: Grouping; selected: string | null; onSelect: (key: string) => void }) {
  const past = o.years.filter((y) => !o.estYears.includes(y));
  const groups = groupRows(o.rows, by);
  const cols = 2 + past.length + 1 + o.estYears.length + 8;
  return (
    <table className="t bwt" data-export-title="Bewertungstrend">
      <thead>
        <tr>
          <th>{o.kind === "sector" ? "Sektor" : "Land"}</th>
          <th className="num" title="Zahl der einbezogenen Firmen (größte nach Börsenwert)">Firmen</th>
          {past.map((y) => (
            <th key={y} className="num" title={`Kurs am Jahresende ${y} ÷ tatsächlicher Gewinn ${y}`}>
              KGV {y}
            </th>
          ))}
          <th className="num" title="Heutiger Kurs ÷ Gewinn der letzten zwölf Monate">heute</th>
          {o.estYears.map((y) => (
            <th key={y} className="num est" title={`Heutiger Kurs ÷ Analystenkonsens für ${y} (Kalenderjahr)`}>
              {y}e
            </th>
          ))}
          <th className="num" title="Übliches KGV: Median der Monatswerte der letzten zehn Jahre">Median 10 J.</th>
          <th title="Lage des heutigen KGV in der Spanne der letzten zehn Jahre: links günstig, rechts teuer">Lage</th>
          <th className="num" title={`Fair Value = übliches KGV (Median) × Gewinnschätzung ${o.estYears[o.estYears.length - 1]}. Plus: Kurs liegt darunter (Luft nach oben), minus: darüber`}>Fair Value</th>
          <th className="num" title="Veränderung des KGV in zwölf Monaten (Punkte)">12 M</th>
          <th className="num" title="Erwartetes Gewinnwachstum nächstes Jahr gegenüber diesem">Gewinn+</th>
          <th className="num" title="Wie sich der Analystenkonsens für das nächste Jahr in 90 Tagen verändert hat">Schätzung 90 T</th>
          <th className="num" title="Anhebungen / Senkungen der Schätzungen in 30 Tagen (Zahl der Analysten-Änderungen)">↑ / ↓ 30 T</th>
          <th className="num" title="Abstand des Gruppen-Börsenwerts zum 52-Wochen-Hoch">Abst. Hoch</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <FragmentRows key={g.title ?? "all"} title={g.title} cols={cols} rows={g.rows} past={past} o={o} selected={selected} onSelect={onSelect} />
        ))}
      </tbody>
    </table>
  );
}

function FragmentRows({ title, cols, rows, past, o, selected, onSelect }: { title: string | null; cols: number; rows: ValRow[]; past: number[]; o: ValOverview; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <>
      {title && (
        <tr className={`group bwt-g-${rows[0]?.state ?? ""}`}>
          <td colSpan={cols}>{title}</td>
        </tr>
      )}
      {rows.map((r) => (
        <tr key={r.key} className={`clickable ${r.key === selected ? "selected" : ""} ${r.state === "baer" ? "bwt-baer" : ""}`} onClick={() => onSelect(r.key)} title="Verlauf, Zerlegung und Einzelwerte zeigen">
          <td>{r.label}</td>
          <td className="num muted">{r.n}</td>
          {past.map((y) => (
            <td key={y} className={`num ${peTone(r.peYears[String(y)], r.avg)}`} title={coverTitle(r, y)}>
              {fmtPe(r.peYears[String(y)], r.negativeYears.includes(y))}
            </td>
          ))}
          <td className={`num ${peTone(r.peTtm, r.avg)}`} style={{ fontWeight: 600 }}>
            {fmtPe(r.peTtm)}
          </td>
          {o.estYears.map((y) => (
            <td key={y} className="num est" title={coverTitle(r, y)}>
              {fmtPe(r.peYears[String(y)], r.negativeYears.includes(y))}
            </td>
          ))}
          <td className="num muted">{fmtPe(r.median ?? r.avg)}</td>
          <td className="bwt-pos" data-csv={isNum(r.position) ? `${Math.round(r.position * 100)} %` : ""} title={r.position === null ? undefined : `${Math.round(r.position * 100)} % der Monate der letzten zehn Jahre waren günstiger oder gleich (Spanne ${fmtPe(r.low)} – ${fmtPe(r.high)})`}>
            {positionBlocks(r.position)}
          </td>
          <td className={`num ${tone(r.fairGap)}`}>{pct(r.fairGap, 0)}</td>
          <td className={`num ${isNum(r.chg12m) ? (r.chg12m > 0.05 ? "pe-hi" : r.chg12m < -0.05 ? "pe-lo" : "") : ""}`}>
            {isNum(r.chg12m) ? `${r.chg12m >= 0 ? "+" : "−"}${fmt(Math.abs(r.chg12m), 1)}` : "–"}
          </td>
          <td className={`num ${tone(r.growthNext)}`}>{pct(r.growthNext, 0)}</td>
          <td className={`num ${tone(r.rev90)}`} title={`30 Tage: ${pct(r.rev30)}`}>
            {pct(r.rev90)}
          </td>
          <td className="num">
            <span className="up">{r.up30}</span> / <span className="down">{r.down30}</span>
          </td>
          <td className={`num ${r.state === "baer" ? "down" : r.state === "korrektur" ? "lbl" : "muted"}`}>{pct(r.dist52)}</td>
        </tr>
      ))}
    </>
  );
}

/** Hinweis je Jahr: aus wie vielen Firmen das KGV berechnet ist (junge Börsengänge fehlen in frühen Jahren). */
function coverTitle(r: ValRow, y: number): string | undefined {
  const c = r.coverage?.[String(y)];
  if (c === undefined) return undefined;
  return c < r.n ? `aus ${c} von ${r.n} Firmen (übrige ohne Gewinn- oder Kursdaten für ${y}, z. B. spätere Börsengänge)` : `aus allen ${r.n} Firmen`;
}

function ValMap({ o, onSelect }: { o: ValOverview; onSelect: (key: string) => void }) {
  const option = useMemo<EOption>(() => {
    const pts = o.rows.filter((r) => isNum(r.position) && isNum(r.rev90));
    const maxRev = Math.max(0.02, ...pts.map((r) => Math.abs(r.rev90! * 100))) * 1.25;
    return {
      animation: false,
      grid: { left: 62, right: 110, top: 24, bottom: 40 },
      tooltip: {
        ...TOOLTIP,
        formatter: (p: { data: { row: ValRow } }) => {
          const r = p.data.row;
          return `${r.label}<br/>KGV heute ${fmtPe(r.peTtm)} (üblich ${fmtPe(r.median ?? r.avg)})<br/>bis Fair Value ${pct(r.fairGap, 0)}<br/>Schätzung nächstes Jahr 90 T: ${pct(r.rev90)}<br/>${quadrant(r.position, r.rev90)}`;
        },
      },
      xAxis: { type: "value", min: 0, max: 100, name: "günstiger als üblich  ←  Lage in der 10-Jahres-Spanne  →  teurer als üblich", nameLocation: "middle", nameGap: 24, ...AXIS, nameTextStyle: { color: "#8f8f8f", fontSize: 10 } },
      yAxis: { type: "value", min: -maxRev, max: maxRev, name: "Schätzungen fürs nächste Jahr, 90 Tage (%)", nameLocation: "middle", nameGap: 40, nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${fmt(v, 0)}` } },
      series: [
        {
          type: "scatter",
          symbolSize: (_: unknown, p: { data: { row: ValRow } }) => Math.max(8, Math.min(26, 6 + p.data.row.n)),
          data: pts.map((r) => ({
            value: [r.position! * 100, r.rev90! * 100],
            row: r,
            itemStyle: { color: r.rev90! >= 0 ? (r.position! < 0.5 ? "#29d17d" : "#ffa028") : r.position! < 0.5 ? "#66b8ff" : "#ff5252" },
          })),
          label: { show: true, position: "right", color: "#ececec", fontSize: 10, formatter: (p: { data: { row: ValRow } }) => p.data.row.label },
          markLine: {
            silent: true, symbol: "none", lineStyle: { color: "#3a3a3a", type: "dashed" }, label: { show: false },
            data: [{ xAxis: 50 }, { yAxis: 0 }],
          },
        },
      ],
      graphic: [
        { type: "text", left: 70, top: 30, style: { text: "günstig · Schätzungen ↑  (Erholungskandidat)", fill: "#29d17d", fontSize: 10 } },
        { type: "text", right: 118, top: 30, style: { text: "teuer · Schätzungen ↑  (eingepreist)", fill: "#ffa028", fontSize: 10, align: "right" } },
        { type: "text", left: 70, bottom: 48, style: { text: "günstig · Schätzungen ↓  (billig aus gutem Grund?)", fill: "#66b8ff", fontSize: 10 } },
        { type: "text", right: 118, bottom: 48, style: { text: "teuer · Schätzungen ↓  (Vorsicht)", fill: "#ff5252", fontSize: 10, align: "right" } },
      ],
    } as EOption;
  }, [o]);
  return (
    <div style={{ height: "100%", minHeight: 260 }}>
      <EChart option={option} csv={false} onClick={(p) => p.data && onSelect((p.data as { row: ValRow }).row.key)} />
    </div>
  );
}

function detailOption(d: ValDetail): EOption {
  const r = d.row;
  const monthly = d.monthly.t.map((t, i) => [t, d.monthly.v[i]]).filter((x) => isNum(x[1]));
  const est = d.estYears.map((y) => [`${y}-12-31`, r.peYears[String(y)], `${y}e`]).filter((x) => isNum(x[1]));
  return {
    animation: false,
    grid: { left: 44, right: 30, top: 16, bottom: 22 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => fmtPe(v) },
    xAxis: { type: "time", max: `${d.estYears[d.estYears.length - 1] + 1}-03-31`, ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, splitNumber: 3, ...AXIS },
    series: [
      {
        name: "KGV (letzte 12 Monate)", type: "line", data: monthly, symbol: "none", lineStyle: { color: "#d8d8d8", width: 1.5 },
        markLine: isNum(r.median ?? r.avg) ? { silent: true, symbol: "none", lineStyle: { color: "#ffa028", type: "dashed", opacity: 0.8 }, label: { color: "#ffa028", fontSize: 10, position: "insideStartTop", formatter: `Median ${fmtPe(r.median ?? r.avg)}` }, data: [{ yAxis: r.median ?? r.avg }] } : undefined,
        markArea: d.bands
          ? {
              silent: true,
              data: [
                [{ yAxis: d.bands.pct.p10, itemStyle: { color: "rgba(255,160,40,0.06)" } }, { yAxis: d.bands.pct.p90 }],
                [{ yAxis: d.bands.pct.p25, itemStyle: { color: "rgba(255,160,40,0.10)" } }, { yAxis: d.bands.pct.p75 }],
              ],
            }
          : undefined,
      },
      {
        name: "Analysten (Kalenderjahr)", type: "scatter", data: est, symbol: "diamond", symbolSize: 9, itemStyle: { color: "#ffa028" },
        label: { show: true, position: "top", color: "#ffa028", fontSize: 10, formatter: (p: { data: [string, number, string] }) => `${p.data[2]} ${fmtPe(p.data[1])}` },
      },
    ],
  } as EOption;
}

/** Kurs-Sicht: Kursindex der Gruppe (heute = 100) mit den Kurslinien beim KGV der Bänder, rechts fortgesetzt. */
function priceBandOption(d: ValDetail): EOption | null {
  const b = d.bands;
  if (!b) return null;
  const pair = (ts: string[], vs: (number | null)[]) => ts.map((t, i) => [t, vs[i]]).filter((x) => isNum(x[1]));
  const look: Record<BandKey, { color: string; type: "solid" | "dashed" | "dotted"; width: number; name: string }> = {
    p10: { color: "rgba(255,160,40,0.45)", type: "dotted", width: 1, name: "KGV 10 %" },
    p25: { color: "rgba(255,160,40,0.75)", type: "dashed", width: 1, name: "KGV 25 %" },
    p50: { color: "#ffa028", type: "solid", width: 2, name: "Median-KGV" },
    p75: { color: "rgba(255,160,40,0.75)", type: "dashed", width: 1, name: "KGV 75 %" },
    p90: { color: "rgba(255,160,40,0.45)", type: "dotted", width: 1, name: "KGV 90 %" },
  };
  const series: unknown[] = [
    { name: "Kursindex (heute = 100)", type: "line", data: pair(b.t, b.level), symbol: "none", lineStyle: { color: "#ececec", width: 1.5 }, z: 5 },
  ];
  for (const k of BAND_KEYS) {
    series.push({ name: `${look[k].name} (${fmtPe(b.pct[k])})`, type: "line", data: pair(b.t, b.lines[k]), symbol: "none", lineStyle: { color: look[k].color, type: look[k].type, width: look[k].width } });
    series.push({ name: `${look[k].name} – Schätzung`, type: "line", data: pair(b.futureT, b.future[k]), symbol: "circle", symbolSize: 3, lineStyle: { color: look[k].color, type: "dotted", width: look[k].width }, itemStyle: { color: look[k].color } });
  }
  return {
    animation: false,
    grid: { left: 44, right: 30, top: 16, bottom: 22 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => fmt(v, 1) },
    xAxis: { type: "time", max: `${d.estYears[d.estYears.length - 1] + 1}-03-31`, ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, splitNumber: 3, ...AXIS },
    series,
  } as EOption;
}

function forwardOption(d: ValDetail): EOption | null {
  // Analystenblick aufs nächste Jahr: 90-Tage-Verlauf der Quelle plus eigene tägliche Aufzeichnung
  const pts = new Map<string, number>();
  d.forwardPath.t.forEach((t, i) => isNum(d.forwardPath.v[i]) && pts.set(t, d.forwardPath.v[i]!));
  d.recorded.t.forEach((t, i) => isNum(d.recorded.v[i]) && pts.set(t, d.recorded.v[i]!));
  const data = Array.from(pts.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  if (data.length < 2) return null;
  return {
    animation: false,
    grid: { left: 40, right: 10, top: 10, bottom: 20 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => fmtPe(v) },
    xAxis: { type: "time", ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, splitNumber: 2, ...AXIS },
    series: [{ name: `KGV auf ${d.estYears[1]}e`, type: "line", data, symbolSize: 5, lineStyle: { color: "#66b8ff" }, itemStyle: { color: "#66b8ff" } }],
  } as EOption;
}

function Detail({ q, onClose }: { q: ReturnType<typeof useValuationDetail>; onClose: () => void }) {
  const d = q.data;
  const [view, setView] = usePersistentState<"pe" | "price">("bwt.detailView", "price", isOneOf(["pe", "price"] as const));
  const main = useMemo(() => (d ? (view === "price" && d.bands ? priceBandOption(d) : detailOption(d)) : null), [d, view]);
  const fwd = useMemo(() => (d ? forwardOption(d) : null), [d]);
  // CSV: KGV-Verlauf je Monat, Jahres-KGVs mit Schätzungen, Schätzungsverlauf und KGV-Bänder
  useCsvExport(() => {
    if (!d) return [];
    const r = d.row;
    const sets: CsvDataset[] = [
      { title: `${r.label} – KGV der letzten 12 Monate je Monat`, columns: ["Monat", "KGV"], rows: d.monthly.t.map((t, i) => [t, d.monthly.v[i]]) },
      {
        title: `${r.label} – KGV je Jahr (e = Analystenschätzung)`,
        columns: ["Jahr", "KGV", `Firmen mit Daten (von ${r.n})`],
        rows: d.years.map((y) => [d.estYears.includes(y) ? `${y}e` : String(y), r.peYears[String(y)] ?? null, d.coverage[String(y)] ?? null]),
      },
    ];
    const fwdPts = new Map<string, number | null>();
    d.forwardPath.t.forEach((t, i) => fwdPts.set(t, d.forwardPath.v[i]));
    d.recorded.t.forEach((t, i) => fwdPts.set(t, d.recorded.v[i]));
    if (fwdPts.size)
      sets.push({
        title: `${r.label} – KGV auf Schätzung ${d.estYears[1] ?? ""} (Verlauf)`,
        columns: ["Tag", "KGV"],
        rows: Array.from(fwdPts.entries()).sort(([a], [b]) => (a < b ? -1 : 1)),
      });
    const dec = Object.entries(d.decomposition);
    if (dec.length)
      sets.push({
        title: `${r.label} – Zerlegung der KGV-Veränderung`,
        columns: ["Zeitraum", "Kurs [%]", "Gewinn [%]", "KGV [%]"],
        rows: dec.map(([k, v]) => [k, isNum(v.price) ? v.price * 100 : null, isNum(v.earnings) ? v.earnings * 100 : null, isNum(v.pe) ? v.pe * 100 : null]),
      });
    if (d.bands) sets.push(bandsCsv(d.bands, `${r.label} – KGV-Bänder`, "Kursindex (heute = 100)"));
    return sets;
  });
  return (
    <div className="bwt-detail">
      <button type="button" className="tool eco-fc-close" aria-label="Detail schließen" onClick={onClose}>
        ×
      </button>
      {q.isPending ? (
        <Loading rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : d && main ? (
        <>
          <div className="fc-head">
            <b>{d.row.label}</b>
            <span className="xs muted">{d.row.n} Firmen · KGV heute {fmtPe(d.row.peTtm)} · üblich {fmtPe(d.row.median ?? d.row.avg)} (Spanne {fmtPe(d.row.low)} – {fmtPe(d.row.high)})</span>
            <span className="xs lbl">{quadrant(d.row.position, d.row.rev90)}</span>
            {d.bands && (
              <span style={{ marginLeft: "auto" }}>
                <Seg
                  label="Darstellung"
                  value={view}
                  options={[
                    { value: "price", label: "Kurs + KGV-Bänder" },
                    { value: "pe", label: "KGV-Verlauf" },
                  ]}
                  onChange={setView}
                />
              </span>
            )}
          </div>
          <div className="bwt-detail-body">
            <div className="bwt-chart">
              <EChart option={main} csv={false} />
            </div>
            <div className="bwt-side small">
              {d.bands && (
                <>
                  <div className="section-title">Fair Value (übliches KGV × Gewinnschätzung)</div>
                  <div>
                    KGV heute {fmtPe(d.bands.peNow)} · Median {fmtPe(d.bands.pct.p50)} (Bereich {fmtPe(d.bands.pct.p25)} – {fmtPe(d.bands.pct.p75)}) ·{" "}
                    {d.bands.fairYear}: <span className={tone(d.bands.fairGap)}>{pct(d.bands.fairGap, 0)}</span> bis Fair Value
                  </div>
                  <div className="xs dim" title={d.bands.note}>
                    Rückblick ({bandTestVerdict(d.bands.test)}): {bandTestText(d.bands.test)}
                  </div>
                </>
              )}
              <div className="section-title" style={{ marginTop: 4 }}>Warum hat sich das KGV verändert?</div>
              {(["1J", "3J", "5J"] as const).map((k) => d.decomposition[k] && <div key={k}>{decompositionText(k.replace("J", " Jahr" + (k === "1J" ? "" : "e")), d.decomposition[k])}</div>)}
              <div className="section-title" style={{ marginTop: 6 }}>Analystenblick auf {d.estYears[1]}</div>
              <div>
                Schätzung 90 T <span className={tone(d.row.rev90)}>{pct(d.row.rev90)}</span> · 30 T <span className={tone(d.row.rev30)}>{pct(d.row.rev30)}</span> · Anhebungen{" "}
                <span className="up">{d.row.up30}</span> / Senkungen <span className="down">{d.row.down30}</span>
              </div>
              {fwd ? (
                <div style={{ height: 70, flex: "0 0 auto" }}>
                  <EChart option={fwd} csv={false} style={{ minHeight: 0 }} />
                </div>
              ) : null}
              <div className="xs dim">
                {d.recorded.t.length > 1
                  ? `Eigene Aufzeichnung seit ${fmtDate(d.recorded.t[0])} (${d.recorded.t.length} Tage).`
                  : "Ab heute zeichnet das Terminal täglich auf – nach einigen Wochen entsteht ein eigener Verlauf."}
              </div>
            </div>
          </div>
          <Members d={d} />
        </>
      ) : null}
    </div>
  );
}

function Members({ d }: { d: ValDetail }) {
  const past = d.years.filter((y) => !d.estYears.includes(y));
  return (
    <div className="bwt-members">
      <table className="t" data-export-title="Firmen">
        <thead>
          <tr>
            <th>Firma</th>
            <th className="num">Börsenwert</th>
            {past.map((y) => (
              <th key={y} className="num">
                {y}
              </th>
            ))}
            <th className="num">heute</th>
            {d.estYears.map((y) => (
              <th key={y} className="num est">
                {y}e
              </th>
            ))}
            <th className="num">Schätzung 90 T</th>
            <th className="num" title="Übliches KGV der Firma (Median 10 J.) × Gewinnschätzung nächstes Jahr, verglichen mit dem Kurs">Fair Value</th>
            <th className="num">Abst. Hoch</th>
          </tr>
        </thead>
        <tbody>
          {d.members.map((m) => (
            <tr key={m.ticker} title={m.notes.join(" · ") || undefined}>
              <td>
                <TickerLink ticker={m.ticker} /> <span className="muted">{m.name}</span>
              </td>
              <td className="num muted">{fmtBig(m.mcap, 0)}</td>
              {past.map((y) => (
                <td key={y} className="num">
                  {fmtPe(m.peYears[String(y)])}
                </td>
              ))}
              <td className="num" style={{ fontWeight: 600 }}>
                {fmtPe(m.peTtm)}
              </td>
              {d.estYears.map((y) => (
                <td key={y} className="num est">
                  {fmtPe(m.peYears[String(y)])}
                </td>
              ))}
              <td className={`num ${tone(m.rev90)}`}>{pct(m.rev90)}</td>
              <td className={`num ${tone(m.fairGap)}`} title={isNum(m.median) ? `übliches KGV ${fmtPe(m.median)}` : undefined}>
                {pct(m.fairGap, 0)}
              </td>
              <td className={`num ${isNum(m.dist52) && m.dist52 <= -0.2 ? "down" : "muted"}`}>{pct(m.dist52)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
