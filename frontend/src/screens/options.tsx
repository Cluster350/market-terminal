// OMON – Optionen: Kennzahlen, Positionierung (Open Interest), Optionskette und Volatilität
// einer US-Aktie. Tagesenddaten; Optionen gibt es bei EODHD nur für US-Werte.

import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type { EOption } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg } from "../components/ui";
import { explain } from "../lib/glossary";
import { fmt, fmtBig, fmtDate, fmtPct, fmtPrice, isEquity } from "../lib/format";
import { contractLabel, strikeWindow, useOptionChain, useOptionsOverview, type ActiveContract, type ExpirySummary, type OptionQuote, type OptionsOverview } from "../lib/options";
import { isOneOf, usePersistentState } from "../lib/persist";
import { useStatus } from "../lib/queries";
import { IS_STATIC } from "../lib/api";
import { qualityLine, useVolForecast, verdictClass } from "../lib/forecast";
import type { ScreenProps } from "./types";

const EChart = lazy(() => import("../components/EChart"));

const VIEWS = ["overview", "chain", "vol"] as const;
const WINDOWS = ["10", "20", "all"] as const;
const AXIS = { axisLine: { lineStyle: { color: "#3a3a3a" } }, axisLabel: { color: "#8f8f8f", fontSize: 10 }, splitLine: { lineStyle: { color: "#171717" } } };
const TIP = { backgroundColor: "#111", borderColor: "#3a3a3a", textStyle: { color: "#ececec", fontSize: 11 } };

const ivPct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? "–" : `${fmt(x * 100, d)} %`);
const ratio = (x: number | null | undefined) => fmt(x, 2);

function expLabel(e: ExpirySummary): string {
  const [y, m, d] = e.exp.split("-");
  return `${d}.${m}.${y.slice(2)} · ${e.dte} T${e.monthly ? " · M" : ""}${e.earnings ? " · E" : ""}`;
}

function Chart({ option, height = 220 }: { option: EOption; height?: number }) {
  return (
    <div style={{ height }}>
      <Suspense fallback={null}>
        <EChart option={option} />
      </Suspense>
    </div>
  );
}

/** Prognose der Schwankung für die nächsten 21 Handelstage (Modell) im Vergleich zur impliziten Volatilität. */
export function volVsImplied(iv: number | null | undefined, lo80: number, hi80: number): { cls: string; text: string } | null {
  if (iv === null || iv === undefined) return null;
  const pct = iv * 100;
  if (pct > hi80) return { cls: "down", text: "IV über dem Band: Optionen laut Modell teuer" };
  if (pct < lo80) return { cls: "up", text: "IV unter dem Band: Optionen laut Modell günstig" };
  return { cls: "", text: "IV im Band des Modells" };
}

function VolForecastKpi({ o }: { o: OptionsOverview }) {
  const q = useVolForecast(o.ticker, o.iv30 !== null && o.iv30 !== undefined ? o.iv30 * 100 : null, !IS_STATIC);
  const r = q.data;
  if (IS_STATIC || q.isError) return null;
  if (!r) {
    return (
      <div className="kpi">
        <div className="kpi-l">Schwankung Prognose</div>
        <div className="kpi-v muted">…</div>
      </div>
    );
  }
  const f = r.forecast;
  const cmp = volVsImplied(o.iv30, f.lo80[0], f.hi80[0]);
  return (
    <div
      className="kpi"
      title={
        `Modellprognose (${r.engineLabel}) der tatsächlichen Schwankung in den nächsten 21 Handelstagen, annualisiert, mit 80-%-Band. ` +
        `Vergleich mit der impliziten Volatilität: Liegt sie über dem Band, preisen Optionen mehr Schwankung ein, als das Modell erwartet.\n` +
        `${r.verdictText}\n${qualityLine(r.quality, 1)}\nKeine Empfehlung.`
      }
    >
      <div className="kpi-l">
        Schwankung Prognose <span className={`fc-verdict ${verdictClass(r.verdict)}`}>{r.engine === "chronos" ? "Chronos-2" : "Statistik"}</span>
      </div>
      <div className="kpi-v">{fmt(f.median[0], 1)} %</div>
      <div className="kpi-s">
        80 %: {fmt(f.lo80[0], 0)}–{fmt(f.hi80[0], 0)} %{cmp ? <> · <span className={cmp.cls}>{cmp.text}</span></> : null}
      </div>
    </div>
  );
}

