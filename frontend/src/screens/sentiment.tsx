// STIM – Stimmungsterminal: Wie ängstlich oder sorglos ist der Markt, gemessen an seiner eigenen Geschichte?
// Viertelpanel: Gesamtwert und Bausteine. Groß (maximiert oder eigenes Fenster): Verlauf, Marktbreite, Sektoren, Rückblick.

import { useMemo } from "react";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg, Spark, useSize } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { useCsvExport } from "../lib/exporter";
import { DASH, fmt, fmtDate, isNum } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import {
  BACKTEST_WORD,
  bandLabel,
  compChange,
  compValue,
  divergences,
  isExtreme,
  pctSigned,
  rankColor,
  rankText,
  sliceFrom,
  useSentiment,
  type SentComponent,
  type SentimentResult,
  type SentRegion,
} from "../lib/sentiment";
import type { ScreenProps } from "./types";

const REGIONS: { value: SentRegion; label: string }[] = [
  { value: "us", label: "USA" },
  { value: "eu", label: "Europa" },
];
const RANGES = [
  { value: "12", label: "1 J" },
  { value: "36", label: "3 J" },
  { value: "60", label: "5 J" },
  { value: "0", label: "seit Beginn" },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
const BREADTH_TABS = [
  { value: "pct200", label: "200-Tage-Index", title: "Anteil der Firmen über ihrem 200-Tage-Schnitt (%)" },
  { value: "nhnl", label: "Hochs/Tiefs", title: "52-Wochen-Hochs minus -Tiefs in % der Firmen, 10-Tage-Schnitt" },
  { value: "adl", label: "A/D-Linie", title: "Aufsummiert: steigende minus fallende Firmen je Tag" },
  { value: "trust", label: "Trust", title: "Anteil steigender Firmen, 10-Tage-Schnitt (%)" },
  { value: "breadthVol", label: "Breadth", title: "Anteil des Volumens in steigenden Firmen, 10-Tage-Schnitt (%)" },
  { value: "trin", label: "TRIN", title: "Arms-Index, 10-Tage-Schnitt: über 1 = Volumen drängt in fallende Werte" },
] as const;
type BreadthKey = (typeof BREADTH_TABS)[number]["value"];
const GRADIENT = "linear-gradient(90deg, #5b8cff 0%, #5b8cff 10%, #8f8f8f 30%, #8f8f8f 70%, #ff5fa2 90%, #ff5fa2 100%)";
const MAX_W = 980;
const MAX_H = 540;
const DISCLAIMER = "Sehr hohe oder sehr niedrige Werte kippten früher eher ins Gegenteil – oft erst nach Monaten. Beschreibung der Lage, keine Empfehlung.";

// --- Bausteine der Darstellung ------------------------------------------------------------------

/** Skalenbalken 0–100 mit Marken: gefüllt = heute, hohl = früher. */
function ScaleBar({ now, marks = [], span, height = 26 }: { now: number | null; marks?: { v: number | null; label: string }[]; span?: [number | null, number | null]; height?: number }) {
  const pos = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  return (
    <div className="stim-scale" style={{ height }}>
      <div className="stim-scale-track" style={{ background: GRADIENT }} />
      {span && isNum(span[0]) && isNum(span[1]) && (
        <div className="stim-scale-span" style={{ left: pos(span[0]), width: `${Math.max(0.5, span[1] - span[0])}%` }} title={`Spanne der letzten 12 Monate: ${fmt(span[0], 0)} bis ${fmt(span[1], 0)}`} />
      )}
      {marks.map((m, i) =>
        isNum(m.v) ? (
          <span key={m.label} className="stim-mark hollow" style={{ left: pos(m.v) }} title={`${m.label}: ${fmt(m.v, 0)}`}>
            <i className={i % 2 ? "below" : undefined}>{m.label}</i>
          </span>
        ) : null,
      )}
      {isNum(now) && <span className={`stim-mark${isExtreme(now) ? " big" : ""}`} style={{ left: pos(now), background: rankColor(now) }} title={`heute: ${fmt(now, 0)}`} />}
    </div>
  );
}

/** Rang-Linie einer Zeile: Mitte = 50, gefüllt = heute, hohl = vor einer Woche. */
function RankLine({ rank, before }: { rank: number | null; before: number | null }) {
  if (!isNum(rank)) return <div className="stim-rank empty" />;
  return (
    <div className="stim-rank" title={`Rang heute ${fmt(rank, 0)}${isNum(before) ? ` · vor einer Woche ${fmt(before, 0)}` : ""} (0 = Angst, 100 = Gier)`}>
      <span className="stim-rank-mid" />
      {isNum(before) && <span className="stim-dot hollow" style={{ left: `${before}%` }} />}
      <span className={`stim-dot${isExtreme(rank) ? " big" : ""}`} style={{ left: `${rank}%`, background: rankColor(rank) }} />
    </div>
  );
}

function label(c: SentComponent) {
  return (
    <>
      {c.label}
      {c.approx && <span className="stim-approx" title="Näherung, nicht die offizielle Zahl"> ≈</span>}
    </>
  );
}

function CompTable({ d }: { d: SentimentResult }) {
  const rows = [...d.components, ...(d.trend ? [d.trend] : [])];
  return (
    <table className="t stim-table" data-export-title={`Stimmung ${d.label} – Bausteine`}>
      <thead>
        <tr>
          <th>Baustein</th>
          <th className="num">Wert</th>
          <th className="stim-rank-head" data-csv="Rang (0 = Angst, 100 = Gier)">
            <span>Angst</span> ← Rang → <span>Gier</span>
          </th>
          <th className="num" title="Veränderung gegenüber vor einer Woche">1 W</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const off = !c.inTotal;
          const trend = c.key === "trend";
          return (
            <tr key={c.key} className={off ? "stim-off" : undefined}>
              <td title={`${c.explain}${c.sentence ? `\nHeute ${c.sentence}.` : ""}${c.note && c.available ? `\n${c.note}` : ""}${off && c.available ? "\nZählt nicht zum Gesamtwert." : ""}`}>
                {label(c)}
                {trend && <span className="dim"> (Kontext)</span>}
              </td>
              <td className="num" title={c.note && (!c.available || c.note.startsWith("sammelt")) ? c.note : undefined}>
                {!c.available ? <span className="stim-note">{c.note}</span> : c.note?.startsWith("sammelt") ? <span className="stim-note">sammelt</span> : compValue(c, c.value)}
              </td>
              <td data-csv={isNum(c.rank) ? fmt(c.rank, 0) : ""}>{c.available ? <RankLine rank={c.rank} before={c.rank1w} /> : <div className="stim-rank empty" />}</td>
              <td className="num muted" data-csv={c.available && isNum(c.value) && isNum(c.value1w) ? fmt(c.value - c.value1w, 2) : ""}>
                {c.available ? compChange(c, c.value, c.value1w) : DASH}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TotalBlock({ d, wide }: { d: SentimentResult; wide?: boolean }) {
  const t = d.total;
  return (
    <div className="stim-total">
      <div className="section-title" title="Mittel der Ränge aller Bausteine der Region (gleich gewichtet). 0 = so ängstlich wie fast nie, 100 = so sorglos wie fast nie.">
        Angst &amp; Gier
      </div>
      <div className="stim-big" style={{ color: rankColor(t.value) }}>{rankText(t.value)}</div>
      <div className="stim-word">{t.word}</div>
      <ScaleBar
        now={t.value}
        marks={[{ v: t.w1, label: "1W" }, { v: t.m1, label: "1M" }, ...(wide ? [{ v: t.y1, label: "1J" }] : [])]}
        span={wide ? [t.low12, t.high12] : undefined}
      />
      <div className="stim-axis">
        <span>0 Angst</span>
        {wide && <span>▭ Spanne 12 M</span>}
        <span>Gier 100</span>
      </div>
      <div className="stim-sentence">
        {t.sentence}
        {t.nTotal ? ` · aus ${t.n === t.nTotal ? t.nTotal : `${t.n} von ${t.nTotal}`} Bausteinen` : ""}
      </div>
      <div className={`stim-badge ${d.backtest.state}`} title={d.backtest.text}>
        {BACKTEST_WORD[d.backtest.state]}
      </div>
    </div>
  );
}

// --- Diagramme (nur groß) -----------------------------------------------------------------------

function historyOption(d: SentimentResult, from: number): EOption {
  const dates = d.dates.slice(from);
  const total = d.totalSeries.slice(from);
  const index = d.indexSeries.slice(from);
  return {
    animation: false,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: (ps: { axisValue: string; seriesName: string; value: number | null }[]) => {
        const p = Array.isArray(ps) ? ps : [ps];
        return [fmtDate(p[0]?.axisValue), ...p.map((x) => {
          const v = x.seriesName === "Gesamtwert" ? (x as unknown as { data?: { raw?: number | null } }).data?.raw : x.value;
          return `${x.seriesName}: ${isNum(v) ? fmt(v, x.seriesName === "Gesamtwert" ? 0 : 2) : DASH}`;
        })].join("<br/>");
      },
    },
    grid: [
      { left: 52, right: 12, top: 4, height: 18 },
      { left: 52, right: 12, top: 30, bottom: 22 },
    ],
    xAxis: [
      { type: "category", data: dates, gridIndex: 0, show: false },
      { type: "category", data: dates, gridIndex: 1, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: string) => v.slice(0, 7), hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, min: 0, max: 1, show: false },
      { type: "value", gridIndex: 1, scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 0) } },
    ],
    series: [
      {
        name: "Gesamtwert",
        type: "bar",
        xAxisIndex: 0,
        yAxisIndex: 0,
        barCategoryGap: 0,
        large: false,
        data: total.map((v) => ({ value: isNum(v) ? 1 : 0, raw: v, itemStyle: { color: rankColor(v) } })),
        tooltip: { valueFormatter: () => "" },
      },
      { name: d.indexLabel, type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: index, lineStyle: { width: 1.3, color: "#d8d8d8" }, itemStyle: { color: "#d8d8d8" } },
    ],
  };
}

