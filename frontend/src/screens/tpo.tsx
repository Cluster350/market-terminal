// TPO – Market Profile: Buchstabenprofil je Handelstag (30-Minuten-Abschnitte A, B, C …) oder
// Volumen je Preisstufe, mit POC, Value Area (70 %) und Initial Balance (erste Stunde).

import { useEffect, useMemo, useRef } from "react";
import { Empty, ErrorState, Loading, Seg } from "../components/ui";
import { explain } from "../lib/glossary";
import { displayTicker, fmtBig, fmtPrice, fmtTime, fmtWeekday, isNum } from "../lib/format";
import { isBool, isOneOf, usePersistentState } from "../lib/persist";
import { marketProfile, sessionHours, type Candle, type MarketProfile, type TpoSession } from "../lib/profile";
import { useIntraday } from "../lib/queries";
import type { Intraday } from "../lib/types";
import type { ScreenProps } from "./types";

const COUNTS = ["1", "3", "5", "10"] as const;
const RES = ["fein", "mittel", "grob"] as const;
const ROWS: Record<(typeof RES)[number], number> = { fein: 36, mittel: 24, grob: 14 };
const VIEWS = ["tpo", "vol"] as const;

export function candlesOf(d: Intraday | undefined): Candle[] {
  if (!d) return [];
  const out: Candle[] = [];
  d.t.forEach((t, i) => {
    const c = d.c[i];
    if (!isNum(c)) return;
    const o = isNum(d.o[i]) ? d.o[i]! : c;
    const h = Math.max(isNum(d.h[i]) ? d.h[i]! : c, o, c);
    const l = Math.min(isNum(d.l[i]) ? d.l[i]! : c, o, c);
    out.push({ t, open: o, high: h, low: l, close: c, volume: d.v[i] ?? null });
  });
  return out;
}

/** Lage der Eröffnung zur Value Area des Vortags (wichtig für das Tagesszenario). */
export function openVsValue(s: TpoSession, prev: TpoSession | undefined): string {
  if (!prev) return "–";
  if (s.open > prev.vah) return "über VA";
  if (s.open < prev.val) return "unter VA";
  return "in VA";
}

function SessionHead({ s, ticker }: { s: TpoSession; ticker: string }) {
  return (
    <div className="tpo-head" title={`Beginn ${fmtTime(new Date(s.start * 1000))} · ${s.periods} Abschnitte à 30 min`}>
      <b>{fmtWeekday(new Date(s.start * 1000))}</b>
      <span>POC {fmtPrice(s.poc, ticker)}</span>
    </div>
  );
}