function Kpis({ o }: { o: OptionsOverview }) {
  const f = o.focus;
  return (
    <div className="kpis">
      <div className="kpi" title={explain("Implizite Volatilität")}>
        <div className="kpi-l">IV 30 Tage</div>
        <div className="kpi-v">{ivPct(o.iv30)}</div>
        <div className="kpi-s">HV 30T {ivPct(o.hv30)} · 1J {ivPct(o.hv1y)}</div>
      </div>
      <VolForecastKpi o={o} />
      <div className="kpi" title="Implizite Volatilität (30 Kalendertage) geteilt durch die tatsächliche Schwankung der letzten 21 Handelstage (≈ 30 Kalendertage). Über 1: Optionen eher teuer.">
        <div className="kpi-l">IV / HV</div>
        <div className={`kpi-v ${o.ivHv && o.ivHv > 1.2 ? "down" : o.ivHv && o.ivHv < 0.85 ? "up" : ""}`}>{ratio(o.ivHv)}</div>
        <div className="kpi-s">{o.ivHv ? (o.ivHv > 1.2 ? "Optionen teuer" : o.ivHv < 0.85 ? "Optionen günstig" : "normal") : ""}</div>
      </div>
      {f && (
        <div className="kpi" title={explain("Erwartete Bewegung")}>
          <div className="kpi-l">Erwartete Bewegung</div>
          <div className="kpi-v">±{fmt(f.movePct, 1)} %</div>
          <div className="kpi-s">±{fmtPrice(f.straddle)} bis {fmtDate(f.exp)}</div>
        </div>
      )}
      {o.earningsDate && (() => {
        const ee = o.expirations.find((x) => x.earnings);
        return (
          <div className="kpi" title="Nächste Quartalszahlen und der erste Verfall danach: Dessen erwartete Bewegung enthält die Ereignisprämie.">
            <div className="kpi-l">Quartalszahlen</div>
            <div className="kpi-v">{fmtDate(o.earningsDate)}</div>
            <div className="kpi-s">
              {o.earningsTiming === "BeforeMarket" ? "vor Eröffnung" : o.earningsTiming === "AfterMarket" ? "nach Schluss" : ""}
              {ee ? ` · bis ${fmtDate(ee.exp).slice(0, 6)} ±${fmt(ee.movePct, 1)} %` : ""}
            </div>
          </div>
        );
      })()}
      <div className="kpi" title={explain("Put/Call-Verhältnis")}>
        <div className="kpi-l">Put/Call</div>
        <div className="kpi-v">{ratio(o.pcVolume)}</div>
        <div className="kpi-s">Volumen · OI {ratio(o.pcOi)}</div>
      </div>
      {f && (
        <div className="kpi" title={explain("Skew")}>
          <div className="kpi-l">Skew 25Δ</div>
          <div className="kpi-v">{f.skew25 === null ? "–" : `${f.skew25 > 0 ? "+" : ""}${fmt(f.skew25, 1)} Pkt.`}</div>
          <div className="kpi-s">Put {ivPct(f.ivPut25)} · Call {ivPct(f.ivCall25)}</div>
        </div>
      )}
      {f && (
        <div className="kpi" title={explain("Max Pain")}>
          <div className="kpi-l">Max Pain</div>
          <div className="kpi-v">{fmtPrice(f.maxPain)}</div>
          <div className="kpi-s">{o.spot && f.maxPain ? `${fmtPct((f.maxPain / o.spot - 1) * 100, 1)} zum Kurs` : ""}</div>
        </div>
      )}
      <div className="kpi">
        <div className="kpi-l">Umsatz / Open Interest</div>
        <div className="kpi-v">{fmtBig(o.totalVolume)}</div>
        <div className="kpi-s">OI {fmtBig(o.totalOi)} · {o.contracts} Kontrakte</div>
      </div>
    </div>
  );
}

