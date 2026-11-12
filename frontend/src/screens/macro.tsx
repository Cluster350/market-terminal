// Makro-Funktionen: WEI, FX, CMDT, GC, SPRD, ECO, ECST

import { useEffect, useMemo, useRef, useState } from "react";
import { CURVE_COUNTRIES, ISO3, useIntent } from "../lib/intents";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Change, Empty, Flash, Q, Seg, Spark, Table, useNow } from "../components/ui";
import { DASH, fmt, fmtBig, fmtBp, fmtDate, fmtInt, fmtPct, fmtPrice, fmtStamp, fmtTime, fmtWeekday, isNum, priceDigits, shiftMonths, tone } from "../lib/format";
import { isOneOf, isStringList, usePersistentState } from "../lib/persist";
import { useCalendar, useCommodities, useCountries, useCurves, useFx, useIndices, useSpreads, useStatus } from "../lib/queries";
import type { EconEvent, MarketRow } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import { FeaturePicker, ForecastPanel } from "../components/ForecastPanel";
import { useCsvExport } from "../lib/exporter";
import { IS_STATIC } from "../lib/api";
import { cleanFeatures, digitsFor, fcTime, fmtVal, isFeatureList, useEventForecast, useMacroForecast, type ForecastResult } from "../lib/forecast";
import type { ScreenProps } from "./types";

function MarketTable({ rows, grouped, digits }: { rows: MarketRow[]; grouped?: boolean; digits?: number }) {
  const ws = useWorkspace();
  return (
    <Table
      rows={rows}
      rowKey={(r) => r.ticker}
      onRowClick={(r) => ws.setSecurity(r.ticker, { open: "GP", stay: true })}
      groupBy={grouped ? (r) => r.region || "Weitere" : undefined}
      columns={[
        { key: "name", label: "Name", sort: (r) => r.name, render: (r) => <span title={r.ticker}>{r.name}</span> },
        {
          key: "last",
          label: "Kurs",
          num: true,
          render: (r) => (
            <Flash value={r.last}>
              <b>{isNum(digits) ? fmt(r.last, digits) : fmtPrice(r.last, r.ticker)}</b>
            </Flash>
          ),
        },
        { key: "chg", label: "Veränd.", num: true, sort: (r) => r.change, render: (r) => <Change value={r.change} pct={false} digits={r.ticker.endsWith(".FOREX") && isNum(r.last) ? priceDigits(r.last, r.ticker) : 2} /> },
        { key: "chgp", label: "%", num: true, sort: (r) => r.changePct, render: (r) => <Change value={r.changePct} arrowSign /> },
        { key: "w", label: "1W %", num: true, sort: (r) => r.chg1w, render: (r) => <Change value={r.chg1w} />, className: "col-opt2" },
        { key: "m", label: "1M %", num: true, sort: (r) => r.chg1m, render: (r) => <Change value={r.chg1m} /> },
        { key: "ytd", label: "YTD %", num: true, sort: (r) => r.chgYtd, render: (r) => <Change value={r.chgYtd} /> },
        { key: "spark", label: "30 Tage", num: true, render: (r) => <Spark data={r.spark} />, className: "col-opt1" },
        { key: "time", label: "Stand", num: true, render: (r) => <span className="muted" title={r.asOf ?? undefined}>{fmtStamp(r.asOf)}</span>, className: "col-opt1" },
      ]}
    />
  );
}

export function WEI(_: ScreenProps) {
  const q = useIndices();
  return (
    <div className="panel-body">
      <Q q={q}>{(rows) => <MarketTable rows={rows} grouped />}</Q>
    </div>
  );
}

export function CMDT(_: ScreenProps) {
  const q = useCommodities();
  const status = useStatus();
  return (
    <div className="panel-body">
      <Q q={q}>
        {(rows) => (
          <>
            <MarketTable rows={rows} />
            <div className="notes">
              {status.data?.mode === "eodhd" ? "Rohstoffe über börsengehandelte Fonds (ETFs) als Stellvertreter." : "Synthetische Demo-Preise."}
            </div>
          </>
        )}
      </Q>
    </div>
  );
}

const CCY = ["USD", "EUR", "JPY", "GBP", "CHF", "AUD", "CAD", "NZD", "CNH"];

