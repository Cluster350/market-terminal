// FCTR – Faktoren: Wie laufen Value, Wachstum, Momentum, Qualität, kleine Firmen, niedrige Schwankung …
// gegenüber dem Markt? Gemessen mit Stil-ETFs (USA und Europa).

import { useMemo } from "react";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Change, Empty, ErrorState, Loading, Seg } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { monthsBack, normalized } from "../lib/crypto";
import { useCsvExport } from "../lib/exporter";
import { FACTOR_COLORS, PERIOD_LABEL, PERIODS, relativeLine, useFactors, type FactorOverview, type FactorRegion, type FactorRow } from "../lib/factors";
import { DASH, displayTicker, fmt, fmtDate, fmtPrice, isNum, tone } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import { intradayNormalized, intradayRatio, useIntradaySet } from "../lib/intradayLines";
import type { Intraday } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

const RANGES = [
  { value: "d1", label: "Heute" },
  { value: "d5", label: "5 T" },
  { value: "12", label: "1J" },
  { value: "36", label: "3J" },
  { value: "60", label: "5J" },
  { value: "120", label: "10J" },
] as const;
type RangeKey = (typeof RANGES)[number]["value"];
type View = "rel" | "abs";

function chartOption(o: FactorOverview, view: View, months: number): EOption | null {
  if (!o.t.length) return null;
  const from = monthsBack(o.t[o.t.length - 1], months);
  const market = o.lines.market ?? [];
  const series: Record<string, unknown>[] = o.rows.map((r, i) => {
    const line = view === "rel" ? relativeLine(o.t, o.lines[r.key] ?? [], market) : { t: o.t, v: o.lines[r.key] ?? [] };
    return {
      name: r.label,
      type: "line",
      showSymbol: false,
      data: normalized(line, from),
      lineStyle: { width: 1.4, color: FACTOR_COLORS[r.key] ?? "#d8d8d8" },
      itemStyle: { color: FACTOR_COLORS[r.key] ?? "#d8d8d8" },
      // Linie „Markt = 100“: darüber läuft der Stil besser als der Markt
      markLine: view === "rel" && i === 0 ? { silent: true, symbol: "none", lineStyle: { color: "#555", type: "dashed" }, data: [{ yAxis: 100 }], label: { show: false } } : undefined,
    };
  });
  if (view === "abs") {
    series.unshift({
      name: o.bench.label,
      type: "line",
      showSymbol: false,
      data: normalized({ t: o.t, v: market }, from),
      lineStyle: { width: 2, color: FACTOR_COLORS.market },
      itemStyle: { color: FACTOR_COLORS.market },
    });
  }
  return {
    animation: false,
    grid: { left: 46, right: 12, top: 28, bottom: 22 },
    legend: { type: "scroll", top: 0, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6, pageTextStyle: { color: "#8f8f8f" } },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => (isNum(v) ? fmt(v, 1) : DASH) },
    xAxis: { type: "time", ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 0) } },
    series,
  };
}

/** Tagesverlauf (heute bzw. fünf Handelstage): Faktor ÷ Markt oder Kurs, je auf den ersten Kurs = 100. */
function intradayOption(o: FactorOverview, view: View, sets: (Intraday | undefined)[]): EOption | null {
  const market = sets[0];
  if (!market || !market.t.length) return null;
  const from = market.t[0];
  const series: Record<string, unknown>[] = o.rows.map((r, i) => ({
    name: r.label,
    type: "line",
    showSymbol: false,
    data: view === "rel" ? intradayRatio(sets[i + 1], market, from) : intradayNormalized(sets[i + 1], from),
    lineStyle: { width: 1.4, color: FACTOR_COLORS[r.key] ?? "#d8d8d8" },
    itemStyle: { color: FACTOR_COLORS[r.key] ?? "#d8d8d8" },
    markLine: view === "rel" && i === 0 ? { silent: true, symbol: "none", lineStyle: { color: "#555", type: "dashed" }, data: [{ yAxis: 100 }], label: { show: false } } : undefined,
  }));
  if (view === "abs") {
    series.unshift({
      name: o.bench.label, type: "line", showSymbol: false, data: intradayNormalized(market, from),
      lineStyle: { width: 2, color: FACTOR_COLORS.market }, itemStyle: { color: FACTOR_COLORS.market },
    });
  }
  return {
    animation: false,
    grid: { left: 46, right: 12, top: 28, bottom: 22 },
    legend: { type: "scroll", top: 0, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 6, pageTextStyle: { color: "#8f8f8f" } },
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (v: number) => (isNum(v) ? fmt(v, 2) : DASH) },
    xAxis: { type: "time", ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 1) } },
    series,
  };
}

