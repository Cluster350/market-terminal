// FWD – Terminkurse: Devisen-Terminkurse, Kosten/Ertrag der Währungsabsicherung und vom
// Anleihemarkt eingepreiste künftige Zinsen. Alles berechnet aus Kassakursen und Zinskurven.

import { lazy, Suspense, useEffect } from "react";
import type { EOption } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg } from "../components/ui";
import { explain } from "../lib/glossary";
import { fmt, fmtDate, fmtPct, tone } from "../lib/format";
import {
  FX_PAIRS,
  HOME_CURRENCIES,
  outrightDigits,
  pairLabel,
  RATE_COUNTRIES,
  TENOR_LABEL,
  useFxForwards,
  useHedge,
  useRateForwards,
} from "../lib/forwards";
import { useIntent } from "../lib/intents";
import { isOneOf, usePersistentState } from "../lib/persist";
import type { ScreenProps } from "./types";

const EChart = lazy(() => import("../components/EChart"));

const VIEWS = ["fx", "hedge", "rates"] as const;
const COUNTRY_NAME: Record<string, string> = { US: "USA", DE: "Deutschland", UK: "Großbritannien", FR: "Frankreich", IT: "Italien", JP: "Japan" };

const AXIS = { axisLine: { lineStyle: { color: "#3a3a3a" } }, axisLabel: { color: "#8f8f8f", fontSize: 10 }, splitLine: { lineStyle: { color: "#171717" } } };
const TIP = { backgroundColor: "#111", borderColor: "#3a3a3a", textStyle: { color: "#ececec", fontSize: 11 } };

