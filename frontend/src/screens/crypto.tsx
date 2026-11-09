// CRYP – Kryptowährungen: Kurse, Entwicklung, Schwankung, Marktanteile und Vergleich mit Aktien und Gold.

import { useMemo } from "react";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Change, Empty, ErrorState, Loading, Seg, Spark, Table } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { monthsBack, normalized, useCrypto, type CryptoOverview, type CryptoRow } from "../lib/crypto";
import { useCsvExport } from "../lib/exporter";
import { DASH, fmt, fmtBig, fmtDate, fmtPrice, isNum } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import { inEur, intradayNormalized, useIntradaySet, windowStart } from "../lib/intradayLines";
import type { Intraday } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

const RANGES = [
  { value: "h24", label: "24 h" },
  { value: "d7", label: "7 T" },
  { value: "3", label: "3M" },
  { value: "12", label: "1J" },
  { value: "36", label: "3J" },
  { value: "60", label: "5J" },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
const CROSS_COLORS: Record<string, string> = { "BTC-USD.CC": "#ffa028", "ETH-USD.CC": "#c792ea", "NDX.INDX": "#66b8ff", "GSPC.INDX": "#29d17d", "GOLD.COMM": "#f2c200", "GLD.US": "#f2c200" };
const CORR_COLORS = ["#66b8ff", "#29d17d", "#f2c200"];

function Kpi({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="kpi" title={title}>
      <div className="kpi-l">{label}</div>
      <div className="kpi-v">{value}</div>
      {sub !== undefined && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

function crossOption(o: CryptoOverview, months: number): EOption | null {
  const btc = o.cross.find((c) => c.key === "BTC-USD.CC");
  if (!btc || !btc.t.length) return null;
  const from = monthsBack(btc.t[btc.t.length - 1], months);
  const log = months >= 36;
  return {
    animation: false,
    grid: { left: 46, right: 12, top: 26, bottom: 22 },
    legend: { top: 0, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => (isNum(v) ? fmt(v, 1) : DASH) },
    xAxis: { type: "time", ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: log ? "log" : "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 0) } },
    series: o.cross.map((c) => ({
      name: c.label,
      type: "line",
      showSymbol: false,
      data: normalized(c, from),
      lineStyle: { width: c.key === "BTC-USD.CC" ? 2 : 1.2, color: CROSS_COLORS[c.key] ?? "#d8d8d8" },
      itemStyle: { color: CROSS_COLORS[c.key] ?? "#d8d8d8" },
    })),
  };
}

/** Vergleich im Tagesverlauf (24 Stunden aus 5-Minuten-, 7 Tage aus Stundenkursen). Aktien und Gold nur zu
 * Börsenzeiten; jede Linie startet mit ihrem ersten Kurs im Zeitraum bei 100. */
function intradayCrossOption(o: CryptoOverview, sets: (Intraday | undefined)[], hours: number): EOption | null {
  const btc = sets[o.cross.findIndex((c) => c.key === "BTC-USD.CC")];
  if (!btc || !btc.t.length) return null;
  const from = windowStart([btc], hours);
  return {
    animation: false,
    grid: { left: 46, right: 12, top: 26, bottom: 22 },
    legend: { top: 0, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => (isNum(v) ? fmt(v, 2) : DASH) },
    xAxis: { type: "time", ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 1) } },
    series: o.cross.map((c, i) => ({
      name: c.label,
      type: "line",
      showSymbol: false,
      connectNulls: false,
      data: intradayNormalized(sets[i], from),
      lineStyle: { width: c.key === "BTC-USD.CC" ? 2 : 1.2, color: CROSS_COLORS[c.key] ?? "#d8d8d8" },
      itemStyle: { color: CROSS_COLORS[c.key] ?? "#d8d8d8" },
    })),
  };
}

function corrOption(o: CryptoOverview, months: number): EOption | null {
  if (!o.corr.length) return null;
  const last = o.corr[0].t[o.corr[0].t.length - 1];
  const from = monthsBack(last, Math.max(months, 12));
  return {
    animation: false,
    grid: { left: 36, right: 12, top: 26, bottom: 22 },
    legend: { top: 0, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6 },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => (isNum(v) ? fmt(v, 2) : DASH) },
    xAxis: { type: "time", ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", min: -1, max: 1, splitNumber: 4, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 1) } },
    series: o.corr.map((c, i) => ({
      name: c.label,
      type: "line",
      showSymbol: false,
      data: c.t.map((t, k) => [t, c.v[k]]).filter((p) => (p[0] as string) >= from),
      lineStyle: { width: 1.3, color: CORR_COLORS[i % CORR_COLORS.length] },
      itemStyle: { color: CORR_COLORS[i % CORR_COLORS.length] },
      markLine: i === 0 ? { silent: true, symbol: "none", lineStyle: { color: "#444", type: "dashed" }, data: [{ yAxis: 0 }], label: { show: false } } : undefined,
    })),
  };
}

export function CRYP(_: ScreenProps) {
  const ws = useWorkspace();
  const [ccy, setCcy] = usePersistentState<"usd" | "eur">("cryp.ccy", "usd", isOneOf(["usd", "eur"] as const));
  const [range, setRange] = usePersistentState<RangeKey>("cryp.range", "12", isOneOf(RANGES.map((r) => r.value)));
  const q = useCrypto(ccy);
  const o = q.data;
  const intraday = range === "h24" || range === "d7";
  const months = intraday ? 12 : Number(range);
  const crossKeys = useMemo(() => (o ? o.cross.map((c) => c.key) : []), [o]);
  const iq = useIntradaySet(crossKeys, range === "h24" ? 2 : 8, range === "h24" ? "5m" : "1h", intraday);
  // Euro-Ansicht: Intraday-Kurse kommen in US-Dollar – mit EUR/USD zum selben Zeitpunkt umrechnen (ein Tag mehr
  // für den Freitagsschluss am Wochenende), sonst zeigte das Diagramm die Dollar-Entwicklung
  const eur = ccy === "eur";
  const fq = useIntradaySet(["EURUSD.FOREX"], range === "h24" ? 3 : 9, range === "h24" ? "5m" : "1h", intraday && eur);
  const iData = iq.map((x) => (eur ? inEur(x.data, fq[0]?.data) : x.data));
  const iStamp = [ccy, fq[0]?.dataUpdatedAt, ...iq.map((x) => x.dataUpdatedAt)].join(",");
  const cross = useMemo(
    () => (o ? (intraday ? intradayCrossOption(o, iData, range === "h24" ? 24 : 7 * 24) : crossOption(o, months)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o, months, intraday, range, iStamp],
  );
  const corr = useMemo(() => (o ? corrOption(o, months) : null), [o, months]);
  const unit = ccy === "eur" ? "EUR" : "USD";

  // CSV: Tabelle kommt aus dem Panel; dazu die Kurse des Vergleichs und die gleitenden Korrelationen
  useCsvExport(() => {
    if (!o) return [];
    const dates = Array.from(new Set(o.cross.flatMap((c) => c.t))).sort();
    const maps = o.cross.map((c) => new Map(c.t.map((t, i) => [t, c.v[i]])));
    const cdates = Array.from(new Set(o.corr.flatMap((c) => c.t))).sort();
    const cmaps = o.corr.map((c) => new Map(c.t.map((t, i) => [t, c.v[i]])));
    return [
      { title: `Kurse im Vergleich (${unit})`, columns: ["Datum", ...o.cross.map((c) => c.label)], rows: dates.map((d) => [d, ...maps.map((m) => m.get(d) ?? null)]) },
      { title: "Gleitende Korrelation 90 Börsentage", columns: ["Datum", ...o.corr.map((c) => c.label)], rows: cdates.map((d) => [d, ...cmaps.map((m) => m.get(d) ?? null)]) },
    ];
  });

  if (IS_STATIC) return <Empty>Die Kryptoübersicht braucht den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;
  const shareTitle =
    o?.shareBasis === "market" ? "Anteil am gesamten Kryptomarkt (laut Datenquelle)" : "Anteil an den gezeigten Coins (ohne Stablecoins) – die Datenquelle liefert keinen Gesamtmarkt";

  return (
    <div className="panel-body flush">
      <div className="toolbar">
        <Seg
          label="Währung"
          value={ccy}
          options={[
            { value: "usd", label: "USD" },
            { value: "eur", label: "EUR" },
          ]}
          onChange={setCcy}
        />
        <Seg label="Zeitraum Diagramme" value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />
        {o && <span className="small muted">Stand {o.rows[0]?.asOf ? fmtDate(o.rows[0].asOf) : DASH}</span>}
      </div>
      {q.isPending ? (
        <Loading rows={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !o || !o.rows.length ? (
        <Empty>Keine Kryptokurse verfügbar.</Empty>
      ) : (
        <div className="cryp-body">
          <div className="kpis">
            <Kpi label={`Marktkap. (${unit})`} value={fmtBig(o.totalCap)} sub={`${o.rows.length} Coins ohne Stablecoins`} />
            <Kpi label="Anteil Bitcoin" value={isNum(o.btcShare) ? `${fmt(o.btcShare, 1)} %` : DASH} sub={o.shareBasis === "market" ? "am Kryptomarkt" : "an den gezeigten Coins"} title={shareTitle} />
            <Kpi label="Anteil Ethereum" value={isNum(o.ethShare) ? `${fmt(o.ethShare, 1)} %` : DASH} title={shareTitle} />
            <Kpi
              label="Breite"
              value={`${o.breadthUp} von ${o.breadthN}`}
              sub="über ihrer 200-Tage-Linie"
              title="Wie viele Coins über ihrem Durchschnitt der letzten 200 Tage stehen – viele = breiter Aufwärtstrend"
            />
          </div>
          <div className="cryp-table" data-export-title={`Kryptowährungen (${unit})`}>
            <Table<CryptoRow>
              rows={o.rows}
              rowKey={(r) => r.ticker}
              onRowClick={(r) => ws.setSecurity(r.ticker, { open: "GP", stay: true })}
              columns={[
                { key: "name", label: "Coin", sort: (r) => r.name, render: (r) => <span title={r.ticker}><b>{r.symbol}</b> <span className="muted">{r.name}</span></span> },
                { key: "last", label: `Kurs ${unit}`, num: true, sort: (r) => r.last, render: (r) => fmtPrice(r.last) },
                {
                  key: "d", label: "24 h", num: true, sort: (r) => r.chg24h ?? r.chg1d,
                  title: "Veränderung über die letzten 24 Stunden (5-Minuten-Kurse); ohne Intraday-Kurse: seit 0 Uhr UTC (mit *)",
                  csv: (r) => (isNum(r.chg24h) ? `${fmt(r.chg24h, 2)} %` : isNum(r.chg1d) ? `${fmt(r.chg1d, 2)} %` : ""),
                  render: (r) =>
                    isNum(r.chg24h) ? (
                      <span title={`24 h: Hoch ${fmtPrice(r.high24h)} · Tief ${fmtPrice(r.low24h)}\nSeit 0 Uhr UTC: ${isNum(r.chg1d) ? fmt(r.chg1d, 2) : DASH} %`}>
                        <Change value={r.chg24h} />
                      </span>
                    ) : (
                      <span title="Keine Intraday-Kurse: Veränderung seit 0 Uhr UTC">
                        <Change value={r.chg1d} />*
                      </span>
                    ),
                },
                { key: "w", label: "7 T", num: true, sort: (r) => r.chg7d, render: (r) => <Change value={r.chg7d} digits={1} /> },
                { key: "m", label: "30 T", num: true, sort: (r) => r.chg30d, render: (r) => <Change value={r.chg30d} digits={1} /> },
                { key: "ytd", label: "YTD", num: true, sort: (r) => r.chgYtd, render: (r) => <Change value={r.chgYtd} digits={1} />, className: "col-opt2" },
                { key: "y", label: "1 J", num: true, sort: (r) => r.chg1y, render: (r) => <Change value={r.chg1y} digits={0} /> },
                {
                  key: "vol", label: "Schwank.", num: true, sort: (r) => r.vol30d, className: "col-opt1",
                  title: "Schwankung der letzten 30 Tage, auf ein Jahr hochgerechnet (Aktienindex zum Vergleich: etwa 15–20 %)",
                  render: (r) => (isNum(r.vol30d) ? `${fmt(r.vol30d, 0)} %` : DASH),
                },
                {
                  key: "hi", label: "vom Hoch", num: true, sort: (r) => r.fromHigh,
                  title: "Abstand zum höchsten Tagesschluss seit Beginn der Kursdaten",
                  render: (r) => <span title={r.highDate ? `Hoch am ${fmtDate(r.highDate)} (Daten seit ${fmtDate(r.first)})` : undefined}><Change value={r.fromHigh} digits={0} /></span>,
                },
                {
                  key: "corr", label: "Korr. BTC", num: true, sort: (r) => r.corrBtc, className: "col-opt1",
                  title: "Wie gleich der Coin mit Bitcoin schwankt (Tagesrenditen, 90 Tage): 1 = völlig gleich, 0 = unabhängig",
                  render: (r) => (isNum(r.corrBtc) ? fmt(r.corrBtc, 2) : DASH),
                },
                {
                  key: "trend", label: "200 T", sort: (r) => (r.above200d === null ? null : r.above200d ? 1 : 0),
                  title: "Kurs über oder unter dem Durchschnitt der letzten 200 Tage",
                  csv: (r) => (r.above200d === null ? "" : r.above200d ? "über" : "unter"),
                  render: (r) => (r.above200d === null ? <span className="dim">–</span> : r.above200d ? <span className="up">▲ über</span> : <span className="down">▼ unter</span>),
                },
                { key: "cap", label: "Marktkap.", num: true, sort: (r) => r.marketCap, render: (r) => fmtBig(r.marketCap) },
                {
                  key: "share", label: "Anteil", num: true, sort: (r) => r.share, title: shareTitle,
                  render: (r) => (isNum(r.share) ? `${fmt(r.share, r.share < 1 ? 2 : 1)} %` : DASH),
                },
                { key: "spark", label: "30 Tage", num: true, render: (r) => <Spark data={r.spark} />, className: "col-opt1" },
              ]}
            />
          </div>
          <div className="cryp-charts">
            <div>
              <div className="section-title">
                {intraday
                  ? `Bitcoin im Vergleich – letzte ${range === "h24" ? "24 Stunden (5-Minuten-Kurse)" : "7 Tage (Stundenkurse)"}, Start = 100; Aktien und Gold nur zu Börsenzeiten`
                  : `Bitcoin im Vergleich (Start = 100${months >= 36 ? ", logarithmisch" : ""})`}
              </div>
              <div className="cryp-chart">{cross && <EChart option={cross} csv={false} />}</div>
            </div>
            <div>
              <div className="section-title" title="Gleitende Korrelation der Tagesrenditen über 90 Börsentage: über 0 = laufen zusammen, unter 0 = gegenläufig">
                Gleichlauf mit Aktien und Gold (Korrelation 90 Tage)
              </div>
              <div className="cryp-chart">{corr && <EChart option={corr} csv={false} />}</div>
            </div>
          </div>
          <div className="notes">
            {o.notes.join(" ")}
            {o.skipped.length ? ` Fehlt: ${o.skipped.join(", ")}.` : ""} Klick auf einen Coin öffnet den Kurschart. Keine Empfehlung.
          </div>
        </div>
      )}
    </div>
  );
}