function Grid({ mp, ticker, view, last }: { mp: MarketProfile; ticker: string; view: "tpo" | "vol"; last: number | null }) {
  const lo = Math.min(...mp.sessions.map((s) => s.lowIndex));
  const hi = Math.max(...mp.sessions.map((s) => s.highIndex));
  const lastIdx = isNum(last) ? Math.floor((last - mp.base) / mp.step + 1e-9) : null;
  const rows: number[] = [];
  for (let i = hi; i >= lo; i--) rows.push(i);
  // Breite: längste Buchstabenfolge, mindestens so breit wie der Kopf („Mo., 02.11.“ / „POC 147,38“)
  const widths = mp.sessions.map((s) => Math.max(11, ...s.letters.map((l) => l.length + 2)));
  const maxVol = mp.sessions.map((s) => Math.max(...s.volume));
  const lastRow = useRef<HTMLDivElement>(null);
  const key = `${ticker}|${mp.sessions.length}|${mp.step}`;
  useEffect(() => {
    lastRow.current?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const cols = `10ch ${mp.sessions.map((_, k) => (view === "tpo" ? `${widths[k]}ch` : "14ch")).join(" ")}`;
  return (
    <div className="tpo-grid" style={{ gridTemplateColumns: cols }} role="table" aria-label="Market Profile">
      <div className="tpo-corner">Kurs</div>
      {mp.sessions.map((s) => (
        <SessionHead key={s.start} s={s} ticker={ticker} />
      ))}
      {rows.map((i) => {
        const price = mp.price(i);
        const isLast = i === lastIdx;
        return (
          <div key={i} className="tpo-row" role="row">
            {/* Mitte der Preisstufe – so steht der POC (ebenfalls Stufenmitte) mit demselben Wert in der Zeile */}
            <div className={`tpo-price ${isLast ? "last" : ""}`} ref={isLast ? lastRow : undefined} title={`${fmtPrice(price, ticker)} – ${fmtPrice(price + mp.step, ticker)}`}>
              {fmtPrice(price + mp.step / 2, ticker)}
            </div>
            {mp.sessions.map((s, k) => {
              const inSession = i >= s.lowIndex && i <= s.highIndex;
              // Volumen-Ansicht: POC und Value Area nach Volumen, sonst nach Buchstaben
              const [vaLo, vaHi, pocI] = view === "vol" && s.volPocIndex !== null ? [s.volVaLow, s.volVaHigh, s.volPocIndex] : [s.vaLow, s.vaHigh, s.pocIndex];
              const cls = [
                "tpo-cell",
                inSession && i >= vaLo && i <= vaHi ? "va" : "",
                i === pocI ? "poc" : "",
                inSession && Math.floor((s.open - mp.base) / mp.step + 1e-9) === i ? "open" : "",
              ].join(" ");
              const letters = s.letters[i];
              const isClose = inSession && Math.floor((s.close - mp.base) / mp.step + 1e-9) === i;
              if (view === "vol") {
                const v = s.volume[i];
                return (
                  <div key={s.start} className={cls} title={v > 0 ? `${fmtPrice(price, ticker)}: Volumen ${fmtBig(v)}` : undefined}>
                    {v > 0 && <span className="tpo-vbar" style={{ width: `${(v / (maxVol[k] || 1)) * 100}%` }} />}
                    {isClose && <span className="tpo-close">◆</span>}
                  </div>
                );
              }
              // A und B (erste Stunde) bilden die Initial Balance
              const ib = letters.replace(/[^AB]/g, "");
              const rest = letters.replace(/[AB]/g, "");
              return (
                <div key={s.start} className={cls} title={letters ? `${fmtPrice(price, ticker)}: ${letters.length} TPO (${letters})` : undefined}>
                  <span className="tpo-ib">{ib}</span>
                  {rest}
                  {isClose && <span className="tpo-close">◆</span>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function TPO({ ticker }: ScreenProps) {
  const [count, setCount] = usePersistentState<(typeof COUNTS)[number]>("tpo.count", "5", isOneOf(COUNTS));
  const [res, setRes] = usePersistentState<(typeof RES)[number]>("tpo.res", "mittel", isOneOf(RES));
  const [view, setView] = usePersistentState<(typeof VIEWS)[number]>("tpo.view", "tpo", isOneOf(VIEWS));
  const [regular, setRegular] = usePersistentState("tpo.regular", true, isBool);
  const n = Number(count);
  const q = useIntraday(ticker, n);
  const candles = useMemo(() => candlesOf(q.data), [q.data]);
  const mp = useMemo(
    () => (ticker && candles.length ? marketProfile(candles, { ticker, count: n, rowsPerSession: ROWS[res], regular }) : null),
    [candles, ticker, n, res, regular],
  );
  if (!ticker) return <Empty>Kein Wertpapier gewählt.</Empty>;
  const hours = sessionHours(ticker);
  const last = candles.length ? candles[candles.length - 1].close : null;
  const noVolume = view === "vol" && mp && mp.sessions.every((s) => !(s.totalVolume > 0));

  return (
    <>
      <div className="toolbar">
        <Seg label="Handelstage" value={count} options={COUNTS.map((c) => ({ value: c, label: `${c} T` }))} onChange={setCount} />
        <Seg label="Auflösung" value={res} options={RES.map((r) => ({ value: r, label: r }))} onChange={setRes} />
        <Seg label="Ansicht" value={view} options={[{ value: "tpo", label: "Buchstaben" }, { value: "vol", label: "Volumen" }]} onChange={setView} />
        {hours && (
          <label className="check" title="Nur die Haupthandelszeit der Börse, ohne vor- und nachbörslichen Handel">
            <input type="checkbox" checked={regular} onChange={(e) => setRegular(e.target.checked)} />
            nur Haupthandel
          </label>
        )}
        <span className="small muted" style={{ marginLeft: "auto" }} title={explain("Market Profile")}>
          {mp ? `Stufe ${fmtPrice(mp.step, ticker)} · ` : ""}
          <span className="tpo-ib">A B</span> = erste Stunde · <span className="tpo-legend-va">Value Area</span> · <span className="tpo-legend-poc">POC</span> · ◆ Schluss
        </span>
      </div>
      <div className="panel-body tpo-body">
        {q.isPending ? (
          <Loading rows={10} />
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !mp ? (
          <Empty>Keine Intraday-Kurse für {displayTicker(ticker)} (Plan, Handelszeit oder Instrument ohne Intraday-Daten).</Empty>
        ) : (
          <>
            {noVolume && <div className="depot-banner">Für dieses Instrument liefert die Datenquelle kein Volumen – bitte die Buchstaben-Ansicht nutzen.</div>}
            <Grid mp={mp} ticker={ticker} view={view} last={last} />
            <table className="t" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Tag</th>
                  <th className="num">Eröffnung</th>
                  <th className="num">Hoch</th>
                  <th className="num">Tief</th>
                  <th className="num">Schluss</th>
                  <th className="num" title={explain("Initial Balance")}>Erste Stunde</th>
                  <th className="num" title={explain("POC")}>POC</th>
                  <th className="num" title={explain("Value Area")}>Value Area</th>
                  <th className="num col-opt1">Volumen</th>
                  <th className="col-opt2" title="Eröffnung im Vergleich zur Value Area des Vortags">Eröffnung</th>
                </tr>
              </thead>
              <tbody>
                {mp.sessions
                  .map((s, k) => ({ s, prev: mp.sessions[k - 1] }))
                  .reverse()
                  .map(({ s, prev }) => (
                    <tr key={s.start}>
                      <td>{fmtWeekday(new Date(s.start * 1000))}</td>
                      <td className="num">{fmtPrice(s.open, ticker)}</td>
                      <td className="num">{fmtPrice(s.high, ticker)}</td>
                      <td className="num">{fmtPrice(s.low, ticker)}</td>
                      <td className="num">{fmtPrice(s.close, ticker)}</td>
                      <td className="num">{fmtPrice(s.ibLow, ticker)} – {fmtPrice(s.ibHigh, ticker)}</td>
                      <td className="num">{fmtPrice(s.poc, ticker)}</td>
                      <td className="num">{fmtPrice(s.val, ticker)} – {fmtPrice(s.vah, ticker)}</td>
                      <td className="num col-opt1">{s.totalVolume > 0 ? fmtBig(s.totalVolume) : "–"}</td>
                      <td className="col-opt2">{openVsValue(s, prev)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <div className="notes">
              Je Handelstag ein Profil: Jeder Buchstabe steht für 30 Minuten (A = erste halbe Stunde), auf jeder Preisstufe, die in dieser Zeit
              gehandelt wurde. Grundlage sind 5-Minuten-Kerzen{hours ? `; Haupthandel ${Math.floor(hours.open / 60)}:${String(hours.open % 60).padStart(2, "0")}–${Math.floor(hours.close / 60)}:${String(hours.close % 60).padStart(2, "0")} Ortszeit der Börse` : ""}.
            </div>
          </>
        )}
      </div>
    </>
  );
}