function corrColor(c: number | null): string | undefined {
  if (!isNum(c)) return undefined;
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `rgba(41,209,125,${(a * 0.45).toFixed(2)})` : `rgba(255,82,82,${(a * 0.45).toFixed(2)})`;
}

export function FCTR(_: ScreenProps) {
  const ws = useWorkspace();
  const [region, setRegion] = usePersistentState<FactorRegion>("fctr.region", "us", isOneOf(["us", "eu"] as const));
  const [view, setView] = usePersistentState<View>("fctr.view", "rel", isOneOf(["rel", "abs"] as const));
  const [range, setRange] = usePersistentState<RangeKey>("fctr.range", "36", isOneOf(RANGES.map((r) => r.value)));
  const q = useFactors(region);
  const o = q.data;
  const intraday = range === "d1" || range === "d5";
  const tickers = useMemo(() => (o ? [o.bench.ticker, ...o.rows.map((r) => r.ticker)] : []), [o]);
  const iq = useIntradaySet(tickers, range === "d1" ? 1 : 5, range === "d1" ? "5m" : "15m", intraday);
  const iData = iq.map((x) => x.data);
  const iStamp = iq.map((x) => x.dataUpdatedAt).join(",");
  const iMissing = intraday && iq.length > 0 && iq.every((x) => !x.isPending) && !iData[0]?.t.length;
  const option = useMemo(
    () => (o ? (intraday ? intradayOption(o, view, iData) : chartOption(o, view, Number(range))) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [o, view, range, intraday, iStamp],
  );

  // CSV: Tabelle und Korrelationen kommen aus dem Panel; dazu die Tageskurse aller ETFs
  useCsvExport(() => {
    if (!o) return [];
    const keys = ["market", ...o.rows.map((r) => r.key)];
    const label = (k: string) => (k === "market" ? `${o.bench.label} (${displayTicker(o.bench.ticker)})` : `${o.rows.find((r) => r.key === k)?.label} (${displayTicker(o.rows.find((r) => r.key === k)?.ticker ?? "")})`);
    return [{ title: `Tageskurse der Faktor-ETFs ${o.label}`, columns: ["Datum", ...keys.map(label)], rows: o.t.map((t, i) => [t, ...keys.map((k) => o.lines[k]?.[i] ?? null)]) }];
  });

  if (IS_STATIC) return <Empty>Die Faktoren brauchen den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;
  const vals = (r: FactorRow) => (view === "rel" && r.key !== "market" ? r.rel : r.abs);

  return (
    <div className="panel-body flush">
      <div className="toolbar">
        <Seg
          label="Region"
          value={region}
          options={[
            { value: "us", label: "USA" },
            { value: "eu", label: "Europa" },
          ]}
          onChange={setRegion}
        />
        <Seg
          label="Ansicht"
          value={view}
          options={[
            { value: "rel", label: "gegenüber Markt" },
            { value: "abs", label: "absolut" },
          ]}
          onChange={setView}
        />
        <Seg label="Zeitraum Diagramm" value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />
      </div>
      {q.isPending ? (
        <Loading rows={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !o ? null : (
        <div className="cryp-body">
          <div className="cryp-table">
            <table className="t" data-export-title={`Faktoren ${o.label} – ${view === "rel" ? "gegenüber Markt" : "absolut"}`}>
              <thead>
                <tr>
                  <th>Faktor</th>
                  <th className="col-opt1">ETF</th>
                  <th className="num">Kurs</th>
                  {PERIODS.map((p) => (
                    <th key={p} className={`num ${p === "1d" || p === "5y" ? "col-opt2" : ""}`}>
                      {PERIOD_LABEL[p]} %
                    </th>
                  ))}
                  <th className="num col-opt1" title="Schwankung des ETFs über ein Jahr">Schwank.</th>
                  <th className="num col-opt1" title="Beta zum Markt (1 Jahr, Tagesrenditen): 1 = schwankt wie der Markt">Beta</th>
                  <th className="num" title="Verhältnis Faktor ÷ Markt gegenüber seinem Durchschnitt der letzten 200 Tage: positiv = der Stil läuft derzeit besser als im Schnitt">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody>
                {[o.bench, ...o.rows].map((r) => {
                  const v = vals(r);
                  const isMarket = r.key === "market";
                  return (
                    <tr
                      key={r.key}
                      className={`clickable ${isMarket ? "fctr-market" : ""}`}
                      title={isMarket && view === "rel" ? "Markt selbst: absolute Entwicklung zum Vergleich" : undefined}
                      onClick={() => ws.setSecurity(r.ticker, { open: "GP", stay: true })}
                    >
                      <td title={r.help ? `${r.label}: ${r.help}\n${r.name}${r.isin ? ` · ISIN ${r.isin}` : ""}` : r.name}>
                        <span className="fctr-dot" style={{ background: FACTOR_COLORS[r.key] ?? "#888" }} /> <b>{r.label}</b>
                      </td>
                      <td className="col-opt1 muted" title={r.name}>{displayTicker(r.ticker)}</td>
                      <td className="num">{fmtPrice(r.last)}</td>
                      {PERIODS.map((p) => (
                        <td key={p} className={`num ${p === "1d" || p === "5y" ? "col-opt2" : ""}`}>
                          {isMarket && view === "rel" ? <span className="muted">{isNum(v[p]) ? `${fmt(v[p] as number, 1)} %` : DASH}</span> : <Change value={v[p] ?? null} digits={1} />}
                        </td>
                      ))}
                      <td className="num col-opt1">{isNum(r.vol1y) ? `${fmt(r.vol1y, 0)} %` : DASH}</td>
                      <td className="num col-opt1">{isNum(r.beta1y) ? fmt(r.beta1y, 2) : isMarket ? "1,00" : DASH}</td>
                      <td className={`num ${tone(r.relVsAvg, 1)}`} data-csv={isNum(r.relVsAvg) ? `${fmt(r.relVsAvg, 1)} %` : ""}>
                        {isMarket ? <span className="dim">Maßstab</span> : isNum(r.relVsAvg) ? `${r.relVsAvg > 0 ? "▲" : "▼"} ${fmt(Math.abs(r.relVsAvg), 1)} %` : DASH}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="cryp-charts">
            <div>
              <div className="section-title">
                {view === "rel" ? "Faktor ÷ Markt (Start = 100; steigt = Stil läuft besser als der Markt)" : "Kursverlauf (Start = 100)"}
                {intraday ? (range === "d1" ? " · letzter Handelstag, 5-Minuten-Kurse" : " · 5 Handelstage, 15-Minuten-Kurse") : ""}
              </div>
              <div className="cryp-chart">
                {iMissing ? (
                  <Empty>Für diese ETFs liefert die Datenquelle keine Intraday-Kurse – bitte einen längeren Zeitraum wählen.</Empty>
                ) : (
                  option && <EChart option={option} csv={false} />
                )}
              </div>
            </div>
            <div>
              <div className="section-title" title="Korrelation der wöchentlichen Überrenditen (Faktor minus Markt) der letzten drei Jahre">
                Wie ähnlich laufen die Stile? (3 Jahre)
              </div>
              <table className="t fctr-corr" data-export-title="Korrelation der Überrenditen (3 Jahre, wöchentlich)">
                <thead>
                  <tr>
                    <th />
                    {o.corrKeys.map((k) => (
                      <th key={k} className="num">{o.rows.find((r) => r.key === k)?.label.slice(0, 6)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {o.corrKeys.map((k, i) => (
                    <tr key={k}>
                      <td>{o.rows.find((r) => r.key === k)?.label}</td>
                      {o.corr[i].map((c, j) => (
                        <td key={j} className="num" style={{ background: i === j ? undefined : corrColor(c) }}>
                          {i === j ? <span className="dim">–</span> : isNum(c) ? fmt(c, 2) : DASH}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="notes">
            {o.notes.join(" ")} Daten seit {fmtDate(o.bench.first)}.{o.skipped.length ? ` Fehlt: ${o.skipped.join("; ")}.` : ""} Klick auf eine Zeile öffnet den Kurschart des ETFs.
          </div>
        </div>
      )}
    </div>
  );
}
