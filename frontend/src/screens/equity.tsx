// Aktien-Funktionen: DES, HP, FA, ERN, DVD, ANR

import { useState, type ReactNode } from "react";
import { Change, Empty, Kv, Q, Seg, Spark, Table, useNow } from "../components/ui";
import {
  countryDe,
  DASH,
  displayTicker,
  exchangeName,
  fmt,
  fmtBig,
  fmtDate,
  fmtEps,
  fmtInt,
  fmtPct,
  fmtPerShare,
  fmtPrice,
  perShareDigits,
  fmtRatio,
  industryDe,
  isEquity,
  isLiveBar,
  isNum,
  safeUrl,
  sectorDe,
  tone,
} from "../lib/format";
import { useCompany, useDividends, useEarnings, useFinancials, useHistory, useQuotes } from "../lib/queries";
import type { Company, Earnings, StatementRow } from "../lib/types";
import { InstrumentOverview, NotForInstrument } from "./extra";
import type { ScreenProps } from "./types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

const cols: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "4px 18px",
  padding: "4px 10px 12px",
};

function RangeBar({ low, high, value, label }: { low: number | null; high: number | null; value: number | null; label: string }) {
  if (!isNum(low) || !isNum(high) || !isNum(value) || high <= low) return null;
  const pos = Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100));
  return (
    <div style={{ padding: "6px 0 4px" }}>
      <div className="small muted" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{fmtPrice(low)}</span>
        <span>{label}</span>
        <span>{fmtPrice(high)}</span>
      </div>
      <div className="bar-bg" style={{ marginTop: 3 }}>
        <div className="bar-fill" style={{ left: 0, width: `${pos}%`, background: "linear-gradient(90deg, #5a2020, #5a4a10, #1f5a3a)" }} />
        <div className="range-marker" style={{ left: `calc(${pos}% - 1px)` }} title={fmtPrice(value)} />
      </div>
    </div>
  );
}

export function DES({ ticker }: ScreenProps) {
  if (!isEquity(ticker)) return <InstrumentOverview ticker={ticker!} />;
  return <CompanyDES ticker={ticker} />;
}