const pctOrDash = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "–" : `${fmt(x, d)} %`);
const signedPct = (x: number | null | undefined, d = 2) => fmtPct(x, d);
const bp = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${fmt(x, 0)} bp`);

function Chart({ option, height = 200 }: { option: EOption; height?: number }) {
  return (
    <div style={{ height }}>
      <Suspense fallback={null}>
        <EChart option={option} />
      </Suspense>
    </div>
  );
}

const isPair = (x: unknown): x is string => typeof x === "string" && /^[A-Z]{6}$/.test(x);

/** Devisenpaar aus dem geladenen Ticker (USDJPY Curncy -> USDJPY), sonst null. */
export function pairFromTicker(t: string | null | undefined): string | null {
  const m = t ? /^([A-Z]{6})\.FOREX$/.exec(t) : null;
  return m ? m[1] : null;
}

function FxView({ ticker }: { ticker: string | null }) {
  const [pair, setPair] = usePersistentState<string>("fwd.pair", "EURUSD", isPair);
  const loaded = pairFromTicker(ticker);
  useEffect(() => {
    if (loaded) setPair(loaded); // „USDJPY Curncy FWD“ zeigt USD/JPY (früher blieb das zuletzt gewählte Paar)
  }, [loaded, setPair]);
  const pairs = FX_PAIRS.includes(pair) ? FX_PAIRS : [pair, ...FX_PAIRS];
  const q = useFxForwards(pair);
  const d = q.data;
  const digits = d ? outrightDigits(d.pip) : 5;
  return (
    <>
      <div className="toolbar">
        <label className="small muted">
          Paar{" "}
          <select className="field" value={pair} onChange={(e) => setPair(e.target.value)} aria-label="Devisenpaar">
            {pairs.map((p) => (
              <option key={p} value={p}>{pairLabel(p)}</option>
            ))}
          </select>
        </label>
        {d && (
          <span className="small">
            Kassa <b>{fmt(d.spot, digits)}</b>
            <span className="muted"> · Zins {d.base} 3M {pctOrDash(d.rows[3]?.baseRate)} · {d.quote} 3M {pctOrDash(d.rows[3]?.quoteRate)}</span>
          </span>
        )}
        <span className="small muted" style={{ marginLeft: "auto" }}>{d?.asOf ? `Zinsen ${fmtDate(d.asOf)}` : ""}</span>
      </div>
      {q.isPending ? (
        <Loading rows={8} />
      ) : q.isError && !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? null : d.missing.length ? (
        <Empty>Für {d.missing.join(" und ")} liegen keine kurzen Zinsen vor (Staatsanleihen 3M–2J) – Terminkurse lassen sich nicht berechnen.</Empty>
      ) : (
        <div className="fwd-grid">
          <table className="t">
            <thead>
              <tr>
                <th>Laufzeit</th>
                <th className="num">Zins {d.base}</th>
                <th className="num">Zins {d.quote}</th>
                <th className="num">Terminkurs</th>
                <th className="num" title={explain("Swap-Punkte")}>Swap-Punkte</th>
                <th className="num" title="Auf- (+) oder Abschlag (−) der Basiswährung pro Jahr">{d.base} p. a.</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.tenor}>
                  <td>{TENOR_LABEL[r.tenor] ?? r.tenor}</td>
                  <td className="num">{pctOrDash(r.baseRate)}</td>
                  <td className="num">{pctOrDash(r.quoteRate)}</td>
                  <td className="num"><b>{fmt(r.outright, digits)}</b></td>
                  <td className={`num ${tone(r.points, 1)}`}>{r.points === null ? "–" : `${r.points > 0 ? "+" : ""}${fmt(r.points, 1)}`}</td>
                  <td className={`num ${tone(r.premiumPa, 2)}`}>{signedPct(r.premiumPa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <div className="section-title">Terminkurve {pairLabel(d.pair)}</div>
            <Chart
              option={{
                grid: { left: 54, right: 12, top: 14, bottom: 26 },
                tooltip: {
                  ...TIP, trigger: "axis",
                  formatter: (ps: { data: [number, number] }[]) => {
                    const [x, y] = ps[0]?.data ?? [0, 0];
                    const tenor = x === 0 ? "Kassa" : d.rows.find((r) => Math.abs(r.years - x) < 1e-6)?.tenor ?? `${fmt(x, 2)} J.`;
                    return `${tenor}: ${fmt(y, digits)}`;
                  },
                },
                // Zeitachse in Jahren: 1 Woche ist nicht mehr so breit wie 18 Monate bis 2 Jahre
                xAxis: { type: "value", name: "Jahre", nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, min: 0, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, v % 1 ? 1 : 0) } },
                yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, digits - 1) } },
                series: [{ type: "line", data: [[0, d.spot], ...d.rows.map((r) => [r.years, r.outright])], symbolSize: 5, lineStyle: { color: "#ffa028", width: 1.6 }, itemStyle: { color: "#ffa028" } }],
              }}
            />
            <div className="small muted" style={{ fontFamily: "var(--sans)", lineHeight: 1.45, padding: "4px 2px" }}>
              {d.rows[6]?.premiumPa !== null && d.rows[6]?.premiumPa !== undefined && (
                <>
                  Der {d.base} notiert auf ein Jahr mit {d.rows[6].premiumPa >= 0 ? "Aufschlag" : "Abschlag"} von {fmt(Math.abs(d.rows[6].premiumPa), 2)} % – das entspricht der
                  Zinsdifferenz ({d.quote} {pctOrDash(d.rows[6].quoteRate)} gegen {d.base} {pctOrDash(d.rows[6].baseRate)}). Der Terminkurs ist keine Prognose, sondern der Preis,
                  bei dem sich Zinsunterschiede ausgleichen.
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HedgeView() {
  const [home, setHome] = usePersistentState<(typeof HOME_CURRENCIES)[number]>("fwd.home", "EUR", isOneOf(HOME_CURRENCIES));
  const q = useHedge(home);
  const d = q.data;
  const rows = d ? [...d.rows].sort((a, b) => (a.hedge1yPa ?? 0) - (b.hedge1yPa ?? 0)) : [];
  const maxAbs = Math.max(0.5, ...rows.map((r) => Math.abs(r.hedge1yPa ?? 0)));
  return (
    <>
      <div className="toolbar">
        <Seg label="Heimatwährung" value={home} options={HOME_CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={setHome} />
        {d && <span className="small muted">Zins {home} 3M {pctOrDash(d.homeRate3m)}</span>}
      </div>
      {q.isPending ? (
        <Loading rows={8} />
      ) : q.isError && !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || !rows.length ? (
        <Empty>Keine Zinsdaten für {home}.</Empty>
      ) : (
        <div style={{ padding: "0 8px" }}>
          <table className="t">
            <thead>
              <tr>
                <th>Anlage in</th>
                <th className="num">Zins 3M</th>
                <th className="num" title={explain("Absicherungskosten")}>Absicherung 3M p. a.</th>
                <th className="num">Absicherung 1 J. p. a.</th>
                <th style={{ width: "35%" }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = r.hedge1yPa ?? 0;
                return (
                  <tr key={r.currency}>
                    <td><b>{r.currency}</b></td>
                    <td className="num">{pctOrDash(r.rate3m)}</td>
                    <td className={`num ${tone(r.hedge3mPa, 2)}`}>{signedPct(r.hedge3mPa)}</td>
                    <td className={`num ${tone(r.hedge1yPa, 2)}`}>{signedPct(r.hedge1yPa)}</td>
                    <td>
                      <span className="hedge-bar">
                        <span className={v < 0 ? "neg" : "pos"} style={{ width: `${(Math.abs(v) / maxAbs) * 50}%`, [v < 0 ? "right" : "left"]: "50%" }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d.missing.length > 0 && <div className="small muted">Ohne Zinsdaten: {d.missing.join(", ")}</div>}
          <p className="small muted" style={{ fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, maxWidth: "90ch" }}>
            Wer Anlagen in einer Fremdwährung hält und das Währungsrisiko per Devisentermingeschäft absichert, bekommt (+) oder zahlt (−) ungefähr die
            Zinsdifferenz: Zins der Heimatwährung minus Zins der Fremdwährung. Beispiel: Ein Euro-Anleger mit US-Aktien zahlt bei höheren Dollar-Zinsen
            für die Absicherung; bei Franken- oder Yen-Anlagen bringt sie dagegen Ertrag.
          </p>
        </div>
      )}
    </>
  );
}

function RatesView() {
  const [country, setCountry] = usePersistentState<(typeof RATE_COUNTRIES)[number]>("fwd.country", "US", isOneOf(RATE_COUNTRIES));
  useIntent("FWD", (v) => {
    if (v.country && (RATE_COUNTRIES as readonly string[]).includes(v.country)) setCountry(v.country as (typeof RATE_COUNTRIES)[number]);
  });
  const q = useRateForwards(country);
  const d = q.data;
  return (
    <>
      <div className="toolbar">
        <Seg label="Land" value={country} options={RATE_COUNTRIES.map((c) => ({ value: c, label: c }))} onChange={setCountry} />
        <span className="small muted">{COUNTRY_NAME[country]}{d?.asOf ? ` · Stand ${fmtDate(d.asOf)}` : ""}</span>
      </div>
      {q.isPending ? (
        <Loading rows={8} />
      ) : q.isError && !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || !d.forwards.length ? (
        <Empty>Keine Zinskurve für {COUNTRY_NAME[country]}.</Empty>
      ) : (
        <>
          <div className="kpis">
            {d.keys.map((k) => (
              <div key={k.label} className="kpi" title={`Zins für ${k.length} Jahr(e), beginnend in ${k.start} Jahr(en)`}>
                <div className="kpi-l">{k.label}</div>
                <div className="kpi-v">{pctOrDash(k.rate)}</div>
                <div className={`kpi-s ${tone(k.change1mBp, 0)}`}>{bp(k.change1mBp)} in 1 Monat</div>
              </div>
            ))}
          </div>
          <div className="fwd-grid">
            <div>
              <div className="section-title">Zinskurve heute und Forward-Zinsen</div>
              <Chart
                height={220}
                option={{
                  grid: { left: 42, right: 12, top: 26, bottom: 26 },
                  legend: { top: 0, right: 6, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 2 },
                  tooltip: { ...TIP, trigger: "axis", valueFormatter: (v: number) => `${fmt(v, 3)} %` },
                  xAxis: { type: "value", name: "Jahre", nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, ...AXIS, min: 0 },
                  yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${fmt(v, 1)} %` } },
                  series: [
                    { name: "Rendite heute", type: "line", data: d.spot.map((p) => [p.years, p.rate]), symbolSize: 4, lineStyle: { color: "#66b8ff", width: 1.4 }, itemStyle: { color: "#66b8ff" } },
                    {
                      name: "Forward 1 J.", type: "line", step: "end", symbol: "none", lineStyle: { color: "#ffa028", width: 1.6 }, itemStyle: { color: "#ffa028" },
                      // letzte Stufe bis zum Ende ihres Jahres zeichnen (sonst nur ein senkrechter Strich)
                      data: (() => {
                        const pts = d.forwards.filter((f) => f.rate !== null).map((f) => [f.start, f.rate!]);
                        const last = pts[pts.length - 1];
                        return last ? [...pts, [last[0] + 1, last[1]]] : pts;
                      })(),
                    },
                  ],
                }}
              />
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th title="Einjahreszins, der in so vielen Jahren beginnt">1-J.-Zins ab</th>
                  <th className="num">heute</th>
                  <th className="num">vor 1 Monat</th>
                  <th className="num">Änderung</th>
                </tr>
              </thead>
              <tbody>
                {d.forwards.map((f) => (
                  <tr key={f.start}>
                    <td>{f.start === 0 ? "sofort" : `in ${f.start} J.`}</td>
                    <td className="num"><b>{pctOrDash(f.rate, 3)}</b></td>
                    <td className="num">{pctOrDash(f.rate1m, 3)}</td>
                    <td className={`num ${tone(f.rate !== null && f.rate1m !== null ? f.rate - f.rate1m : null, 2)}`}>
                      {f.rate !== null && f.rate1m !== null ? bp((f.rate - f.rate1m) * 100) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, maxWidth: "90ch", padding: "0 8px" }}>
            Forward-Zinsen zeigen, welche künftigen Zinsen der Anleihemarkt heute einpreist – z. B. 5Y5Y: der Fünfjahreszins in fünf Jahren, ein beliebtes Maß
            für langfristige Zins- und Inflationserwartungen. Sie enthalten eine Laufzeitprämie und sind deshalb keine reine Prognose.
          </p>
        </>
      )}
    </>
  );
}