function breadthOption(d: SentimentResult, key: BreadthKey, days: number): EOption {
  const n = d.dates.length;
  const k = d.breadth[key]?.length ?? 0;
  const take = Math.min(days, k);
  const dates = d.dates.slice(n - take);
  const values = d.breadth[key].slice(k - take);
  const index = d.indexSeries.slice(n - take);
  const tab = BREADTH_TABS.find((t) => t.value === key)!;
  const areas = key === "adl" ? divergences(index, values).map(([a, b]) => [{ xAxis: dates[a] }, { xAxis: dates[b] }]) : [];
  const ref = key === "trin" ? 1 : key === "nhnl" ? 0 : key === "pct200" || key === "trust" || key === "breadthVol" ? 50 : null;
  return {
    animation: false,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => (isNum(v) ? fmt(v, key === "trin" ? 2 : 1) : DASH) },
    grid: [
      { left: 52, right: 12, top: 8, height: "52%" },
      { left: 52, right: 12, top: "66%", bottom: 22 },
    ],
    xAxis: [
      { type: "category", data: dates, gridIndex: 0, ...AXIS, axisLabel: { show: false } },
      { type: "category", data: dates, gridIndex: 1, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: string) => v.slice(0, 7), hideOverlap: true } },
    ],
    yAxis: [
      { type: "value", gridIndex: 0, scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, key === "trin" ? 1 : 0) } },
      { type: "value", gridIndex: 1, scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 0) } },
    ],
    series: [
      {
        name: tab.label,
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        showSymbol: false,
        data: values,
        lineStyle: { width: 1.3, color: "#ffa028" },
        itemStyle: { color: "#ffa028" },
        markLine: ref === null ? undefined : { silent: true, symbol: "none", lineStyle: { color: "#444", type: "dashed" }, label: { show: false }, data: [{ yAxis: ref }] },
        markArea: areas.length
          ? { silent: true, itemStyle: { color: "rgba(255,160,40,0.08)" }, label: { show: false }, data: areas }
          : undefined,
      },
      { name: d.indexLabel, type: "line", xAxisIndex: 1, yAxisIndex: 1, showSymbol: false, data: index, lineStyle: { width: 1.2, color: "#d8d8d8" }, itemStyle: { color: "#d8d8d8" } },
    ],
  };
}