function CompanyDES({ ticker }: { ticker: string | null }) {
  const q = useCompany(ticker);
  const quote = useQuotes(ticker ? [ticker] : []).data?.[0];
  const [more, setMore] = useState(false);
  return (
    <div className="panel-body">
      <Q q={q} rows={10}>
        {(c: Company) => {
          const price = quote?.last ?? null;
          const upside = isNum(c.analyst.targetPrice) && isNum(price) && price > 0 ? (c.analyst.targetPrice / price - 1) * 100 : null;
          const desc = c.description || "Keine Beschreibung verfügbar.";
          // 52W-Spanne inkl. heutigem Hoch/Tief (Fundamentaldaten werden seltener aktualisiert als Kurse)
          const high52 = isNum(quote?.high) && isNum(c.technicals.high52) ? Math.max(quote.high, c.technicals.high52) : c.technicals.high52;
          const low52 = isNum(quote?.low) && isNum(c.technicals.low52) ? Math.min(quote.low, c.technicals.low52) : c.technicals.low52;
          const website = safeUrl(c.website);
          return (
            <>
              <div style={{ padding: "8px 10px 2px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
                <span style={{ fontSize: "var(--fs-xl)", fontFamily: "var(--sans)", fontWeight: 600 }}>{c.name}</span>
                <span className="lbl">{displayTicker(c.ticker)}</span>
                <span className="muted small">
                  {/* "USA · USD · USA": Börse und Land nur einmal, wenn sie gleich heißen */}
                  {Array.from(new Set([c.exchange ? exchangeName(c.exchange) : null, c.currency, c.country ? countryDe(c.country) : null].filter(Boolean))).join(" · ")}
                </span>
                {price !== null && (
                  <span style={{ marginLeft: "auto", fontSize: "var(--fs-l)" }}>
                    {fmtPrice(price)} <Change value={quote?.changePct} arrowSign />
                  </span>
                )}
              </div>
              <div className="small muted" style={{ padding: "0 10px" }}>
                {sectorDe(c.sector)} › {industryDe(c.industry)}
              </div>
              <div style={{ padding: "0 10px" }}>
                <RangeBar low={low52} high={high52} value={price} label="52-Wochen-Spanne" />
              </div>
              <div style={cols}>
                <Section title="Bewertung">
                  <Kv
                    items={[
                      ["Marktkap.", `${fmtBig(isNum(c.shares.outstanding) && isNum(price) ? c.shares.outstanding * price : c.marketCap)} ${c.currency ?? ""}`],
                      ["Enterprise Value", fmtBig(c.valuation.ev)],
                      ["KGV (TTM)", fmt(c.valuation.pe, 1)],
                      ["KGV erwartet", fmt(c.valuation.forwardPe, 1)],
                      ["PEG", fmt(c.valuation.peg, 2)],
                      ["KUV", fmt(c.valuation.priceSales, 2)],
                      ["KBV", fmt(c.valuation.priceBook, 2)],
                      ["EV/EBITDA", fmt(c.valuation.evEbitda, 1)],
                      ["EV/Umsatz", fmt(c.valuation.evRevenue, 2)],
                    ]}
                  />
                </Section>
                <Section title="Profitabilität & Wachstum">
                  <Kv
                    items={[
                      ["Umsatz (TTM)", fmtBig(c.profitability.revenueTtm)],
                      ["EBITDA (TTM)", fmtBig(c.profitability.ebitda)],
                      ["Nettomarge", fmtRatio(c.profitability.profitMargin)],
                      ["Operative Marge", fmtRatio(c.profitability.operatingMargin)],
                      ["Eigenkapitalrendite", fmtRatio(c.profitability.roe)],
                      ["Gesamtkapitalrendite", fmtRatio(c.profitability.roa)],
                      ["Umsatzwachstum (Q, J/J)", <span className={tone(c.profitability.revenueGrowthYoy)}>{fmtRatio(c.profitability.revenueGrowthYoy)}</span>],
                      ["Gewinnwachstum (Q, J/J)", <span className={tone(c.profitability.earningsGrowthYoy)}>{fmtRatio(c.profitability.earningsGrowthYoy)}</span>],
                    ]}
                  />
                </Section>
                <Section title="Je Aktie">
                  <Kv
                    items={[
                      ["Gewinn je Aktie (TTM)", fmtEps(c.perShare.eps)],
                      ["EPS-Schätzung lfd. Jahr", fmtEps(c.perShare.epsEstimateCy)],
                      ["EPS-Schätzung nächstes Jahr", fmtEps(c.perShare.epsEstimateNy)],
                      ["Buchwert", fmt(c.perShare.bookValue, 2)],
                      ["Dividende", fmt(c.perShare.dividendShare, 2)],
                      ["Dividendenrendite", fmtRatio(c.perShare.dividendYield, 2)],
                    ]}
                  />
                </Section>
                <Section title="Technik & Aktien">
                  <Kv
                    items={[
                      ["Beta", fmt(c.technicals.beta, 2)],
                      ["52W Hoch / Tief", `${fmtPrice(high52)} / ${fmtPrice(low52)}`],
                      ["SMA 50 / 200", `${fmtPrice(c.technicals.ma50)} / ${fmtPrice(c.technicals.ma200)}`],
                      ["Aktien ausstehend", fmtBig(c.shares.outstanding)],
                      ["Streubesitz", fmtBig(c.shares.floatShares)],
                      ["Insider", fmtPct(c.shares.pctInsiders, 1, false)],
                      ["Institutionen", fmtPct(c.shares.pctInstitutions, 1, false)],
                    ]}
                  />
                </Section>
                <Section title="Analysten">
                  <Kv
                    items={[
                      ["Rating (1–5)", fmt(c.analyst.rating, 2)],
                      ["Kursziel", fmtPrice(c.analyst.targetPrice)],
                      ["Potenzial", <Change value={upside} digits={1} />],
                      ["Kauf / Halten / Verk.", `${(c.analyst.strongBuy ?? 0) + (c.analyst.buy ?? 0)} / ${c.analyst.hold ?? 0} / ${(c.analyst.sell ?? 0) + (c.analyst.strongSell ?? 0)}`],
                    ]}
                  />
                </Section>
                <Section title="Unternehmen">
                  <Kv
                    items={[
                      ["Mitarbeiter", fmtInt(c.employees)],
                      ["Börsengang", fmtDate(c.ipoDate)],
                      ["ISIN", c.isin || DASH],
                      ["Daten vom", fmtDate(c.updatedAt)],
                    ]}
                  />
                  {website && (
                    <div className="small" style={{ paddingTop: 4 }}>
                      <a href={website} target="_blank" rel="noreferrer noopener">
                        {website.replace(/^https?:\/\//i, "")}
                      </a>
                    </div>
                  )}
                </Section>
              </div>
              <div style={{ padding: "0 10px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
                <Section title="Beschreibung">
                  <p style={{ margin: "4px 0", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.45, maxWidth: "75ch" }}>
                    {more || desc.length < 420 ? desc : `${desc.slice(0, 400)}… `}
                    {desc.length >= 420 && (
                      <button className="tk" onClick={() => setMore((m) => !m)}>
                        {more ? " weniger" : "mehr"}
                      </button>
                    )}
                  </p>
                </Section>
                <Section title="Management">
                  {c.officers.length ? (
                    <Kv items={c.officers.map((o) => [o.title || "–", o.name] as [ReactNode, ReactNode])} />
                  ) : (
                    <span className="muted small">Keine Angaben.</span>
                  )}
                </Section>
              </div>
            </>
          );
        }}
      </Q>
    </div>
  );
}

export function HP({ ticker }: ScreenProps) {
  const q = useHistory(ticker);
  const quote = useQuotes(ticker ? [ticker] : []).data?.[0];
  const now = useNow(60_000);
  const [n, setN] = useState(250);
  return (
    <div className="panel-body">
      <Q q={q}>
        {(h) => {
          const rows = [];
          for (let i = h.t.length - 1; i >= 0 && rows.length < n; i--) {
            const c = h.c[i];
            const prev = i > 0 ? h.c[i - 1] : null;
            rows.push({
              d: h.t[i], o: h.o[i], h: h.h[i], l: h.l[i], c, v: h.v[i],
              chg: isNum(c) && isNum(prev) && prev !== 0 ? (c / prev - 1) * 100 : null,
              chgBp: isNum(c) && isNum(prev) ? Math.round((c - prev) * 100) : null,
            });
          }
          const isYield = h.ticker.endsWith(".GBOND");
          // Während der Sitzung ist die jüngste Zeile ein laufender Kurs, noch kein Schluss
          const liveDate = isLiveBar(h.t[h.t.length - 1], quote?.timestamp, now) ? h.t[h.t.length - 1] : null;
          // HP gilt für alle Instrumente: Devisen mit Pips (Ticker an fmtPrice), Renditen mit 3 Stellen
          const px = (v: number | null) => (isYield ? fmt(v, 3) : fmtPrice(v, h.ticker));
          return (
            <>
              <Table
                rows={rows}
                rowKey={(r) => r.d}
                columns={[
                  {
                    key: "d",
                    label: "Datum",
                    render: (r) =>
                      r.d === liveDate ? (
                        <span title="Handel läuft: letzter Kurs, noch kein Schlusskurs">
                          {fmtDate(r.d)} <span className="tag">LFD.</span>
                        </span>
                      ) : (
                        fmtDate(r.d)
                      ),
                  },
                  { key: "o", label: "Eröffnung", num: true, render: (r) => px(r.o) },
                  { key: "h", label: "Hoch", num: true, render: (r) => px(r.h) },
                  { key: "l", label: "Tief", num: true, render: (r) => px(r.l) },
                  { key: "c", label: "Schluss", num: true, render: (r) => <b className={r.d === liveDate ? "lbl" : undefined}>{px(r.c)}</b> },
                  {
                    key: "chg",
                    label: isYield ? "Veränd. bp" : "Veränd.",
                    num: true,
                    // Renditen nach der bp-Veränderung sortieren, nicht nach der %-Veränderung
                    sort: (r) => (isYield ? r.chgBp : r.chg),
                    render: (r) => {
                      if (!isYield) return <Change value={r.chg} />;
                      const idx = h.t.indexOf(r.d);
                      const prev = idx > 0 ? h.c[idx - 1] : null;
                      const bp = isNum(r.c) && isNum(prev) ? Math.round((r.c - prev) * 100) : null;
                      return <span className={tone(bp)}>{bp === null ? DASH : `${bp > 0 ? "+" : ""}${bp}`}</span>;
                    },
                  },
                  { key: "v", label: "Volumen", num: true, sort: (r) => r.v, render: (r) => fmtBig(r.v) },
                ]}
              />
              {n < h.t.length && (
                <div style={{ padding: 8 }}>
                  <button className="btn" onClick={() => setN((x) => x + 500)}>
                    Ältere Kurse laden ({fmtInt(h.t.length - n)} weitere)
                  </button>
                </div>
              )}
            </>
          );
        }}
      </Q>
    </div>
  );
}

type Stmt = "income" | "balance" | "cashflow";

function periodLabel(p: string, period: "annual" | "quarterly"): string {
  if (period === "annual") return `GJ ${p.slice(0, 4)}`;
  const m = Number(p.slice(5, 7));
  return `Q${Math.ceil(m / 3)} ${p.slice(2, 4)}`;
}

export function FA({ ticker }: ScreenProps) {
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [stmt, setStmt] = useState<Stmt>("income");
  const q = useFinancials(isEquity(ticker) ? ticker : null, period);
  if (!isEquity(ticker)) return <NotForInstrument fn="FA" />;
  return (
    <>
      <div className="toolbar">
        <Seg
          label="Bericht"
          value={stmt}
          options={[
            { value: "income", label: "GuV" },
            { value: "balance", label: "Bilanz" },
            { value: "cashflow", label: "Cashflow" },
          ]}
          onChange={setStmt}
        />
        <Seg
          label="Periode"
          value={period}
          options={[
            { value: "annual", label: "Jährlich" },
            { value: "quarterly", label: "Quartal" },
          ]}
          onChange={setPeriod}
        />
        {q.data && <span className="small muted">Beträge in Mio. {q.data.currency || ""}</span>}
      </div>
      <div className="panel-body">
        <Q q={q}>
          {(f) => {
            const rows: StatementRow[] = f[stmt];
            if (!f.periods.length || !rows.length) return <Empty>Keine Finanzdaten für diesen Zeitraum.</Empty>;
            const cell = (r: StatementRow, v: number | null) =>
              r.kind === "ratio" ? fmtRatio(v) : isNum(v) ? fmt(v / 1e6, Math.abs(v) < 1e7 ? 1 : 0) : DASH;
            return (
              <table className="t">
                <thead>
                  <tr>
                    <th>Position</th>
                    {f.periods.slice().reverse().map((p) => (
                      <th key={p} className="num" title={fmtDate(p)}>
                        {periodLabel(p, f.period)}
                      </th>
                    ))}
                    <th className="num">Trend</th>
                    <th className="num" title="Neueste Periode gegenüber der vorherigen">{f.period === "annual" ? "Δ J/J" : "Δ Q/Q"}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const latest = r.values[0];
                    const prev = r.values[1];
                    // Vorzeichenwechsel (Verlust -> Gewinn) ergibt keine sinnvolle Prozentveränderung
                    const signFlip = isNum(latest) && isNum(prev) && latest * prev < 0;
                    const delta =
                      r.kind === "ratio"
                        ? isNum(latest) && isNum(prev) ? (latest - prev) * 100 : null
                        : isNum(latest) && isNum(prev) && prev !== 0 && !signFlip ? ((latest - prev) / Math.abs(prev)) * 100 : null;
                    return (
                      <tr key={r.key} className={r.emphasis ? "em" : ""}>
                        <td className={r.kind === "ratio" ? "muted" : ""}>{r.label}</td>
                        {r.values.slice().reverse().map((v, i) => (
                          <td key={i} className={`num ${isNum(v) && v < 0 ? "down" : ""}`}>
                            {cell(r, v)}
                          </td>
                        ))}
                        <td className="num">
                          <Spark data={r.values.slice().reverse().filter(isNum)} width={64} height={14} color="var(--label)" />
                        </td>
                        <td className={`num ${tone(delta)}`}>
                          {signFlip && r.kind !== "ratio" ? <span className="muted" title="Vorzeichenwechsel – Veränderung nicht aussagekräftig">n. a.</span> : delta === null ? DASH : r.kind === "ratio" ? `${delta > 0 ? "+" : ""}${fmt(delta, 1)} Pp` : fmtPct(delta, 1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          }}
        </Q>
      </div>
    </>
  );
}

function EpsChart({ e }: { e: Earnings }) {
  const items = e.history.slice(0, 8).reverse();
  const vals = items.flatMap((i) => [i.epsActual, i.epsEstimate]).filter(isNum);
  if (!vals.length) return null;
  const max = Math.max(...vals, 0);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const W = 520;
  const H = 150;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const bw = (W - pad.l - pad.r) / items.length;
  const y = (v: number) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const ticks = [max, (max + min) / 2, min];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 640, height: "auto", display: "block" }} role="img" aria-label="Gewinn je Aktie: Ist gegen Schätzung">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#1c1c1c" />
          <text x={pad.l - 4} y={y(t) + 3} fill="#8f8f8f" fontSize="9" textAnchor="end">
            {fmt(t, 2)}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#3a3a3a" />
      {items.map((it, i) => {
        const x = pad.l + i * bw + bw * 0.22;
        const w = bw * 0.56;
        const a = it.epsActual;
        const beat = isNum(a) && isNum(it.epsEstimate) ? a >= it.epsEstimate : null;
        return (
          <g key={it.date}>
            {isNum(a) && (
              <rect x={x} width={w} y={Math.min(y(a), y(0))} height={Math.max(1, Math.abs(y(a) - y(0)))} fill={beat === false ? "#ff5252" : "#29d17d"} opacity="0.85">
                <title>{`${it.date}: Ist ${fmtEps(a)} · Schätzung ${fmtEps(it.epsEstimate)}`}</title>
              </rect>
            )}
            {isNum(it.epsEstimate) && <line x1={x - 3} x2={x + w + 3} y1={y(it.epsEstimate)} y2={y(it.epsEstimate)} stroke="#ffa028" strokeWidth="2" />}
            <text x={x + w / 2} y={H - 8} fill="#8f8f8f" fontSize="9" textAnchor="middle">
              {periodLabel(it.date, "quarterly")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ERN({ ticker }: ScreenProps) {
  const q = useEarnings(isEquity(ticker) ? ticker : null);
  if (!isEquity(ticker)) return <NotForInstrument fn="ERN" />;
  return (
    <div className="panel-body">
      <Q q={q}>
        {(e) => (
          <div style={{ padding: "6px 10px" }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "4px 0 8px" }}>
              <div>
                <div className="section-title">Nächster Termin</div>
                {e.next ? (
                  <div style={{ fontSize: "var(--fs-l)" }}>
                    {fmtDate(e.next.reportDate || e.next.date)}{" "}
                    <span className="muted small">{e.next.timing === "BeforeMarket" ? "vor Börseneröffnung" : e.next.timing === "AfterMarket" ? "nach Börsenschluss" : ""}</span>
                    <div className="small muted">EPS-Schätzung: <span className="flat">{fmtEps(e.next.epsEstimate)}</span></div>
                  </div>
                ) : (
                  <span className="muted">Kein Termin bekannt</span>
                )}
              </div>
              <div>
                <div className="section-title">Trefferquote (8 Q.)</div>
                {(() => {
                  const last8 = e.history.slice(0, 8).filter((h) => isNum(h.epsActual) && isNum(h.epsEstimate));
                  const beats = last8.filter((h) => h.epsActual! >= h.epsEstimate!).length;
                  return last8.length ? (
                    <span style={{ fontSize: "var(--fs-l)" }}>
                      {beats} / {last8.length} <span className="muted small">über Schätzung</span>
                    </span>
                  ) : (
                    <span className="muted">–</span>
                  );
                })()}
              </div>
            </div>
            <div className="legend" style={{ padding: "2px 0 4px" }}>
              <span><i style={{ background: "#29d17d", height: 8 }} />Ist (über Schätzung)</span>
              <span><i style={{ background: "#ff5252", height: 8 }} />Ist (unter Schätzung)</span>
              <span><i style={{ background: "#ffa028" }} />Schätzung</span>
            </div>
            <EpsChart e={e} />
            <Table
              rows={e.history}
              rowKey={(r) => r.date}
              columns={[
                { key: "q", label: "Quartal", render: (r) => periodLabel(r.date, "quarterly") },
                { key: "rep", label: "Bericht", render: (r) => fmtDate(r.reportDate) },
                { key: "est", label: "Schätzung", num: true, render: (r) => fmtEps(r.epsEstimate) },
                { key: "act", label: "Ist", num: true, render: (r) => <b>{fmtEps(r.epsActual)}</b> },
                { key: "sur", label: "Überraschung", num: true, sort: (r) => r.surprisePct, render: (r) => <Change value={r.surprisePct} digits={1} /> },
              ]}
            />
          </div>
        )}
      </Q>
    </div>
  );
}

export function DVD({ ticker }: ScreenProps) {
  const q = useDividends(isEquity(ticker) ? ticker : null);
  if (!isEquity(ticker)) return <NotForInstrument fn="DVD" />;
  return (
    <div className="panel-body">
      <Q q={q}>
        {(d) => {
          const byYear = new Map<string, number>();
          d.dividends.forEach((x) => isNum(x.value) && byYear.set(x.exDate.slice(0, 4), (byYear.get(x.exDate.slice(0, 4)) ?? 0) + x.value));
          const years = Array.from(byYear.entries()).sort((a, b) => a[0].localeCompare(b[0]));
          const counts = new Map<string, number>();
          d.dividends.forEach((x) => counts.set(x.exDate.slice(0, 4), (counts.get(x.exDate.slice(0, 4)) ?? 0) + 1));
          const maxCount = Math.max(0, ...counts.values());
          const thisYear = String(new Date().getFullYear());
          // Laufendes Jahr und Jahre mit weniger Zahlungen als üblich (Beginn der Historie) kennzeichnen
          const partialYear = (y: string) => y === thisYear || (counts.get(y) ?? 0) < maxCount;
          // Eine Stellenzahl für alle Beträge, damit die Spalte bündig bleibt (3,3570 neben 4,4171)
          const digits = Math.max(2, ...d.dividends.map((x) => perShareDigits(x.value)));
          const perYear = d.dividends.filter((x) => x.exDate >= `${new Date().getFullYear() - 1}-01-01` && x.exDate < `${new Date().getFullYear()}-01-01`).length;
          return (
            <div style={{ padding: "6px 10px" }}>
              <div style={cols as React.CSSProperties}>
                <Section title="Überblick">
                  <Kv
                    items={[
                      ["Dividende (12 Monate)", fmtPerShare(d.ttm, digits)],
                      ["Rendite (12 Monate)", fmtRatio(d.yieldTtm, 2)],
                      ["Letzter Ex-Tag", fmtDate(d.dividends[0]?.exDate)],
                      ["Zahlungen pro Jahr", perYear ? String(perYear) : DASH],
                    ]}
                  />
                </Section>
                <Section title="Splits">
                  {d.splits.length ? <Kv items={d.splits.map((s) => [fmtDate(s.date), s.ratio] as [ReactNode, ReactNode])} /> : <span className="muted small">Keine Splits.</span>}
                </Section>
              </div>
              {years.length > 1 && (
                <>
                  <div className="section-title">Dividende je Kalenderjahr</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 104, padding: "6px 0" }}>
                    {years.map(([y, v]) => {
                      const max = Math.max(...years.map((x) => x[1]));
                      return (
                        <div key={y} style={{ flex: 1, textAlign: "center", minWidth: 0 }} title={`${y}: ${fmtPerShare(v, digits)}`}>
                          <div className="xs" style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{fmt(v, 2)}</div>
                          <div style={{ height: `${(v / max) * 64}px`, background: "var(--label)", opacity: 0.8 }} />
                          {/* Laufendes Jahr und unvollständiges erstes Jahr kennzeichnen (sonst wirkt es wie eine Kürzung) */}
                          <div className="xs muted" title={partialYear(y) ? "unvollständiges Jahr" : undefined}>
                            {y.slice(2)}
                            {partialYear(y) ? "*" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {d.dividends.length ? (
                <Table
                  rows={d.dividends}
                  // Sonder- und Regeldividende können denselben Ex-Tag haben: Schlüssel eindeutig machen
                  rowKey={(r) => `${r.exDate}|${r.payDate ?? ""}|${r.value ?? ""}`}
                  columns={[
                    { key: "ex", label: "Ex-Tag", render: (r) => fmtDate(r.exDate) },
                    { key: "pay", label: "Zahltag", render: (r) => fmtDate(r.payDate) },
                    { key: "v", label: "Betrag", num: true, render: (r) => `${fmtPerShare(r.value, digits)} ${r.currency || ""}` },
                  ]}
                />
              ) : (
                <Empty>Keine Dividendenzahlungen.</Empty>
              )}
            </div>
          );
        }}
      </Q>
    </div>
  );
}

export function ANR({ ticker }: ScreenProps) {
  const q = useCompany(isEquity(ticker) ? ticker : null);
  const quote = useQuotes(ticker ? [ticker] : []).data?.[0];
  if (!isEquity(ticker)) return <NotForInstrument fn="ANR" />;
  return (
    <div className="panel-body">
      <Q q={q}>
        {(c) => {
          const a = c.analyst;
          const buckets = [
            { label: "Starker Kauf", n: a.strongBuy ?? 0, color: "#1f9d5c" },
            { label: "Kaufen", n: a.buy ?? 0, color: "#29d17d" },
            { label: "Halten", n: a.hold ?? 0, color: "#8f8f8f" },
            { label: "Verkaufen", n: a.sell ?? 0, color: "#ff8a65" },
            { label: "Starker Verkauf", n: a.strongSell ?? 0, color: "#ff5252" },
          ];
          const total = buckets.reduce((s, b) => s + b.n, 0);
          const price = quote?.last ?? null;
          const upside = isNum(a.targetPrice) && isNum(price) && price > 0 ? (a.targetPrice / price - 1) * 100 : null;
          if (!total && !isNum(a.targetPrice)) return <Empty>Keine Analystendaten verfügbar.</Empty>;
          return (
            <div style={{ padding: "8px 10px", maxWidth: 640 }}>
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap", paddingBottom: 10 }}>
                <div>
                  <div className="section-title">Konsens</div>
                  <div style={{ fontSize: "var(--fs-xl)" }}>
                    {isNum(a.rating) ? (a.rating >= 4.2 ? "Kaufen" : a.rating >= 3.4 ? "Übergewichten" : a.rating >= 2.6 ? "Halten" : "Verkaufen") : DASH}
                  </div>
                  <div className="muted small">Rating {fmt(a.rating, 2)} auf Skala 1–5 · {total} Analysten</div>
                </div>
                <div>
                  <div className="section-title">Kursziel</div>
                  <div style={{ fontSize: "var(--fs-xl)" }}>{fmtPrice(a.targetPrice)}</div>
                  <div className="small">
                    <span className="muted">Potenzial </span>
                    <Change value={upside} digits={1} />
                  </div>
                </div>
              </div>
              <div className="section-title">Verteilung</div>
              {buckets.map((b) => (
                <div key={b.label} style={{ display: "grid", gridTemplateColumns: "15ch minmax(0,1fr) 4ch", gap: 8, alignItems: "center", padding: "3px 0" }}>
                  <span className="muted">{b.label}</span>
                  <div className="bar-bg" style={{ height: 10 }}>
                    <div className="bar-fill" style={{ left: 0, width: total ? `${(b.n / total) * 100}%` : 0, background: b.color }} />
                  </div>
                  <span className="num">{b.n}</span>
                </div>
              ))}
            </div>
          );
        }}
      </Q>
    </div>
  );
}