/** Tagesveränderung jeder Währung gegen USD aus den Paaren ableiten. */
function strength(rows: MarketRow[]): { ccy: string; chg: number }[] {
  const vsUsd = new Map<string, number>([["USD", 0]]);
  for (const r of rows) {
    const pair = r.ticker.split(".")[0];
    if (!/^[A-Z]{6}$/.test(pair) || !isNum(r.changePct)) continue;
    const base = pair.slice(0, 3);
    const quote = pair.slice(3);
    if (quote === "USD") vsUsd.set(base, r.changePct);
    else if (base === "USD") vsUsd.set(quote, -r.changePct);
  }
  return CCY.filter((c) => vsUsd.has(c))
    .map((c) => {
      const own = vsUsd.get(c)!;
      const others = CCY.filter((o) => o !== c && vsUsd.has(o)).map((o) => own - vsUsd.get(o)!);
      return { ccy: c, chg: others.reduce((a, b) => a + b, 0) / Math.max(others.length, 1) };
    })
    .sort((a, b) => b.chg - a.chg);
}

export function FX(_: ScreenProps) {
  const q = useFx();
  return (
    <div className="panel-body">
      <Q q={q}>
        {(rows) => {
          const s = strength(rows);
          const max = Math.max(0.01, ...s.map((x) => Math.abs(x.chg)));
          return (
            <>
              <MarketTable rows={rows} />
              {s.length > 2 && (
                <div style={{ padding: "6px 10px 10px" }}>
                  <div className="section-title">Währungsstärke heute (Ø gegen alle anderen)</div>
                  {s.map((x) => (
                    <div key={x.ccy} style={{ display: "grid", gridTemplateColumns: "4ch minmax(0,1fr) minmax(0,1fr) 8ch", gap: 6, alignItems: "center", padding: "1px 0" }}>
                      <span className="lbl">{x.ccy}</span>
                      <div className="bar-bg" style={{ background: "transparent" }}>
                        {x.chg < 0 && <div className="bar-fill" style={{ right: 0, width: `${(Math.abs(x.chg) / max) * 100}%`, background: "var(--down)" }} />}
                      </div>
                      <div className="bar-bg" style={{ background: "transparent" }}>
                        {x.chg > 0 && <div className="bar-fill" style={{ left: 0, width: `${(x.chg / max) * 100}%`, background: "var(--up)" }} />}
                      </div>
                      <span className={`num ${tone(x.chg)}`}>{fmtPct(x.chg)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        }}
      </Q>
    </div>
  );
}

const CURVE_COLORS: Record<string, string> = { US: "#ffa028", DE: "#66b8ff", UK: "#c77dff", FR: "#29d17d", IT: "#ff8a65", JP: "#f2c200" };

export function GC(_: ScreenProps) {
  const status = useStatus();
  const available = status.data?.defaults.curveCountries ?? ["US", "DE", "UK", "FR", "IT", "JP"];
  // Auswahl bleibt über Seitenwechsel und Neuladen erhalten
  const [countries, setCountries] = usePersistentState<string[]>("gc.countries", ["US", "DE"], isStringList(["US", "DE", "UK", "FR", "IT", "JP"], 6));
  // „IT GC“ oder Klick in der Weltkarte: Land vorne einreihen
  useIntent("GC", (v) => {
    const c = v.country;
    if (c && (CURVE_COUNTRIES as readonly string[]).includes(c)) setCountries((x) => [c, ...x.filter((y) => y !== c)].slice(0, 6));
  });
  const [compare, setCompare] = usePersistentState<"none" | "1m" | "1y">("gc.compare", "1y", isOneOf(["none", "1m", "1y"] as const));
  const q = useCurves(countries);

  const option = useMemo<EOption | null>(() => {
    if (!q.data) return null;
    const tenors = q.data[0]?.points.map((p) => p.tenor) ?? [];
    const series: unknown[] = [];
    for (const c of q.data) {
      const color = CURVE_COLORS[c.country] || "#ececec";
      series.push({ name: `${c.country} heute`, type: "line", data: c.points.map((p) => p.y), lineStyle: { color, width: 2 }, itemStyle: { color }, symbolSize: 6, connectNulls: true });
      if (compare !== "none") {
        series.push({
          name: `${c.country} ${compare === "1m" ? "vor 1M" : "vor 1J"}`,
          type: "line",
          data: c.points.map((p) => (compare === "1m" ? p.y1m : p.y1y)),
          lineStyle: { color, width: 1, type: "dashed", opacity: 0.7 },
          itemStyle: { color, opacity: 0.7 },
          symbolSize: 4,
          connectNulls: true,
        });
      }
    }
    return {
      grid: { left: 46, right: 16, top: 30, bottom: 26 },
      legend: { top: 4, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6 },
      tooltip: { trigger: "axis", ...TOOLTIP, valueFormatter: (v: number) => (isNum(v) ? `${v.toFixed(3).replace(".", ",")} %` : DASH) },
      xAxis: { type: "category", data: tenors.map((t) => t.replace("Y", "J")), boundaryGap: false, ...AXIS },
      yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${v.toFixed(1).replace(".", ",")} %` } },
      series,
    };
  }, [q.data, compare]);

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Länder">
          {available.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={countries.includes(c)}
              onClick={() => setCountries((x) => (x.includes(c) ? (x.length > 1 ? x.filter((y) => y !== c) : x) : [...x, c]))}
              style={countries.includes(c) ? { color: CURVE_COLORS[c] } : undefined}
            >
              {c}
            </button>
          ))}
        </div>
        <Seg
          label="Vergleich"
          value={compare}
          options={[
            { value: "none", label: "Nur heute" },
            { value: "1m", label: "vs. −1M" },
            { value: "1y", label: "vs. −1J" },
          ]}
          onChange={setCompare}
        />
      </div>
      <div className="panel-body flush">
        <Q q={q}>
          {(curves) => (
            <div className="gc-body">
              <div className="gc-chart">{option && <EChart option={option} csv="Zinskurven (Rendite in %)" />}</div>
              <div className="gc-table">
                <table className="t" data-export-title="Renditen je Laufzeit">
                  <thead>
                    <tr>
                      <th>Laufzeit</th>
                      {curves.map((c) => (
                        <th key={c.country} className="num" title={`Stand ${fmtDate(c.asOf)}`}>
                          <span style={{ color: CURVE_COLORS[c.country] }}>■</span> {c.name} %
                          {compare !== "none" && <span className="dim"> · Δ {compare === "1m" ? "1M" : "1J"}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Steilheit zuerst: bleibt bei kleiner Panelhöhe ohne Scrollen sichtbar */}
                    <tr className="em">
                      <td title="10 Jahre minus 2 Jahre">2s10s</td>
                      {curves.map((c) => {
                        const y2 = c.points.find((p) => p.tenor === "2Y")?.y;
                        const y10 = c.points.find((p) => p.tenor === "10Y")?.y;
                        const v = isNum(y10) && isNum(y2) ? y10 - y2 : null;
                        return (
                          <td key={c.country} className={`num ${tone(v)}`}>
                            {v === null ? DASH : fmtBp(v)}
                          </td>
                        );
                      })}
                    </tr>
                    {(curves[0]?.points ?? []).map((pt, i) => (
                      <tr key={pt.tenor}>
                        <td className="lbl">{pt.tenor.replace("Y", "J")}</td>
                        {curves.map((c) => {
                          const p = c.points[i];
                          const ref = compare === "1m" ? p?.y1m : p?.y1y;
                          const d = p && isNum(p.y) && isNum(ref) ? p.y - ref : null;
                          return (
                            <td key={c.country} className="num">
                              {p && isNum(p.y) ? fmt(p.y, 3) : DASH}
                              {/* steigende Rendite = fallende Anleihekurse: rot, wie in WMAP */}
                              {compare !== "none" && <span className={`xs ${tone(d === null ? null : -d)}`} style={{ display: "inline-block", minWidth: "7ch" }}> {d === null ? "" : fmtBp(d)}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Q>
      </div>
    </>
  );
}

/** Überraschung als gut/schlecht: Bei Arbeitslosigkeit und Erstanträgen ist "weniger" gut. */
function surpriseSign(e: EconEvent): number | null {
  if (!isNum(e.surprise)) return null;
  return /Unemployment|Jobless|Claims/i.test(e.event) ? -e.surprise : e.surprise;
}

const SPREAD_COLORS = ["#ffa028", "#66b8ff", "#c77dff", "#29d17d"];

const SPRD_RANGES = [
  { value: "3", label: "3M" },
  { value: "6", label: "6M" },
  { value: "12", label: "1J" },
  { value: "24", label: "2J" },
] as const;

export function SPRD(_: ScreenProps) {
  const q = useSpreads();
  const [months, setMonths] = usePersistentState<string>("sprd.months", "24", isOneOf(SPRD_RANGES.map((r) => r.value)));
  // CSV: Tageswerte aller Spreads im gewählten Zeitraum, eine Spalte je Spread
  useCsvExport(() => {
    if (!q.data?.length) return [];
    const all = Array.from(new Set(q.data.flatMap((s) => s.t))).sort();
    const from = all.length ? shiftMonths(all[all.length - 1], Number(months)) : "";
    const maps = q.data.map((s) => new Map(s.t.map((t, j) => [t, s.v[j]])));
    return [
      {
        title: "Renditeabstände",
        columns: ["Datum", ...q.data.map((s) => `${s.label} [bp]`)],
        rows: all.filter((d) => d > from).map((d) => [d, ...maps.map((m) => m.get(d) ?? null)]),
      },
    ];
  });
  const option = useMemo<EOption | null>(() => {
    if (!q.data?.length) return null;
    const all = Array.from(new Set(q.data.flatMap((s) => s.t))).sort();
    const from = all.length ? shiftMonths(all[all.length - 1], Number(months)) : "";
    const dates = all.filter((d) => d > from);
    return {
      grid: { left: 52, right: 16, top: 30, bottom: 50 },
      legend: { top: 4, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6 },
      tooltip: { trigger: "axis", ...TOOLTIP, valueFormatter: (v: number) => (isNum(v) ? `${Math.round(v)} bp` : DASH) },
      // Tagesdatum statt "MM.JJJJ": sonst standen zwei gleiche Monatslabels nebeneinander
      xAxis: { type: "category", data: dates, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: string) => `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(2, 4)}` } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${fmt(v, Number.isInteger(v) ? 0 : 1)} bp` } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: "#262626", textStyle: { color: "#8f8f8f" }, fillerColor: "rgba(255,160,40,0.12)" }],
      series: q.data.map((s, i) => {
        const m = new Map(s.t.map((t, j) => [t, s.v[j]]));
        return {
          name: s.label,
          type: "line",
          showSymbol: false,
          connectNulls: true, // Feiertage eines Landes unterbrechen die Linie nicht
          data: dates.map((d) => m.get(d) ?? null),
          lineStyle: { width: 1.5, color: SPREAD_COLORS[i % 4] },
          itemStyle: { color: SPREAD_COLORS[i % 4] },
          markLine: i === 0 ? { silent: true, symbol: "none", lineStyle: { color: "#555", type: "dashed" }, data: [{ yAxis: 0 }], label: { show: false } } : undefined,
        };
      }),
    };
  }, [q.data, months]);
  return (
    <div className="panel-body flush">
      <div className="toolbar">
        <Seg label="Zeitraum" value={months} options={SPRD_RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setMonths} />
      </div>
      <Q q={q}>
        {(series) =>
          !series.length ? (
            <Empty>Keine Spread-Daten (Anleihen im Plan enthalten?).</Empty>
          ) : (
            <>
              <div style={{ display: "flex", gap: 18, padding: "6px 10px", flexWrap: "wrap", borderBottom: "1px solid var(--rule)" }}>
                {series.map((s, i) => {
                  // Δ 1M wie in GC: letzter Wert am oder vor demselben Kalendertag des Vormonats
                  // (vorher 21 Beobachtungen zurück, mit anderem Ergebnis als GC)
                  const pts = s.t.map((t, j) => [t, s.v[j]] as const).filter((p): p is readonly [string, number] => isNum(p[1]));
                  const lastPt = pts[pts.length - 1];
                  const last = lastPt?.[1];
                  const cut = lastPt ? shiftMonths(lastPt[0], 1) : "";
                  const prev = [...pts].reverse().find((p) => p[0] <= cut)?.[1];
                  return (
                    <div key={s.key}>
                      <div className="xs" style={{ color: SPREAD_COLORS[i % 4] }}>{s.label}</div>
                      <div style={{ fontSize: "var(--fs-l)" }}>
                        {isNum(last) ? `${Math.round(last)} bp` : DASH}{" "}
                        <span className={`small ${tone(isNum(last) && isNum(prev) ? last - prev : null)}`}>
                          {isNum(last) && isNum(prev) ? `${fmtBp(last - prev, false)} (1M)` : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ flex: 1, minHeight: 160 }}>{option && <EChart option={option} csv={false} />}</div>
            </>
          )
        }
      </Q>
    </div>
  );
}

const COUNTRY_NAMES: Record<string, string> = {
  US: "USA", DE: "Deutschland", EU: "Eurozone", EA: "Eurozone", GB: "Großbritannien", UK: "Großbritannien",
  JP: "Japan", CN: "China", FR: "Frankreich", IT: "Italien", CA: "Kanada", AU: "Australien", CH: "Schweiz",
};

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekRange(offsetWeeks: number): { from: string; to: string } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

function fmtEvent(v: number | null, unit: string | null): string {
  if (!isNum(v)) return DASH;
  const digits = Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 1 : 2;
  return `${fmt(v, digits)}${unit === "%" ? " %" : unit ? ` ${unit}` : ""}`;
}

export function ECO(_: ScreenProps) {
  // Am Wochenende ist die laufende Woche vorbei: dann die kommende zeigen
  const [week, setWeek] = useState<"prev" | "this" | "next">(() => ([0, 6].includes(new Date().getDay()) ? "next" : "this"));
  const [country, setCountry] = usePersistentState<string>("eco.country", "", (x): x is string => typeof x === "string" && x.length <= 3);
  useIntent("ECO", (v) => {
    if (v.country) setCountry(v.country === "UK" ? "GB" : v.country);
  });
  const [importance, setImportance] = usePersistentState<"1" | "2" | "3">("eco.importance", "1", isOneOf(["1", "2", "3"] as const));
  const range = weekRange(week === "prev" ? -1 : week === "next" ? 1 : 0);
  const q = useCalendar({ ...range, country: country || undefined, importance: Number(importance) });
  const now = useNow(30_000);
  const nextId = useMemo(() => q.data?.find((e) => new Date(e.date).getTime() > now)?.id ?? null, [q.data, now]);
  const countries = useMemo(() => Array.from(new Set((q.data ?? []).map((e) => e.country))).sort(), [q.data]);
  // Ausgewählter Termin: frühere Veröffentlichungen mit Prognose und Vergleich zum Konsens
  const [sel, setSel] = useState<{ country: string; event: string; date: string } | null>(null);
  // Einflussgrößen der Prognose (andere Termine, Kennzahlen, Kursreihen) – gelten für alle Termine, bis man sie ändert
  const [fx, setFx] = usePersistentState<string[]>("eco.fcx", [], isFeatureList);
  const fc = useEventForecast(sel?.country ?? null, sel?.event ?? null, 3, cleanFeatures(fx));

  return (
    <>
      <div className="toolbar">
        <Seg
          label="Woche"
          value={week}
          options={[
            { value: "prev", label: "Vorwoche" },
            { value: "this", label: "Diese Woche" },
            { value: "next", label: "Nächste" },
          ]}
          onChange={setWeek}
        />
        <select className="field" aria-label="Land" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Alle Länder</option>
          {Array.from(new Set([...countries, "US", "DE", "EU", "GB", "JP", "CN"])).sort().map((c) => (
            <option key={c} value={c}>
              {COUNTRY_NAMES[c] || c}
            </option>
          ))}
        </select>
        <Seg
          label="Wichtigkeit"
          value={importance}
          options={[
            { value: "1", label: "Alle" },
            { value: "2", label: "●● +" },
            { value: "3", label: "●●●" },
          ]}
          onChange={setImportance}
        />
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {fmtDate(range.from)} – {fmtDate(range.to)} · Zeiten lokal
        </span>
      </div>
      <div className="panel-body flush">
        <div style={{ overflow: "auto", flex: "1 1 auto", minHeight: 0 }}>
          <Q q={q}>
            {(events) =>
              !events.length ? (
                <Empty>Keine Termine für diese Auswahl.</Empty>
              ) : (
                <table className="t">
                  <thead>
                    <tr>
                      <th>Zeit</th>
                      <th>Land</th>
                      <th>Ereignis</th>
                      <th title="Wichtigkeit">Wicht.</th>
                      <th className="num">Ist</th>
                      <th className="num">Prognose</th>
                      <th className="num">Vorwert</th>
                      <th className="num" title="Ist minus Prognose">Überr.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e: EconEvent, i: number) => {
                      const day = fmtWeekday(e.date);
                      const header = i === 0 || fmtWeekday(events[i - 1].date) !== day;
                      const past = new Date(e.date).getTime() <= now;
                      return (
                        <FragmentWithHeader key={e.id} header={header ? day : null}>
                          <tr
                            className={`${IS_STATIC ? "" : "clickable"} ${e.id === nextId || (sel && sel.event === e.event && sel.country === e.country) ? "selected" : ""}`}
                            style={{ opacity: !past || isNum(e.actual) ? 1 : 0.75 }}
                            title={IS_STATIC ? undefined : "Frühere Veröffentlichungen mit Prognose zeigen"}
                            onClick={() => !IS_STATIC && setSel(sel && sel.event === e.event && sel.country === e.country ? null : { country: e.country, event: e.event, date: e.date })}
                          >
                            <td className={e.id === nextId ? "lbl" : "muted"}>{fmtTime(e.date)}</td>
                            <td title={COUNTRY_NAMES[e.country] || e.country}>{e.country}</td>
                            <td className="wrap" style={{ whiteSpace: "normal" }}>
                              {e.event}
                              {e.period && <span className="muted xs"> · {e.period}</span>}
                            </td>
                            <td>
                              <span className="imp" aria-label={`Wichtigkeit ${e.importance} von 3`}>
                                {[1, 2, 3].map((k) => (
                                  <i key={k} className={k <= e.importance ? "on" : ""} />
                                ))}
                              </span>
                            </td>
                            <td className={`num ${tone(surpriseSign(e))}`} style={{ fontWeight: 600 }}>
                              {fmtEvent(e.actual, e.unit)}
                            </td>
                            <td className="num">{fmtEvent(e.estimate, e.unit)}</td>
                            <td className="num muted">{fmtEvent(e.previous, e.unit)}</td>
                            <td className={`num ${tone(surpriseSign(e))}`}>{isNum(e.surprise) ? `${e.surprise > 0 ? "+" : ""}${fmtEvent(e.surprise, e.unit === "%" ? "Pp" : e.unit)}` : DASH}</td>
                          </tr>
                        </FragmentWithHeader>
                      );
                    })}
                  </tbody>
                </table>
              )
            }
          </Q>
        </div>
        {sel && !IS_STATIC && (
          <div className="eco-fc">
            <button type="button" className="tool eco-fc-close" aria-label="Prognose schließen" onClick={() => setSel(null)}>
              ×
            </button>
            <FeaturePicker kind="event" country={sel.country} value={cleanFeatures(fx)} onChange={setFx} />
            <ForecastPanel q={fc} maxHist={30}>{(r) => <ConsensusCompare r={r} />}</ForecastPanel>
          </div>
        )}
      </div>
    </>
  );
}

/** Nächste Veröffentlichung: Modell gegen Konsens, und wer bisher näher lag. */
function ConsensusCompare({ r }: { r: ForecastResult }) {
  const q = r.quality;
  const d = digitsFor(r);
  return (
    <div className="fc-cmp small">
      <span>
        Nächster Termin {fcTime(r.forecast.t[0], r.freq)}: Modell <b>{fmtVal(r.forecast.median[0], r)}</b>{" "}
        <span className="muted">(80 %: {fmt(r.forecast.lo80[0], d)} – {fmt(r.forecast.hi80[0], d)})</span> · Konsens{" "}
        <b style={{ color: "#6fa8ff" }}>{isNum(r.nextConsensus) ? fmtVal(r.nextConsensus, r) : DASH}</b>
      </span>
      {q.consensusN > 0 && isNum(q.consensusMae) && isNum(q.modelMae1) && (
        <span className="muted">
          Bisher ({q.consensusN} Termine) mittlerer Fehler: Modell {fmt(q.modelMae1, d)} · Konsens {fmt(q.consensusMae, d)}
          {q.consensusMae < q.modelMae1 * 0.95 ? " – der Konsens lag meist näher" : q.modelMae1 < q.consensusMae * 0.95 ? " – das Modell lag meist näher" : " – etwa gleich gut"}
        </span>
      )}
    </div>
  );
}

function FragmentWithHeader({ header, children }: { header: string | null; children: React.ReactNode }) {
  return (
    <>
      {header && (
        <tr className="group">
          <td colSpan={8}>{header}</td>
        </tr>
      )}
      {children}
    </>
  );
}

const ALL_INDICATORS = [
  { key: "gdp_growth_annual", label: "BIP-Wachstum" },
  { key: "inflation_consumer_prices_annual", label: "Inflation" },
  { key: "unemployment_total_percent", label: "Arbeitslosigkeit" },
  { key: "debt_percent_gdp", label: "Schulden/BIP" },
  { key: "real_interest_rate", label: "Realzins" },
  { key: "gdp_per_capita_usd", label: "BIP/Kopf" },
];

export function ECST(_: ScreenProps) {
  const [chosen, setChosen] = useState<string[]>(ALL_INDICATORS.slice(0, 4).map((i) => i.key));
  const [focusRaw, setFocus] = useState<string>("inflation_consumer_prices_annual");
  // Klick in der Weltkarte oder „ECST DE“: Land markieren, Kennzahl auswählen
  const [mark, setMark] = useState<string | null>(null);
  const markRow = useRef<HTMLTableRowElement | null>(null);
  useIntent("ECST", (v) => {
    if (v.country) setMark(v.country.length === 3 ? v.country : ISO3[v.country] ?? v.country);
    const ind = v.indicator;
    if (ind && ALL_INDICATORS.some((i) => i.key === ind)) {
      setChosen((x) => (x.includes(ind) ? x : [...x, ind]));
      setFocus(ind);
    }
  });
  useEffect(() => {
    markRow.current?.scrollIntoView({ block: "nearest" });
  }, [mark]);
  const focus = chosen.includes(focusRaw) ? focusRaw : chosen[0];
  const q = useCountries(chosen);
  // Unterer Bereich: Ländervergleich oder Verlauf mit Prognose für das markierte Land
  const [view, setView] = usePersistentState<"compare" | "forecast">("ecst.view", "compare", isOneOf(["compare", "forecast"] as const));
  const showForecast = view === "forecast" && !IS_STATIC;
  const [fx, setFx] = usePersistentState<string[]>("ecst.fcx", [], isFeatureList);
  const fc = useMacroForecast(showForecast ? mark : null, focus, 3, cleanFeatures(fx));
  // CSV: Kennzahlen je Land mit Jahr der Angabe, dazu der Verlauf je Land und Kennzahl
  useCsvExport(() => {
    const d = q.data;
    if (!d?.rows.length) return [];
    const unit = (i: { unit: string }) => (i.unit ? ` [${i.unit}]` : "");
    const hist: (string | number | null)[][] = [];
    for (const r of d.rows)
      for (const i of d.indicators) for (const h of r.history[i.key] ?? []) if (isNum(h.value)) hist.push([r.name, r.country, i.label, i.unit || null, h.year, h.value]);
    return [
      {
        title: "Länderkennzahlen (letzter Wert)",
        columns: ["Land", "Kürzel", ...d.indicators.flatMap((i) => [`${i.label}${unit(i)}`, `${i.label} (Jahr)`])],
        rows: d.rows.map((r) => [r.name, r.country, ...d.indicators.flatMap((i) => [r.values[i.key]?.value ?? null, r.values[i.key]?.year ?? null])]),
      },
      ...(hist.length ? [{ title: "Verlauf je Land und Kennzahl", columns: ["Land", "Kürzel", "Kennzahl", "Einheit", "Jahr", "Wert"], rows: hist }] : []),
    ];
  });

  const option = useMemo<EOption | null>(() => {
    if (!q.data) return null;
    const rows = q.data.rows
      .map((r) => ({ name: r.name, v: r.values[focus]?.value ?? null }))
      .filter((r) => isNum(r.v))
      .sort((a, b) => (b.v as number) - (a.v as number));
    const ind = q.data.indicators.find((i) => i.key === focus);
    return {
      grid: { left: 110, right: 40, top: 8, bottom: 8 },
      tooltip: { ...TOOLTIP, trigger: "item" },
      xAxis: { type: "value", show: false },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map((r) => r.name),
        ...AXIS,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...AXIS.axisLabel, interval: 0, fontSize: 9 },
      },
      series: [
        {
          type: "bar",
          data: rows.map((r) => ({ value: r.v, itemStyle: { color: (r.v as number) >= 0 ? "#ffa028" : "#ff5252" } })),
          barWidth: "60%",
          label: {
            show: true,
            position: "right",
            color: "#ececec",
            fontSize: 10,
            formatter: (p: { value: number }) =>
              ind?.unit === "USD" ? (focus === "gdp_per_capita_usd" ? fmtInt(p.value) : fmtBig(p.value, 1)) : `${fmt(p.value, 1)} %`,
          },
        },
      ],
    };
  }, [q.data, focus]);

  return (
    <>
      <div className="toolbar">
        {ALL_INDICATORS.map((i) => (
          <label key={i.key} className="check">
            <input
              type="checkbox"
              checked={chosen.includes(i.key)}
              onChange={(e) => setChosen((x) => (e.target.checked ? [...x, i.key] : x.length > 1 ? x.filter((k) => k !== i.key) : x))}
            />
            {i.label}
          </label>
        ))}
      </div>
      <div className="panel-body flush">
        <Q q={q}>
          {(t) => (
            <>
              <div style={{ overflow: "auto", flex: "1 1 auto" }}>
                <table className="t" data-csv-skip="" /* CSV: vollständige Werte über useCsvExport */>
                  <thead>
                    <tr>
                      <th>Land</th>
                      {t.indicators.map((ind) => (
                        <th key={ind.key} className={`num sortable ${ind.key === focus ? "sorted" : ""}`} onClick={() => setFocus(ind.key)} title="Sortieren und als Balkendiagramm zeigen">
                          {ind.label} {ind.unit === "%" ? "%" : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.slice().sort((a, b) => (b.values[focus]?.value ?? -Infinity) - (a.values[focus]?.value ?? -Infinity)).map((r) => (
                      <tr
                        key={r.country}
                        ref={r.country === mark ? markRow : undefined}
                        className={`clickable ${r.country === mark ? "selected" : ""}`}
                        onClick={() => {
                          setMark(r.country);
                          if (!IS_STATIC) setView("forecast");
                        }}
                        title={IS_STATIC ? undefined : "Verlauf und Prognose dieses Landes zeigen"}
                      >
                        <td>{r.name}</td>
                        {t.indicators.map((ind) => {
                          const v = r.values[ind.key];
                          const hist = (r.history[ind.key] ?? []).map((x) => x.value).filter(isNum);
                          return (
                            <td key={ind.key} className="num" title={v?.year ? `Stand ${v.year}` : undefined}>
                              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                <Spark data={hist.slice(-10)} width={40} height={12} color="#5c5c5c" />
                                {ind.key === "gdp_per_capita_usd" ? fmtInt(v?.value) : ind.unit === "USD" ? fmtBig(v?.value) : fmt(v?.value, 1)}
                                <span className="xs dim">{v?.year ? `’${String(v.year).slice(2)}` : ""}</span>
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ flex: "0 0 46%", minHeight: 200, borderTop: "1px solid var(--rule)", display: "flex", flexDirection: "column" }}>
                <div className="small muted" style={{ padding: "4px 10px", display: "flex", gap: 10, alignItems: "center" }}>
                  {!IS_STATIC && (
                    <Seg
                      label="Ansicht"
                      value={view}
                      options={[
                        { value: "compare", label: "Ländervergleich" },
                        { value: "forecast", label: "Verlauf & Prognose" },
                      ]}
                      onChange={setView}
                    />
                  )}
                  <span>
                    {t.indicators.find((i) => i.key === focus)?.label ?? "Spalte wählen"}
                    {showForecast ? (mark ? "" : " – Land in der Tabelle anklicken") : " – letzter verfügbarer Jahreswert"}
                  </span>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  {showForecast ? (
                    mark ? (
                      <div className="fc-wrap">
                        <FeaturePicker kind="macro" country={mark} value={cleanFeatures(fx)} onChange={setFx} />
                        <ForecastPanel q={fc} maxHist={16} />
                      </div>
                    ) : <Empty>Land in der Tabelle anklicken: Verlauf der Kennzahl mit Prognose für die nächsten drei Jahre.</Empty>
                  ) : (
                    option && <EChart option={option} csv={false} />
                  )}
                </div>
              </div>
              {t.note && !showForecast && <div className="notes">{t.note}</div>}
            </>
          )}
        </Q>
      </div>
    </>
  );
}
