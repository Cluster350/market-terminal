// EVTS – Earnings-Kalender, RV – Peer-Vergleich, Übersicht für Nicht-Aktien.

import { useMemo, useState } from "react";
import { Change, Empty, Kv, Q, Seg, TickerLink, useNow } from "../components/ui";
import {
  DASH,
  displayTicker,
  fmt,
  fmtBig,
  fmtBp,
  fmtDate,
  fmtEps,
  fmtPct,
  fmtPrice,
  fmtStamp,
  fmtWeekday,
  isLiveBar,
  isNum,
  sectorDe,
  shiftMonths,
  tone,
} from "../lib/format";
import { useEarningsCalendar, useHistory, usePeers, useQuotes } from "../lib/queries";
import type { EarningsEvent, ScreenRow } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

function quarterLabel(periodEnd: string | null): string {
  if (!periodEnd) return DASH;
  const m = Number(periodEnd.slice(5, 7));
  return `Q${Math.ceil(m / 3)} ${periodEnd.slice(2, 4)}`;
}

const TIMING: Record<string, string> = { BeforeMarket: "vor Eröffnung", AfterMarket: "nach Schluss" };

export function EVTS(_: ScreenProps) {
  const ws = useWorkspace();
  const [week, setWeek] = useState<"-1" | "0" | "1" | "2">("0");
  const [watchOnly, setWatchOnly] = useState(false);
  const [search, setSearch] = useState("");
  const range = weekRange(Number(week));
  const q = useEarningsCalendar(range.from, range.to);
  const today = iso(new Date(useNow(60_000)));

  const rows = useMemo(() => {
    let r = q.data ?? [];
    if (watchOnly) r = r.filter((e) => ws.state.watchlist.includes(e.ticker));
    const s = search.trim().toLowerCase();
    if (s) r = r.filter((e) => e.ticker.toLowerCase().includes(s) || (e.name ?? "").toLowerCase().includes(s));
    return r;
  }, [q.data, watchOnly, search, ws.state.watchlist]);
  const reported = rows.filter((e) => isNum(e.epsActual) && isNum(e.epsEstimate));
  const beats = reported.filter((e) => e.epsActual! >= e.epsEstimate!).length;

  return (
    <>
      <div className="toolbar">
        <Seg
          label="Woche"
          value={week}
          options={[
            { value: "-1", label: "Vorwoche" },
            { value: "0", label: "Diese Woche" },
            { value: "1", label: "Nächste" },
            { value: "2", label: "Übernächste" },
          ]}
          onChange={setWeek}
        />
        <label className="check">
          <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} />
          Nur Watchlist
        </label>
        <input className="field" placeholder="Ticker oder Name" aria-label="Earnings filtern" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 140 }} />
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {fmtDate(range.from)} – {fmtDate(range.to)} · {rows.length} {rows.length === 1 ? "Bericht" : "Berichte"}
          {reported.length ? ` · ${beats}/${reported.length} über Schätzung` : ""}
        </span>
      </div>
      <div className="panel-body">
        <Q q={q}>
          {() =>
            !rows.length ? (
              <Empty>Keine Quartalsberichte in diesem Zeitraum.</Empty>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th>Zeitpunkt</th>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Quartal</th>
                    <th className="num">EPS-Schätzung</th>
                    <th className="num">Ist</th>
                    <th className="num">Überraschung</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e: EarningsEvent, i) => {
                    const header = i === 0 || rows[i - 1].reportDate !== e.reportDate;
                    return (
                      <FragmentWithDay key={`${e.ticker}-${e.reportDate}`} day={header ? e.reportDate : null} today={today}>
                        <tr className="clickable" onClick={() => ws.setSecurity(e.ticker, { open: "ERN" })}>
                          <td className="muted">{TIMING[e.timing ?? ""] ?? DASH}</td>
                          <td>
                            <TickerLink ticker={e.ticker} open="ERN" />
                          </td>
                          <td className="cell-name">{e.name ?? DASH}</td>
                          <td>{quarterLabel(e.periodEnd)}</td>
                          <td className="num">{fmtEps(e.epsEstimate)}</td>
                          <td className="num" style={{ fontWeight: 600 }}>{fmtEps(e.epsActual)}</td>
                          <td className="num">
                            <Change value={e.surprisePct} digits={1} />
                          </td>
                        </tr>
                      </FragmentWithDay>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </Q>
      </div>
    </>
  );
}

function FragmentWithDay({ day, today, children }: { day: string | null; today: string; children: React.ReactNode }) {
  return (
    <>
      {day && (
        <tr className="group">
          <td colSpan={7}>
            {fmtWeekday(day)}
            {day === today ? " · heute" : ""}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

// --- RV -----------------------------------------------------------------------------

const RV_COLS: { key: keyof ScreenRow; label: string; render: (r: ScreenRow) => React.ReactNode; better?: "low" | "high" }[] = [
  { key: "marketCap", label: "Marktkap. (USD)", render: (r) => fmtBig(r.marketCap) },
  { key: "pe", label: "KGV", render: (r) => fmt(r.pe, 1), better: "low" },
  { key: "divYield", label: "Div. %", render: (r) => fmt(r.divYield, 2), better: "high" },
  { key: "chg1d", label: "1T %", render: (r) => <Change value={r.chg1d} /> },
  { key: "perf1m", label: "1M %", render: (r) => <Change value={r.perf1m} digits={1} /> },
  { key: "perf12m", label: "12M %", render: (r) => <Change value={r.perf12m} digits={1} /> },
  { key: "vol1y", label: "Vola %", render: (r) => fmt(r.vol1y, 1), better: "low" },
  { key: "rsi14", label: "RSI", render: (r) => fmt(r.rsi14, 0) },
  { key: "dist52wHigh", label: "52W-H %", render: (r) => <span className={tone(r.dist52wHigh)}>{fmt(r.dist52wHigh, 1)}</span> },
];

export function RV({ ticker }: ScreenProps) {
  const ws = useWorkspace();
  const q = usePeers(ticker, isEquityTicker(ticker));
  if (!isEquityTicker(ticker)) return <NotForInstrument fn="RV" />;
  return (
    <div className="panel-body">
      <Q q={q}>
        {(p) => {
          const own = p.rows[0];
          const rel = (k: keyof ScreenRow) => {
            const a = own[k];
            const m = p.median[k];
            return isNum(a) && isNum(m) && m !== 0 ? (a / m - 1) * 100 : null;
          };
          return (
            <>
              <div className="small muted" style={{ padding: "6px 10px" }}>
                Vergleichsgruppe: {p.basis === "industry" ? "Branche" : "Sektor"}{" "}
                <span className="flat">{p.basis === "sector" ? sectorDe(p.group) : p.group ?? DASH}</span> · {p.rows.length} Werte, sortiert nach Marktkapitalisierung
              </div>
              <table className="t">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    {RV_COLS.map((c) => (
                      <th key={c.key} className="num">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.ticker} className={`clickable ${r.ticker === p.ticker ? "selected" : ""}`} onClick={() => ws.setSecurity(r.ticker)}>
                      <td className="lbl">{displayTicker(r.ticker)}</td>
                      <td className="cell-name">{r.name ?? DASH}</td>
                      {RV_COLS.map((c) => (
                        <td key={c.key} className="num">{c.render(r)}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className="em" style={{ borderTop: "1px solid var(--rule-strong)" }}>
                    <td className="lbl">Median</td>
                    <td className="muted" title="Ungewichteter Median der Vergleichswerte, ohne das Wertpapier selbst">Vergleichswerte</td>
                    {RV_COLS.map((c) => (
                      <td key={c.key} className="num">{c.render(p.median)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: "8px 10px", maxWidth: 560 }}>
                <div className="section-title">{displayTicker(p.ticker)} gegenüber dem Median</div>
                {[
                  { k: "pe" as const, label: "KGV", hint: "niedriger = günstiger" },
                  { k: "divYield" as const, label: "Dividendenrendite", hint: "" },
                  { k: "vol1y" as const, label: "Volatilität", hint: "" },
                ].map(({ k, label, hint }) => {
                  const v = rel(k);
                  const w = isNum(v) ? Math.min(Math.abs(v), 100) / 2 : 0;
                  return (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: "15ch minmax(0,1fr) 9ch", gap: 8, alignItems: "center", padding: "3px 0" }}>
                      <span className="muted" title={hint}>{label}</span>
                      <div className="bar-bg" style={{ height: 8 }}>
                        <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--rule-strong)" }} />
                        {isNum(v) && <div className="bar-fill" style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%`, background: "var(--label)" }} />}
                      </div>
                      <span className="num">{isNum(v) ? fmtPct(v, 0) : DASH}</span>
                    </div>
                  );
                })}
                <div className="small muted" style={{ paddingTop: 4 }}>
                  Performance-Abstand 12M: <Change value={isNum(own.perf12m) && isNum(p.median.perf12m) ? own.perf12m - p.median.perf12m : null} digits={1} pct={false} /> Prozentpunkte
                </div>
              </div>
            </>
          );
        }}
      </Q>
    </div>
  );
}

// --- Nicht-Aktien --------------------------------------------------------------------

function isEquityTicker(t: string | null): boolean {
  return !!t && !/\.(INDX|FOREX|CC|GBOND|COMM)$/.test(t);
}

const KIND: Record<string, string> = { INDX: "Index", FOREX: "Devisen", CC: "Kryptowährung", GBOND: "Staatsanleihe", COMM: "Rohstoff" };

export function NotForInstrument({ fn }: { fn: string }) {
  const ws = useWorkspace();
  return (
    <div className="state">
      <span className="msg">{fn} gibt es nur für Aktien.</span>
      <span>Für Indizes, Devisen, Anleihen und Rohstoffe stehen GP (Chart), HP (Kurshistorie), DES (Übersicht) und CN (News) zur Verfügung.</span>
      <button className="btn" onClick={() => ws.runFn("GP")}>Chart öffnen</button>
    </div>
  );
}

/** DES für Indizes, Devisen, Anleihen und Rohstoffe: Kurs, Spannen, Perioden. */
export function InstrumentOverview({ ticker }: { ticker: string }) {
  const quote = useQuotes([ticker]).data?.[0];
  const hist = useHistory(ticker);
  const exch = ticker.slice(ticker.lastIndexOf(".") + 1);
  const isYield = exch === "GBOND";
  return (
    <div className="panel-body">
      <Q q={hist}>
        {(h) => {
          const closes = h.c;
          const last = quote?.last ?? closes[closes.length - 1] ?? null;
          const lastDate = h.t[h.t.length - 1];
          const base = (iso: string) => {
            let b: number | null = null;
            for (let i = 0; i < h.t.length; i++) {
              if (h.t[i] > iso) break;
              if (isNum(closes[i])) b = closes[i];
            }
            return b;
          };
          const cut = (months: number) => (lastDate ? shiftMonths(lastDate, months) : "");
          const periods: [string, number | null][] = [
            ["1 Monat", base(cut(1))],
            ["3 Monate", base(cut(3))],
            // Laufendes Kalenderjahr, nicht das Jahr des letzten Kurses (am 1.1. sonst Vorjahresperformance)
            ["Seit Jahresbeginn", base(`${Math.max(Number(lastDate?.slice(0, 4)), new Date().getFullYear()) - 1}-12-31`)],
            ["1 Jahr", base(cut(12))],
            ["5 Jahre", base(cut(60))],
          ];
          const yearAgo = cut(12);
          let hi: number | null = null;
          let lo: number | null = null;
          h.t.forEach((d, i) => {
            if (d <= yearAgo) return;
            const H = h.h[i] ?? closes[i];
            const L = h.l[i] ?? closes[i];
            if (isNum(H)) hi = hi === null ? H : Math.max(hi, H);
            if (isNum(L)) lo = lo === null ? L : Math.min(lo, L);
          });
          return (
            <div style={{ padding: "8px 10px", maxWidth: 640 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: "var(--fs-xl)", fontFamily: "var(--sans)", fontWeight: 600 }}>{quote?.name ?? displayTicker(ticker)}</span>
                <span className="lbl">{displayTicker(ticker)}</span>
                <span className="muted small">{KIND[exch] ?? exch}</span>
                <span style={{ marginLeft: "auto", fontSize: "var(--fs-l)" }}>
                  {isYield ? `${fmt(last, 3)} %` : fmtPrice(last, ticker)}{" "}
                  {isYield ? (
                    <span className={tone(quote?.change, 2)}>{isNum(quote?.change) ? fmtBp(quote!.change) : ""}</span>
                  ) : (
                    <Change value={quote?.changePct} arrowSign />
                  )}
                </span>
              </div>
              <div className="section-title" style={{ marginTop: 10 }}>Veränderung</div>
              <Kv
                items={periods.map(([label, b]) => [
                  label,
                  isYield ? (
                    <span className={tone(isNum(last) && isNum(b) ? last - b : null, 2)}>
                      {isNum(last) && isNum(b) ? fmtBp(last - b) : DASH}
                    </span>
                  ) : (
                    <Change value={isNum(last) && isNum(b) && b !== 0 ? (last / b - 1) * 100 : null} />
                  ),
                ])}
              />
              <div className="section-title" style={{ marginTop: 10 }}>52 Wochen</div>
              <Kv
                items={[
                  ["Hoch", isYield ? `${fmt(hi, 3)} %` : fmtPrice(hi, ticker)],
                  ["Tief", isYield ? `${fmt(lo, 3)} %` : fmtPrice(lo, ticker)],
                  ["Kursdaten seit", fmtDate(h.t[0])],
                  isLiveBar(lastDate, quote?.timestamp)
                    ? ["Letzter Kurs", `${fmtStamp(quote?.timestamp)} (Handel läuft)`]
                    : ["Letzter Schluss", fmtDate(lastDate)],
                ]}
              />
              <p className="small muted">Unternehmensdaten (Bilanz, Earnings, Dividenden) gibt es nur für Aktien.</p>
            </div>
          );
        }}
      </Q>
    </div>
  );
}

export { isEquityTicker };