function Decomposition({ d }: { d: SentimentResult }) {
  const comps = d.components.filter((c) => c.inTotal && c.available && isNum(c.rank));
  const n = comps.length || 1;
  return (
    <div className="stim-decomp">
      <div className="section-title" title="Wie sich der Gesamtwert zusammensetzt: jeder Baustein trägt seinen Rang geteilt durch die Zahl der Bausteine bei. Strich = Wert vor einem Monat.">
        Zerlegung · Strich vom Wert vor 1 Monat
      </div>
      <table className="t stim-decomp-t" data-export-title={`Zerlegung des Gesamtwerts ${d.label}`}>
        <thead>
          <tr>
            <th>Baustein</th>
            <th data-csv="Rang">Rang</th>
            <th className="num" title={`Beitrag = Rang ÷ ${n}`}>Beitrag</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => {
            const m1 = c.ranks.length > 21 ? c.ranks[c.ranks.length - 22] : null;
            const lo = isNum(m1) && isNum(c.rank) ? Math.min(m1, c.rank) : null;
            const hi = isNum(m1) && isNum(c.rank) ? Math.max(m1, c.rank) : null;
            return (
              <tr key={c.key}>
                <td>{label(c)}</td>
                <td data-csv={isNum(c.rank) ? fmt(c.rank, 0) : ""}>
                  <div className="stim-rank" title={`Rang ${rankText(c.rank)}${isNum(m1) ? ` · vor einem Monat ${fmt(m1, 0)}` : ""}`}>
                    <span className="stim-rank-mid" />
                    {isNum(lo) && isNum(hi) && <span className="stim-trail" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
                    {isNum(c.rank) && <span className="stim-dot" style={{ left: `${c.rank}%`, background: rankColor(c.rank) }} />}
                  </div>
                </td>
                <td className="num">{isNum(c.rank) ? fmt(c.rank / n, 1) : DASH}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="notes">
        Gleich gewichtet: jeder der {n} Bausteine trägt 1/{n} bei. Summe = Mittel der Bausteine {rankText(d.total.mean)}. Weil sich ein Mittel um 50 ballt,
        wird es selbst noch mit allen früheren Tagen verglichen – daraus der Gesamtwert {rankText(d.total.value)}. ≈ = Näherung (berechnet, nicht die offizielle Zahl).
        {d.region === "eu" ? " VIX, Put/Call und Risikoaufschlag gibt es nur für die USA – sie fehlen hier, statt durch Ähnliches ersetzt zu werden." : ""}
      </div>
    </div>
  );
}

function Tiles({ d }: { d: SentimentResult }) {
  const rows = [...d.components, ...(d.trend ? [d.trend] : [])];
  return (
    <div className="stim-tiles">
      {rows.map((c) => {
        const vals = c.values.slice(-252).filter(isNum);
        return (
          <div key={c.key} className={`stim-tile${c.available ? "" : " off"}`} title={c.explain}>
            <div className="stim-tile-head">{label(c)}</div>
            <div className="stim-tile-value">{c.available ? compValue(c, c.value) : DASH}</div>
            <div className="stim-tile-sub">
              {!c.available
                ? c.note
                : c.key === "trend"
                  ? "zählt nicht mit"
                  : `Rang ${rankText(c.rank)}${c.approx ? " · Näherung" : ""}${c.note?.startsWith("sammelt") ? ` · ${c.note}` : ""}`}
            </div>
            {c.available && vals.length > 1 && <Spark data={vals} width={150} height={22} color={rankColor(c.rank)} />}
          </div>
        );
      })}
    </div>
  );
}

function Heatmap({ d }: { d: SentimentResult }) {
  const h = d.heatmap;
  if (!h.rows.length) return null;
  return (
    <div className="stim-heat-wrap">
      <div className="section-title" title="Anteil der Firmen des Sektors über ihrem 200-Tage-Schnitt, letzter Handelstag jeder Woche. Gleiche Farbskala wie oben: blau = wenige, magenta = fast alle.">
        Marktbreite je Sektor · Anteil über 200-Tage-Linie, letzte {h.weeks.length} Wochen
      </div>
      <table className="stim-heat" data-export-title={`Marktbreite je Sektor ${d.label} (Anteil über 200-Tage-Linie, %)`}>
        <thead>
          <tr>
            <th>Sektor</th>
            {h.weeks.map((w) => (
              <th key={w} data-csv={w} />
            ))}
          </tr>
        </thead>
        <tbody>
          {h.rows.map((r) => (
            <tr key={r.sector}>
              <td title={`${r.n} Firmen`}>{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} data-csv={isNum(v) ? fmt(v, 0) : ""} style={{ background: isNum(v) ? rankColor(v) : "#161616" }} title={`${r.label}, Woche bis ${fmtDate(h.weeks[i])}: ${isNum(v) ? `${fmt(v, 0)} % über der 200-Tage-Linie` : "zu wenig Firmen"}`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stim-heat-axis">
        <span>vor {h.weeks.length} Wochen</span>
        <span>diese Woche</span>
      </div>
    </div>
  );
}

function Backtest({ d }: { d: SentimentResult }) {
  const bt = d.backtest;
  if (!bt.rows.length) return <div className="notes">Rückblick: {bt.text}</div>;
  const span = (a: number | null, b: number | null) => (isNum(a) && isNum(b) ? `${pctSigned(a, 0)} … ${pctSigned(b, 0)}` : DASH);
  const r3 = bt.rows.find((r) => r.h === 63);
  return (
    <div>
      <div className="section-title" title="Wie lief der Index früher nach Phasen mit ähnlicher Stimmung? Zusammenhängende Phasen zählen als eine Episode. Daneben zum Vergleich alle Tage.">
        Was folgte früher? · {d.indexLabel} danach, Median
      </div>
      <table className="t stim-bt" data-export-title={`Rückblick ${d.label}: ${d.indexLabel} danach (Median)`}>
        <thead>
          <tr>
            <th>Lage</th>
            {bt.rows.map((r) => (
              <th key={r.h} className="num">{r.label}</th>
            ))}
            <th className="num" title="Anteil der Fälle mit Kursplus nach 3 Monaten">im Plus (3 M)</th>
            <th className="num" title="Mittlere 80 % der Fälle nach 3 Monaten">mittlere 80 % (3 M)</th>
            <th className="num" title="unabhängige Phasen">Episoden</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{bandLabel(bt.band)}</td>
            {bt.rows.map((r) => (
              <td key={r.h} className="num">{pctSigned(r.median)}</td>
            ))}
            <td className="num">{isNum(r3?.plus) ? `${fmt(r3!.plus, 0)} %` : DASH}</td>
            <td className="num">{span(r3?.p10 ?? null, r3?.p90 ?? null)}</td>
            <td className="num">{bt.episodes ?? DASH}</td>
          </tr>
          <tr className="muted">
            <td>Alle Tage</td>
            {bt.rows.map((r) => (
              <td key={r.h} className="num">{pctSigned(r.medianAll)}</td>
            ))}
            <td className="num">{isNum(r3?.plusAll) ? `${fmt(r3!.plusAll, 0)} %` : DASH}</td>
            <td className="num">{span(r3?.p10All ?? null, r3?.p90All ?? null)}</td>
            <td className="num">{DASH}</td>
          </tr>
        </tbody>
      </table>
      <div className="notes">
        {BACKTEST_WORD[bt.state]} – {bt.text} Nur ein Zeitraum (seit {d.since}) und die heutige Firmenauswahl; die Vergangenheit sieht dadurch etwas besser aus, als sie war.
      </div>
    </div>
  );
}

// --- Ansichten ----------------------------------------------------------------------------------

function Quarter({ d }: { d: SentimentResult }) {
  return (
    <div className="stim-q">
      <div className="stim-q-left">
        <TotalBlock d={d} />
      </div>
      <div className="stim-q-right">
        <div className="stim-lage">{d.lage}</div>
        <CompTable d={d} />
      </div>
    </div>
  );
}

function Wide({ d, range, breadth, setBreadth }: { d: SentimentResult; range: RangeKey; breadth: BreadthKey; setBreadth: (b: BreadthKey) => void }) {
  const from = sliceFrom(d.dates, Number(range));
  const hist = useMemo(() => historyOption(d, from), [d, from]);
  const days = Number(range) ? Math.min(504, Math.round(Number(range) * 21)) : 504;
  const bopt = useMemo(() => breadthOption(d, breadth, days), [d, breadth, days]);
  const tab = BREADTH_TABS.find((t) => t.value === breadth)!;
  return (
    <div className="stim-w">
      <div className="stim-w-left">
        <TotalBlock d={d} wide />
        <div className="stim-lage">{d.lage}</div>
        <Decomposition d={d} />
      </div>
      <div className="stim-w-right">
        <div>
          <div className="section-title">
            Verlauf · Stimmung als Farbstreifen, darunter {d.indexLabel}
          </div>
          <div className="stim-chart-hist">
            <EChart option={hist} csv={false} />
          </div>
          <div className="notes">Kräftige Farben zeigen, wann die Stimmung extrem war. Zeitgleich heißt nicht Ursache.</div>
        </div>
        <div>
          <div className="section-title">Marktbreite · letzte {Math.round(Math.min(days, d.breadth.adl.length) / 21)} Monate (höchstens 2 Jahre)</div>
          <div className="toolbar stim-btabs">
            <Seg label="Marktbreite" value={breadth} options={BREADTH_TABS.map((t) => ({ value: t.value, label: t.label }))} onChange={setBreadth} />
          </div>
          <div className="stim-chart-breadth">
            <EChart option={bopt} csv={false} />
          </div>
          <div className="notes">
            {tab.title}. Darunter der Index auf derselben Zeitachse.
            {breadth === "adl" ? " Markiert: Strecken, in denen der Index über 20 Tage stieg, die Mehrheit der Firmen aber nicht mitging." : ""}
            {breadth === "trin" ? " TRIN schwankt stark von Tag zu Tag und zählt deshalb nicht zum Gesamtwert." : ""}
            {breadth === "adl" || breadth === "breadthVol" || breadth === "trin" ? " Nur zur Ansicht, nicht im Gesamtwert." : ""}
          </div>
        </div>
        <Tiles d={d} />
        <Heatmap d={d} />
        <Backtest d={d} />
      </div>
    </div>
  );
}

export function STIM(_: ScreenProps) {
  const [region, setRegion] = usePersistentState<SentRegion>("stim.region", "us", isOneOf(["us", "eu"] as const));
  const [range, setRange] = usePersistentState<RangeKey>("stim.range", "60", isOneOf(RANGES.map((r) => r.value)));
  const [breadth, setBreadth] = usePersistentState<BreadthKey>("stim.breadth", "adl", isOneOf(BREADTH_TABS.map((t) => t.value)));
  const [ref, size] = useSize<HTMLDivElement>();
  const q = useSentiment(region);
  const d = q.data;
  const wide = size.w >= MAX_W && size.h >= MAX_H;

  useCsvExport(() => {
    if (!d || d.state !== "ready") return [];
    const k = d.breadth.adl.length;
    const bd = d.dates.slice(d.dates.length - k);
    const comps = d.components.filter((c) => c.available);
    return [
      { title: `Stimmung ${d.label} – Gesamtwert und Index je Tag`, columns: ["Datum", "Gesamtwert (0 Angst – 100 Gier)", d.indexLabel], rows: d.dates.map((t, i) => [t, d.totalSeries[i], d.indexSeries[i]]) },
      { title: `Stimmung ${d.label} – Rang je Baustein (letzte ${k} Tage)`, columns: ["Datum", ...comps.map((c) => c.label + (c.approx ? " ≈" : ""))], rows: bd.map((t, i) => [t, ...comps.map((c) => c.ranks[c.ranks.length - k + i] ?? null)]) },
      { title: `Stimmung ${d.label} – Werte je Baustein (letzte ${k} Tage)`, columns: ["Datum", ...comps.map((c) => c.label + (c.approx ? " ≈" : ""))], rows: bd.map((t, i) => [t, ...comps.map((c) => c.values[c.values.length - k + i] ?? null)]) },
      { title: `Marktbreite ${d.label} je Tag`, columns: ["Datum", ...BREADTH_TABS.map((t) => t.label)], rows: bd.map((t, i) => [t, ...BREADTH_TABS.map((b) => d.breadth[b.value][i] ?? null)]) },
    ];
  });

  if (IS_STATIC) return <Empty>Das Stimmungsterminal braucht den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;

  return (
    <div className="panel-body flush stim" ref={ref}>
      <div className="toolbar">
        <Seg label="Region" value={region} options={REGIONS} onChange={setRegion} />
        {wide && <Seg label="Zeitraum" value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />}
        <span className="spacer" />
        {d && d.state === "ready" && (
          <span className="muted stim-meta" title={`Firmen aus dem Bewertungstrend (BWT), Region ${d.label}; Vergleich mit allen Tagen seit ${d.since}`}>
            Stand {fmtDate(d.asOf)} · {d.firms} Firmen
          </span>
        )}
      </div>
      {q.isPending ? (
        <Loading rows={10} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? null : d.state === "building" ? (
        <div className="stim-building">
          <Loading rows={4} />
          <div className="notes">{d.message ?? "Wird berechnet …"}</div>
        </div>
      ) : (
        <div className="stim-body">
          {wide ? <Wide d={d} range={range} breadth={breadth} setBreadth={setBreadth} /> : <Quarter d={d} />}
          <div className="notes stim-foot" title={d.note}>
            {wide
              ? `${DISCLAIMER} ${d.note} Eigene Berechnung aus den Firmen des Bewertungstrends (BWT); Stand täglich nach Börsenschluss.`
              : `${DISCLAIMER} ≈ = Näherung. Diagramme, Marktbreite, Sektoren und Rückblick: Panel maximieren (Alt+M).`}
          </div>
        </div>
      )}
    </div>
  );
}