export function FWD({ ticker }: ScreenProps) {
  const [view, setView] = usePersistentState<(typeof VIEWS)[number]>("fwd.view", "fx", isOneOf(VIEWS));
  const loadedPair = pairFromTicker(ticker);
  useEffect(() => {
    if (loadedPair) setView("fx");
  }, [loadedPair, setView]);
  // „FWD DE“: Land -> Ansicht Zinsen
  useIntent("FWD", (v) => {
    if (v.country) setView("rates");
  });
  return (
    <>
      <div className="toolbar">
        <Seg label="Ansicht" value={view} options={[{ value: "fx", label: "Devisen" }, { value: "hedge", label: "Absicherung" }, { value: "rates", label: "Zinsen" }]} onChange={setView} />
        <span className="small muted" style={{ marginLeft: "auto" }} title={explain("Terminkurs")}>berechnet aus Kassakursen und Zinsen · keine Börsenkurse</span>
      </div>
      <div className="panel-body" style={{ overflow: "auto" }}>
        {view === "fx" ? <FxView ticker={ticker} /> : view === "hedge" ? <HedgeView /> : <RatesView />}
        <div className="notes">
          Terminkurse per gedeckter Zinsparität aus dem Kassakurs und den Renditen kurzlaufender Staatsanleihen (Näherung an die Geldmarktzinsen; am
          Markt kommt ein kleiner Cross-Currency-Basis hinzu). Laufzeiten vereinfacht in Jahren (3 Monate = 0,25), ohne Valutatage. Forward-Zinsen aus
          Nullkuponsätzen, die aus den Anleiherenditen hergeleitet sind. Börsen-Futures (Index, Rohstoffe, Zinsen) sind in den Daten nicht enthalten.
        </div>
      </div>
    </>
  );
}