/** Kennzahlen in einer Zeile – in der Kette, damit auch in kleinen Panels Platz für die Strikes bleibt. */
function KpiLine({ o }: { o: OptionsOverview }) {
  const f = o.focus;
  const parts = [
    `IV 30T ${ivPct(o.iv30)}`,
    `HV 30T ${ivPct(o.hv30)}`,
    f?.movePct !== null && f?.movePct !== undefined ? `Erw. Bewegung ±${fmt(f.movePct, 1)} %` : null,
    `Put/Call ${ratio(o.pcVolume)}`,
    f?.skew25 !== null && f?.skew25 !== undefined ? `Skew 25Δ ${f.skew25 > 0 ? "+" : ""}${fmt(f.skew25, 1)} Pkt.` : null,
    f?.maxPain ? `Max Pain ${fmtPrice(f.maxPain)}` : null,
  ];
  return <div className="opt-kpiline small">{parts.filter(Boolean).join(" · ")}</div>;
}

function ContractTable({ rows, title, hint, onOpen }: { rows: ActiveContract[]; title: string; hint?: string; onOpen?: (c: ActiveContract) => void }) {
  return (
    <div>
      <div className="section-title" title={hint}>{title}</div>
      {!rows.length ? (
        <div className="small muted" style={{ padding: "2px 0 8px" }}>keine</div>
      ) : (
        <table className="t">
          <thead>
            <tr>
              <th>Kontrakt</th>
              <th className="num">Volumen</th>
              <th className="num">OI</th>
              <th className="num" title="Volumen geteilt durch Open Interest">Vol/OI</th>
              <th className="num col-opt1">IV</th>
              <th className="num col-opt1">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.contract} className={onOpen ? "clickable" : ""} title={onOpen ? "Klick: Kette dieses Verfalls öffnen" : undefined} onClick={onOpen ? () => onOpen(c) : undefined}>
                <td className={c.type === "call" ? "up" : "down"}>{contractLabel(c)}</td>
                <td className="num">{fmtBig(c.volume)}</td>
                <td className="num">{fmtBig(c.openInterest)}</td>
                <td className={`num ${c.volOi && c.volOi >= 1.2 ? "lbl" : ""}`}>{fmt(c.volOi, 2)}</td>
                <td className="num col-opt1">{ivPct(c.iv)}</td>
                <td className="num col-opt1">{fmt(c.delta, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OverviewView({ o, onOpen }: { o: OptionsOverview; onOpen: (c: ActiveContract) => void }) {
  const f = o.focus!;
  const spot = o.spot;
  const oiOption: EOption = {
    grid: { left: 70, right: 12, top: 24, bottom: 26 },
    legend: { top: 0, right: 6, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 8 },
    tooltip: { ...TIP, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => fmtBig(Math.abs(v)) },
    xAxis: { type: "category", data: o.oiByStrike.map((r) => fmt(r.strike, r.strike % 1 ? 1 : 0)), ...AXIS },
    yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmtBig(Math.abs(v)) } },
    series: [
      {
        name: "Call-OI", type: "bar", stack: "oi", data: o.oiByStrike.map((r) => r.callOi), itemStyle: { color: "rgba(41,209,125,0.75)" }, barCategoryGap: "15%",
        markLine: spot
          ? {
              symbol: "none", label: { color: "#ffa028", fontSize: 10, formatter: "Kurs" }, lineStyle: { color: "#ffa028", type: "dashed" },
              data: [{ xAxis: closestIndex(o.oiByStrike.map((r) => r.strike), spot) }],
            }
          : undefined,
      },
      { name: "Put-OI", type: "bar", stack: "oi", data: o.oiByStrike.map((r) => -r.putOi), itemStyle: { color: "rgba(255,82,82,0.75)" } },
    ],
  };
  const termOption: EOption = {
    grid: { left: 44, right: 12, top: 24, bottom: 26 },
    legend: { top: 0, right: 6, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 2 },
    tooltip: { ...TIP, trigger: "axis", valueFormatter: (v: number) => `${fmt(v, 1)} %` },
    xAxis: { type: "value", name: "Tage", nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, ...AXIS, min: 0 },
    // Luft nach oben, damit die E-Markierung am Earnings-Verfall nicht abgeschnitten wird
    yAxis: { type: "value", scale: true, ...AXIS, max: (v: { max: number }) => Math.ceil(v.max * 1.12) },
    series: [
      {
        name: "ATM-IV", type: "line", data: o.expirations.filter((e) => e.atmIv).map((e) => [e.dte, e.atmIv! * 100]), symbolSize: 5, lineStyle: { color: "#66b8ff", width: 1.6 }, itemStyle: { color: "#66b8ff" },
        // Verfall nach den Quartalszahlen markieren (Ereignisprämie in der Laufzeitstruktur)
        markPoint: (() => {
          const e = o.expirations.find((x) => x.earnings && x.atmIv);
          return e ? { symbol: "pin", symbolSize: 26, itemStyle: { color: "#ffa028" }, label: { formatter: "E", color: "#000", fontSize: 10 }, data: [{ coord: [e.dte, e.atmIv! * 100] }] } : undefined;
        })(),
      },
      ...(o.hv30 ? [{ name: "HV 30T", type: "line", data: [[0, o.hv30 * 100], [Math.max(...o.expirations.map((e) => e.dte)), o.hv30 * 100]], symbol: "none", lineStyle: { color: "#8f8f8f", type: "dashed", width: 1 } }] : []),
    ],
  };
  return (
    <>
      <div className="opt-grid">
        <div>
          <div className="section-title" title={explain("Open Interest")}>Open Interest je Strike · Verfall {fmtDate(f.exp)}</div>
          <Chart option={oiOption} />
        </div>
        <div>
          <div className="section-title" title={explain("Laufzeitstruktur")}>Volatilität nach Laufzeit</div>
          <Chart option={termOption} />
        </div>
      </div>
      <div className="opt-grid">
        <div className="opt-walls">
          <div>
            <div className="section-title" title="Strikes über dem Kurs mit dem meisten Call-Open-Interest – wirken oft wie Widerstand">Widerstand (Call-OI)</div>
            {o.callWalls.map((w) => (
              <div key={w.strike} className="opt-wall"><b>{fmtPrice(w.strike)}</b> <span className="up">{fmtBig(w.callOi)}</span> <span className="dim">{spot ? fmtPct((w.strike / spot - 1) * 100, 1) : ""}</span></div>
            ))}
          </div>
          <div>
            <div className="section-title" title="Strikes unter dem Kurs mit dem meisten Put-Open-Interest – wirken oft wie Unterstützung">Unterstützung (Put-OI)</div>
            {o.putWalls.map((w) => (
              <div key={w.strike} className="opt-wall"><b>{fmtPrice(w.strike)}</b> <span className="down">{fmtBig(w.putOi)}</span> <span className="dim">{spot ? fmtPct((w.strike / spot - 1) * 100, 1) : ""}</span></div>
            ))}
          </div>
        </div>
        <ContractTable rows={o.unusual} title="Auffällige Umsätze" hint={explain("Auffällige Umsätze")} onOpen={onOpen} />
      </div>
      <div style={{ padding: "0 8px" }}>
        <ContractTable rows={o.mostActive} title="Aktivste Kontrakte (alle Verfälle)" onOpen={onOpen} />
      </div>
    </>
  );
}

function closestIndex(xs: number[], x: number): number {
  let best = 0;
  xs.forEach((v, i) => {
    if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
  });
  return best;
}

function QuoteCells({ q, side, greeks, itm }: { q: OptionQuote | null; side: "call" | "put"; greeks: boolean; itm: boolean }) {
  const x = itm ? " opt-itm" : ""; // im Geld liegende Optionen hinterlegt
  const cells = [
    <td key="b" className={`num${x}`}>{fmt(q?.bid, 2)}</td>,
    <td key="a" className={`num${x}`}>{fmt(q?.ask, 2)}</td>,
    <td key="l" className={`num col-opt2${x}`}>{fmt(q?.last, 2)}</td>,
    <td key="v" className={`num col-opt1${x}`}>{fmtBig(q?.volume)}</td>,
    <td key="o" className={`num${x}`}>{fmtBig(q?.openInterest)}</td>,
    <td key="i" className={`num${x}`}>{ivPct(q?.iv)}</td>,
    <td key="d" className={`num${x}`}>{fmt(q?.delta, 2)}</td>,
    ...(greeks
      ? [
          <td key="g" className={`num${x}`}>{fmt(q?.gamma, 3)}</td>,
          <td key="t" className={`num${x}`}>{fmt(q?.theta, 3)}</td>,
          <td key="n" className={`num${x}`}>{fmt(q?.vega, 3)}</td>,
        ]
      : []),
  ];
  return <>{side === "call" ? cells : cells.reverse()}</>;
}

function ChainView({ ticker, exp }: { ticker: string; exp: string | null }) {
  const [win, setWin] = usePersistentState<(typeof WINDOWS)[number]>("omon.window", "20", isOneOf(WINDOWS));
  const [greeks, setGreeks] = usePersistentState("omon.greeks", false, (x): x is boolean => typeof x === "boolean");
  const q = useOptionChain(ticker, exp);
  const atmRef = useRef<HTMLTableRowElement | null>(null);
  const chainKey = q.data ? `${q.data.ticker}|${q.data.exp}|${win}` : "";
  useEffect(() => {
    // beim Öffnen und bei Verfalls- oder Bereichswechsel die Zeile am Geld in die Mitte holen
    atmRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [chainKey]);
  if (q.isPending) return <Loading rows={10} />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const ch = q.data!;
  const rows = strikeWindow(ch.rows, ch.spot, win === "all" ? null : Number(win));
  const head = ["Bid", "Ask", "Letzter", "Vol", "OI", "IV", "Δ", ...(greeks ? ["Γ", "Θ/Tag", "Vega"] : [])];
  const opt = (i: number) => (i === 2 ? "col-opt2" : i === 3 ? "col-opt1" : "");
  return (
    <>
      <div className="toolbar">
        <Seg label="Strikes" value={win} options={[{ value: "10", label: "±10 %" }, { value: "20", label: "±20 %" }, { value: "all", label: "alle" }]} onChange={setWin} />
        <label className="check">
          <input type="checkbox" checked={greeks} onChange={(e) => setGreeks(e.target.checked)} />
          alle Greeks
        </label>
        <span className="small muted" style={{ marginLeft: "auto" }}>
          Verfall {fmtDate(ch.exp)} · {ch.dte} Tage · Kurs {fmtPrice(ch.spot)}
        </span>
      </div>
      {!rows.length ? (
        <Empty>Keine Strikes in diesem Bereich.</Empty>
      ) : (
        <table className="t opt-chain">
          <thead>
            <tr>
              <th colSpan={head.length} className="opt-side up">CALLS</th>
              <th className="opt-strike-h">Strike</th>
              <th colSpan={head.length} className="opt-side down">PUTS</th>
            </tr>
            <tr>
              {head.map((h, i) => (
                <th key={`c${h}`} className={`num ${opt(i)}`}>{h}</th>
              ))}
              <th />
              {[...head].reverse().map((h, i) => (
                <th key={`p${h}`} className={`num ${opt(head.length - 1 - i)}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const atm = r.strike === ch.atmStrike;
              const callItm = ch.spot !== null && r.strike < ch.spot;
              const putItm = ch.spot !== null && r.strike > ch.spot;
              return (
                <tr key={r.strike} ref={atm ? atmRef : undefined} className={atm ? "opt-atm" : ""}>
                  <QuoteCells q={r.call} side="call" greeks={greeks} itm={callItm} />
                  <td className="opt-strike">{fmtPrice(r.strike)}</td>
                  <QuoteCells q={r.put} side="put" greeks={greeks} itm={putItm} />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="notes">Im Geld liegende Optionen sind hinterlegt, die Zeile am Geld ist markiert. Θ in Dollar je Kalendertag, Vega je Volatilitätspunkt.</div>
    </>
  );
}

function VolView({ o, onPick }: { o: OptionsOverview; onPick: (exp: string) => void }) {
  const f = o.focus!;
  const smile: EOption = {
    grid: { left: 44, right: 12, top: 24, bottom: 26 },
    legend: { top: 0, right: 6, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 2 },
    tooltip: { ...TIP, trigger: "axis", valueFormatter: (v: number) => `${fmt(v, 1)} %` },
    xAxis: { type: "value", scale: true, name: "Strike", nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, ...AXIS },
    yAxis: { type: "value", scale: true, ...AXIS },
    series: [
      { name: "Call-IV", type: "line", data: o.smile.filter((p) => p.callIv).map((p) => [p.strike, p.callIv! * 100]), symbolSize: 3, lineStyle: { color: "#29d17d", width: 1.2 }, itemStyle: { color: "#29d17d" } },
      {
        name: "Put-IV", type: "line", data: o.smile.filter((p) => p.putIv).map((p) => [p.strike, p.putIv! * 100]), symbolSize: 3, lineStyle: { color: "#ff5252", width: 1.2 }, itemStyle: { color: "#ff5252" },
        markLine: o.spot ? { symbol: "none", label: { color: "#ffa028", fontSize: 10, formatter: "Kurs" }, lineStyle: { color: "#ffa028", type: "dashed" }, data: [{ xAxis: o.spot }] } : undefined,
      },
    ],
  };
  return (
    <>
      <div style={{ padding: "0 8px" }}>
        <div className="section-title" title={explain("Skew")}>Volatilitäts-Smile · Verfall {fmtDate(f.exp)}</div>
        <Chart option={smile} height={230} />
      </div>
      <div style={{ padding: "0 8px" }}>
        <div className="section-title">Alle Verfälle (Klick wählt den Verfall)</div>
        <table className="t">
          <thead>
            <tr>
              <th>Verfall</th>
              <th className="num">Tage</th>
              <th className="num">ATM-IV</th>
              <th className="num" title={explain("Erwartete Bewegung")}>Erw. Bewegung</th>
              <th className="num col-opt1" title={explain("Skew")}>Skew 25Δ</th>
              <th className="num col-opt2">Put/Call OI</th>
              <th className="num col-opt1" title={explain("Max Pain")}>Max Pain</th>
              <th className="num col-opt2">OI</th>
            </tr>
          </thead>
          <tbody>
            {o.expirations.map((e) => (
              <tr key={e.exp} className={`clickable ${e.exp === f.exp ? "selected" : ""}`} onClick={() => onPick(e.exp)}>
                <td>
                  {fmtDate(e.exp)}
                  {e.monthly ? <span className="dim"> M</span> : ""}
                  {e.earnings ? <span className="lbl" title={`Erster Verfall nach den Quartalszahlen am ${fmtDate(o.earningsDate)} – enthält die Ereignisprämie`}> E</span> : ""}
                </td>
                <td className="num">{e.dte}</td>
                <td className="num">{ivPct(e.atmIv)}</td>
                <td className="num">{e.movePct === null ? "–" : `±${fmt(e.movePct, 1)} %`}</td>
                <td className="num col-opt1">{e.skew25 === null ? "–" : fmt(e.skew25, 1)}</td>
                <td className="num col-opt2">{ratio(e.pcOi)}</td>
                <td className="num col-opt1">{fmtPrice(e.maxPain)}</td>
                <td className="num col-opt2">{fmtBig(e.callOi + e.putOi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const isExpMap = (x: unknown): x is Record<string, string> =>
  !!x && typeof x === "object" && !Array.isArray(x) && Object.values(x).every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));

export function OMON({ ticker }: ScreenProps) {
  const [view, setView] = usePersistentState<(typeof VIEWS)[number]>("omon.view", "overview", isOneOf(VIEWS));
  // gewählter Verfall je Wertpapier, bleibt bei Seitenwechsel und Neuladen erhalten
  const [expMap, setExpMap] = usePersistentState<Record<string, string>>("omon.exp", {}, isExpMap);
  const today = new Date().toISOString().slice(0, 10);
  const stored = ticker ? expMap[ticker] : undefined;
  const exp = stored && stored >= today ? stored : null;
  const setExp = (e: string) => {
    if (!ticker) return;
    setExpMap((m) => {
      const next = { ...m, [ticker]: e };
      for (const k of Object.keys(next)) if (next[k] < today) delete next[k]; // abgelaufene Verfälle aufräumen
      return next;
    });
  };
  const status = useStatus();
  const q = useOptionsOverview(isEquity(ticker) ? ticker : null, exp);
  const o = q.data;
  const openContract = (c: ActiveContract) => {
    setExp(c.exp);
    setView("chain");
  };
  const exps = useMemo(() => o?.expirations ?? [], [o]);
  if (!ticker) return <Empty>Kein Wertpapier gewählt.</Empty>;
  if (!isEquity(ticker)) return <Empty>Optionen gibt es nur für Aktien und ETFs (bei EODHD für US-Werte).</Empty>;
  return (
    <>
      <div className="toolbar">
        <Seg label="Ansicht" value={view} options={[{ value: "overview", label: "Übersicht" }, { value: "chain", label: "Kette" }, { value: "vol", label: "Volatilität" }]} onChange={setView} />
        {exps.length > 0 && (
          <label className="small muted">
            Verfall{" "}
            <select className="field" value={o?.focus?.exp ?? ""} onChange={(e) => setExp(e.target.value)} aria-label="Verfall">
              {exps.map((e) => (
                <option key={e.exp} value={e.exp}>{expLabel(e)}</option>
              ))}
            </select>
          </label>
        )}
        <span className="small muted" style={{ marginLeft: "auto" }} title={status.data?.mode === "demo" ? "Demo: Ketten mit Black-Scholes bzw. Barone-Adesi/Whaley aus dem aktuellen Kurs berechnet; Open Interest und Umsatz gelten für den ganzen Tag" : "Tagesenddaten aus dem EODHD-Marketplace (US Stock Options Data API)"}>
          {[status.data?.mode === "demo" ? "Demo-Kette" : "Tagesenddaten", o?.spot ? `Kurs ${fmtPrice(o.spot)}` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="panel-body" style={{ overflow: "auto" }}>
        {q.isPending ? (
          <Loading rows={10} />
        ) : q.isError && !o ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !o || !o.focus ? (
          <Empty>Keine Optionsdaten.</Empty>
        ) : (
          <>
            {view === "chain" ? <KpiLine o={o} /> : <Kpis o={o} />}
            {view === "overview" ? <OverviewView o={o} onOpen={openContract} /> : view === "chain" ? <ChainView ticker={ticker} exp={o.focus.exp} /> : <VolView o={o} onPick={setExp} />}
          </>
        )}
      </div>
    </>
  );
}
