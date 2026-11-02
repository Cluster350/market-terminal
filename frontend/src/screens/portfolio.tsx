// PORT – Depot (Positionen, Wert, Ergebnis, Aufteilung) und RISK – Depot-Risiko.
// Das Depot liegt als Datei auf dem Rechner (Backend); jede Änderung wird sofort gespeichert.

import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Empty, ErrorState, Loading, Table, TickerLink, type Column } from "../components/ui";
import { ApiError, IS_STATIC } from "../lib/api";
import { normalizeTicker } from "../lib/commands";
import { explain } from "../lib/glossary";
import { displayTicker, fmt, fmtDate, fmtPct, fmtPrice, fmtShortDate, fmtSigned, isNum, sectorDe, tone } from "../lib/format";
import {
  BASES,
  mergePosition,
  parseCsv,
  parseDate,
  parseNumber,
  portfolioApi,
  toCsv,
  usePortfolio,
  usePortfolioAnalytics,
  type Analytics,
  type Base,
  type Portfolio,
  type Position,
  type PositionRow,
} from "../lib/portfolio";
import type { ScreenProps } from "./types";

const EChart = lazy(() => import("../components/EChart"));

const money = (x: number | null | undefined) => fmt(x, 0);
const moneySigned = (x: number | null | undefined) => fmtSigned(x, 0);
const fmtQty = (x: number) => (Number.isInteger(x) ? fmt(x, 0) : fmt(x, 4).replace(/0+$/, "").replace(/,$/, ""));

function Kpi({ label, value, sub, cls, title }: { label: string; value: ReactNode; sub?: ReactNode; cls?: string; title?: string }) {
  return (
    <div className="kpi" title={title}>
      <div className="kpi-l">{label}</div>
      <div className={`kpi-v ${cls ?? ""}`}>{value}</div>
      {sub !== undefined && <div className="kpi-s">{sub}</div>}
    </div>
  );
}

/** Speichern mit Konfliktbehandlung (anderes Fenster hat inzwischen gespeichert). */
function useDepotSave() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(next: Portfolio): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const saved = await portfolioApi.save(next);
      qc.setQueryData(["portfolio"], saved);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await qc.invalidateQueries({ queryKey: ["portfolio"] });
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, error, setError };
}

// --- Formular für eine Position ----------------------------------------------------------

interface Draft {
  id: string | null;
  ticker: string;
  quantity: string;
  cost: string;
  opened: string;
  note: string;
}

const emptyDraft: Draft = { id: null, ticker: "", quantity: "", cost: "", opened: "", note: "" };

function draftOf(p: Position): Draft {
  const num = (x: number | null) => (x === null ? "" : String(x).replace(".", ","));
  return { id: p.id, ticker: displayTicker(p.ticker), quantity: num(p.quantity), cost: num(p.cost), opened: p.opened ?? "", note: p.note };
}

function PositionForm({ draft, onChange, onSubmit, onCancel, busy, price }: {
  draft: Draft; onChange: (d: Draft) => void; onSubmit: () => void; onCancel: () => void; busy: boolean; price?: string;
}) {
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [k]: e.target.value });
  return (
    <form
      className="depot-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <label>
        Ticker
        <input className="field" value={draft.ticker} onChange={set("ticker")} disabled={!!draft.id} placeholder="z. B. SAP GR" autoFocus={!draft.id} style={{ width: "13ch" }} />
      </label>
      <label>
        Stück
        <input className="field" value={draft.quantity} onChange={set("quantity")} inputMode="decimal" placeholder="−: Leerverkauf" autoFocus={!!draft.id} style={{ width: "11ch" }} />
      </label>
      <label>
        Einstandskurs
        <input className="field" value={draft.cost} onChange={set("cost")} inputMode="decimal" placeholder={price ?? "je Stück"} style={{ width: "11ch" }} />
      </label>
      <label>
        Kaufdatum
        <input className="field" type="date" value={draft.opened} onChange={set("opened")} style={{ width: "15ch" }} />
      </label>
      <label style={{ flex: 1, minWidth: "14ch" }}>
        Notiz
        <input className="field" value={draft.note} onChange={set("note")} maxLength={200} style={{ width: "100%" }} />
      </label>
      <button type="submit" className="btn primary" disabled={busy}>
        {draft.id ? "Speichern" : "Hinzufügen"}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        Abbrechen
      </button>
    </form>
  );
}

function readDraft(d: Draft): { position?: Position; error?: string } {
  const ticker = normalizeTicker(d.ticker);
  if (!ticker) return { error: "Ticker nicht erkannt (z. B. SAP GR, AAPL US, VOD LN)." };
  const quantity = parseNumber(d.quantity);
  if (quantity === null || quantity === 0) return { error: "Bitte eine Stückzahl eingeben (negativ für Leerverkauf)." };
  const cost = d.cost.trim() ? parseNumber(d.cost) : null;
  if (d.cost.trim() && (cost === null || cost <= 0)) return { error: "Einstandskurs muss eine Zahl größer 0 sein." };
  const opened = d.opened.trim() ? parseDate(d.opened) : null;
  if (d.opened.trim() && !opened) return { error: "Kaufdatum bitte als TT.MM.JJJJ." };
  return { position: { id: d.id ?? "", ticker, quantity, cost, opened, currency: null, note: d.note.trim() } };
}

// --- Import ------------------------------------------------------------------------------

function ImportBox({ portfolio, onDone, save, busy }: { portfolio: Portfolio; onDone: (msg: string) => void; save: (p: Portfolio) => Promise<boolean>; busy: boolean }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">("add");
  const parsed = useMemo(() => parseCsv(text), [text]);
  async function apply() {
    let positions = mode === "replace" ? [] : portfolio.positions;
    for (const p of parsed.positions) positions = mergePosition(positions, p).positions;
    if (positions.length > 200) return onDone("Höchstens 200 Positionen.");
    if (await save({ ...portfolio, positions })) onDone(`${parsed.positions.length} Positionen übernommen.`);
  }
  return (
    <div className="depot-import">
      <div className="small muted">
        Eine Zeile je Position: <code>Ticker; Stück; Einstandskurs; Kaufdatum; Notiz</code> – z. B. <code>SAP GR; 20; 182,50; 15.03.2024</code>. Kurs, Datum
        und Notiz sind freiwillig. Kopieren aus Excel (Tabulator) geht auch.
      </div>
      <textarea className="field" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Depotliste einfügen" placeholder={"NWND US; 40; 120,50; 02.01.2025\nSAP GR; 20"} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="small">{parsed.positions.length} Positionen erkannt</span>
        <label className="check">
          <input type="radio" checked={mode === "add"} onChange={() => setMode("add")} /> hinzufügen
        </label>
        <label className="check">
          <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Depot ersetzen
        </label>
        <button className="btn primary" disabled={!parsed.positions.length || busy} onClick={apply}>
          Übernehmen
        </button>
        <button className="btn" onClick={() => onDone("")}>
          Schließen
        </button>
      </div>
      {parsed.errors.length > 0 && (
        <ul className="small down" style={{ margin: 0, paddingLeft: 16 }}>
          {parsed.errors.slice(0, 8).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }); // BOM: Excel erkennt UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Aufteilung ----------------------------------------------------------------------------

function Bars({ title, slices, label }: { title: string; slices: { key: string; weight: number; value: number }[]; label?: (k: string) => string }) {
  const max = Math.max(...slices.map((s) => Math.abs(s.weight)), 1);
  return (
    <div className="alloc">
      <div className="section-title">{title}</div>
      {slices.slice(0, 8).map((s) => (
        <div key={s.key} className="alloc-row" title={`${label ? label(s.key) : s.key}: ${fmtPct(s.weight, 1, false)}`}>
          <span className="alloc-k">{label ? label(s.key) : s.key}</span>
          <span className="alloc-bar">
            <span style={{ width: `${(Math.abs(s.weight) / max) * 100}%` }} className={s.weight < 0 ? "neg" : ""} />
          </span>
          <span className="alloc-v">{fmtPct(s.weight, 1, false)}</span>
        </div>
      ))}
    </div>
  );
}

// --- PORT --------------------------------------------------------------------------------

export function PORT(_: ScreenProps) {
  const pq = usePortfolio();
  const p = pq.data;
  const aq = usePortfolioAnalytics(p?.version);
  const { save, busy, error, setError } = useDepotSave();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [cashText, setCashText] = useState<string | null>(null);

  if (pq.isPending) return <Loading rows={8} />;
  if (pq.isError || !p) return <ErrorState error={pq.error} onRetry={() => pq.refetch()} />;
  const a = aq.data; // nach dem Speichern bis zur Neuberechnung der vorige Stand
  const rowsById = new Map((a?.rows ?? []).map((r) => [r.id, r]));

  async function submitDraft() {
    if (!draft || !p) return;
    const { position, error: err } = readDraft(draft);
    if (!position) return setFormError(err ?? null);
    let positions: Position[];
    let merged = false;
    if (draft.id) positions = p.positions.map((x) => (x.id === draft.id ? { ...position, id: x.id, ticker: x.ticker, currency: x.currency } : x));
    else ({ positions, merged } = mergePosition(p.positions, position));
    if (await save({ ...p, positions })) {
      setDraft(null);
      setFormError(null);
      setInfo(merged ? `${displayTicker(position.ticker)}: zur bestehenden Position addiert (Durchschnittskurs).` : null);
    }
  }

  async function remove(id: string) {
    if (!p) return;
    setConfirmDel(null);
    await save({ ...p, positions: p.positions.filter((x) => x.id !== id) });
  }

  async function saveCash() {
    if (cashText === null || !p) return;
    const cash = cashText.trim() ? parseNumber(cashText) : 0;
    setCashText(null);
    if (cash === null) return setError("Kasse: bitte einen Betrag eingeben.");
    if (cash !== p.cash) await save({ ...p, cash });
  }

  const columns: Column<PositionRow>[] = [
    {
      key: "t", label: "Wertpapier", sort: (r) => r.ticker,
      render: (r) => (
        <span title={r.name ?? undefined}>
          <TickerLink ticker={r.ticker} open="GP" />
          {r.issue && <span className="down" title={r.issue}> ⚠</span>}
        </span>
      ),
    },
    {
      key: "n", label: "Name", className: "col-opt0", sort: (r) => r.name ?? "",
      render: (r) => (r.issue ? <span className="down" title={r.issue}>⚠ {r.issue}</span> : <span className="muted" title={r.note || undefined}>{r.name ?? "–"}{r.note ? " ✎" : ""}</span>),
    },
    { key: "q", label: "Stück", num: true, sort: (r) => r.quantity, render: (r) => fmtQty(r.quantity) },
    { key: "c", label: "Einstand", num: true, className: "col-opt1", sort: (r) => r.cost, render: (r) => <span title={r.opened ? `Kauf am ${fmtDate(r.opened)}` : undefined}>{fmtPrice(r.cost)}</span> },
    {
      key: "p", label: "Kurs", num: true, sort: (r) => r.price,
      render: (r) => (
        <>
          {fmtPrice(r.price, r.ticker)} <span className="dim xs">{r.currency === "GBX" ? "GBp" : r.currency}</span>
        </>
      ),
    },
    { key: "d", label: "Tag", num: true, className: "col-opt2", sort: (r) => r.changePct, render: (r) => <span className={tone(r.changePct, 2)}>{fmtPct(r.changePct)}</span> },
    { key: "v", label: `Wert ${p.base}`, num: true, sort: (r) => r.value, render: (r) => money(r.value) },
    { key: "w", label: "Gewicht", num: true, sort: (r) => r.weight, render: (r) => fmtPct(r.weight, 1, false) },
    {
      key: "g", label: `G/V ${p.base}`, num: true, sort: (r) => r.pnl, title: "Ergebnis seit Kauf in Basiswährung (mit Währungseffekt, wenn ein Kaufdatum eingetragen ist)",
      render: (r) => (
        <span className={tone(r.pnl, 0)} title={isNum(r.pnlPct) ? `In Handelswährung ${fmtPct(r.pnlPct, 1)}` : undefined}>
          {moneySigned(r.pnl)} <span className="xs">{fmtPct(r.pnlPctBase, 1)}</span>
        </span>
      ),
    },
    {
      key: "x", label: "", render: (r) => {
        const pos = p.positions.find((x) => x.id === r.id);
        if (!pos || IS_STATIC) return null;
        return confirmDel === r.id ? (
          <button className="tool danger-tool" onClick={() => remove(r.id)} title="Position endgültig löschen" autoFocus onBlur={() => setConfirmDel(null)}>
            löschen?
          </button>
        ) : (
          <span style={{ whiteSpace: "nowrap" }}>
            <button className="tool" title="Bearbeiten" onClick={() => { setDraft(draftOf(pos)); setFormError(null); }}>✎</button>
            <button className="tool" title="Löschen" onClick={() => setConfirmDel(r.id)}>✕</button>
          </span>
        );
      },
    },
  ];

  const s = a?.summary;
  // Positionen, die noch nicht berechnet sind (gerade gespeichert), trotzdem zeigen
  const tableRows: PositionRow[] = p.positions.map((pos) => rowsById.get(pos.id) ?? {
    id: pos.id, ticker: pos.ticker, name: null, quantity: pos.quantity, cost: pos.cost, opened: pos.opened, note: pos.note, currency: pos.currency,
    price: null, changePct: null, fx: null, value: null, weight: null, dayPnl: null, pnl: null, pnlPct: null, pnlPctBase: null,
    sector: null, country: null, vol: null, beta: null, riskShare: null, issue: null,
  });
  return (
    <>
      <div className="toolbar">
        <span className="lbl">DEPOT</span>
        <label className="small muted" title="Alle Beträge in dieser Währung">
          Basis{" "}
          <select className="field" value={p.base} disabled={busy || IS_STATIC} onChange={(e) => save({ ...p, base: e.target.value as Base })}>
            {BASES.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className="small muted" title="Bargeld bzw. Verrechnungskonto in Basiswährung">
          Kasse{" "}
          <input
            className="field"
            style={{ width: "11ch", textAlign: "right" }}
            value={cashText ?? fmt(p.cash, 0)}
            disabled={IS_STATIC}
            onFocus={() => setCashText(String(p.cash).replace(".", ","))}
            onChange={(e) => setCashText(e.target.value)}
            onBlur={saveCash}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Kasse"
          />
        </label>
        {!IS_STATIC && (
          <>
            <button className="btn primary" onClick={() => { setDraft(emptyDraft); setFormError(null); setImporting(false); }} disabled={busy}>
              ＋ Position
            </button>
            <button className="btn" onClick={() => { setImporting((x) => !x); setDraft(null); }}>
              Import
            </button>
          </>
        )}
        <button className="btn" onClick={() => download(`depot-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(p))} disabled={!p.positions.length}>
          Export CSV
        </button>
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {busy ? "speichert …" : aq.isFetching ? "rechnet …" : a?.asOf ? `Kurse ${fmtShortDate(a.asOf)}` : ""}
        </span>
      </div>
      <div className="panel-body" style={{ overflow: "auto" }}>
        {p.sample && (
          <div className="depot-banner">
            Muster-Depot zum Ausprobieren (Demo-Daten). Sobald Sie etwas ändern, wird es als Ihr Depot gespeichert.
          </div>
        )}
        {(error || info) && <div className={`depot-banner ${error ? "err" : ""}`}>{error ?? info}</div>}
        {draft && (
          <>
            <PositionForm
              draft={draft}
              onChange={setDraft}
              onSubmit={submitDraft}
              onCancel={() => { setDraft(null); setFormError(null); }}
              busy={busy}
              price={draft.id ? undefined : "aktueller Kurs"}
            />
            {formError && <div className="depot-banner err">{formError}</div>}
          </>
        )}
        {importing && <ImportBox portfolio={p} save={save} busy={busy} onDone={(msg) => { setImporting(false); setInfo(msg || null); }} />}
        {s && (
          <div className="kpis">
            <Kpi label={`Depotwert ${p.base}`} value={money(s.value)} sub={`davon Kasse ${money(s.cash)}`} />
            <Kpi label="Heute" value={moneySigned(s.dayPnl)} sub={fmtPct(s.dayPnlPct)} cls={tone(s.dayPnl, 0)} />
            <Kpi label="Seit Kauf" value={moneySigned(s.pnl)} sub={s.invested ? `${fmtPct(s.pnlPct)} auf ${money(s.invested)}` : "ohne Einstandskurse"} cls={tone(s.pnl, 0)} />
            <Kpi label="Positionen" value={String(s.count)} sub={a?.risk.largest ? `größte ${displayTicker(a.risk.largest)} ${fmtPct(a.risk.largestWeight, 1, false)}` : undefined} />
          </div>
        )}
        {!p.positions.length ? (
          <Empty>
            Noch keine Positionen. Mit <b className="lbl">＋ Position</b> eintragen oder mit <b className="lbl">Import</b> eine Liste einfügen.
          </Empty>
        ) : (
          <Table rows={tableRows} columns={columns} rowKey={(r) => r.id} initialSort={{ key: "v", desc: true }} />
        )}
        {aq.isError && <ErrorState error={aq.error} onRetry={() => aq.refetch()} />}
        {a && a.rows.length > 0 && (
          <div className="alloc-grid">
            <Bars title="Branchen" slices={a.allocation.sector ?? []} label={(k) => (k === "Kasse" || k === "Unbekannt" ? k : sectorDe(k))} />
            <Bars title="Länder (Börse)" slices={a.allocation.country ?? []} />
            <Bars title="Währungen" slices={a.allocation.currency ?? []} />
          </div>
        )}
        {a && a.notes.length > 0 && (
          <div className="notes">
            {a.notes.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// --- RISK --------------------------------------------------------------------------------

const BENCHMARKS: [string, string][] = [
  ["GSPC.INDX", "S&P 500"], ["NDX.INDX", "Nasdaq 100"], ["GDAXI.INDX", "DAX"], ["MDAXI.INDX", "MDAX"], ["STOXX50E.INDX", "Euro Stoxx 50"],
  ["FCHI.INDX", "CAC 40"], ["FTSE.INDX", "FTSE 100"], ["SSMI.INDX", "SMI"], ["N225.INDX", "Nikkei 225"],
];

/** Farbe einer Korrelation: blau (negativ) – grau (0) – orange (positiv). */
export function corrColor(c: number | null): string {
  if (c === null) return "transparent";
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `rgba(255, 128, 0, ${0.08 + a * 0.62})` : `rgba(102, 184, 255, ${0.08 + a * 0.62})`;
}

function CorrelationTable({ a }: { a: Analytics }) {
  const { tickers, matrix } = a.correlation;
  if (tickers.length < 2) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="corr" aria-label="Korrelationen der Tagesrenditen">
        <thead>
          <tr>
            <th />
            {tickers.map((t) => (
              <th key={t} title={displayTicker(t)}>{t.split(".")[0]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tickers.map((t, i) => (
            <tr key={t}>
              <th title={displayTicker(t)}>{t.split(".")[0]}</th>
              {matrix[i].map((c, j) => (
                <td key={j} style={{ background: i === j ? "#1c1c1c" : corrColor(c) }} title={`${displayTicker(t)} / ${displayTicker(tickers[j])}: ${fmt(c, 2)}`}>
                  {i === j ? "" : fmt(c, 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RISK(_: ScreenProps) {
  const pq = usePortfolio();
  const p = pq.data;
  const aq = usePortfolioAnalytics(p?.version);
  const { save, busy, error } = useDepotSave();
  if (pq.isPending || (p && p.positions.length && aq.isPending)) return <Loading rows={8} />;
  if (pq.isError || !p) return <ErrorState error={pq.error} onRetry={() => pq.refetch()} />;
  if (!p.positions.length) return <Empty>Das Depot ist leer. Positionen in PORT eintragen, dann erscheint hier das Risiko.</Empty>;
  if (aq.isError || !aq.data) return <ErrorState error={aq.error} onRetry={() => aq.refetch()} />;
  const a = aq.data;
  const r = a.risk;
  const bench = a.benchmarkName ?? "Index";
  const riskRows = a.rows.filter((x) => isNum(x.riskShare));
  const maxShare = Math.max(1, ...riskRows.map((x) => Math.abs(x.riskShare ?? 0)));

  const option = {
    grid: { left: 42, right: 12, top: 26, bottom: 22 },
    legend: { top: 0, right: 6, textStyle: { color: "#8f8f8f", fontSize: 10 }, itemHeight: 2 },
    tooltip: { trigger: "axis", backgroundColor: "#111", borderColor: "#3a3a3a", textStyle: { color: "#ececec", fontSize: 11 }, valueFormatter: (v: number) => fmt(v, 1) },
    xAxis: {
      type: "category", data: a.series.t, boundaryGap: false,
      axisLine: { lineStyle: { color: "#3a3a3a" } }, axisLabel: { color: "#8f8f8f", fontSize: 10, formatter: (v: string) => fmtShortDate(v) },
    },
    yAxis: { type: "value", scale: true, splitLine: { lineStyle: { color: "#171717" } }, axisLabel: { color: "#8f8f8f", fontSize: 10 } },
    series: [
      { name: "Depot", type: "line", data: a.series.portfolio, showSymbol: false, lineStyle: { width: 1.6, color: "#ffa028" }, itemStyle: { color: "#ffa028" } },
      ...(a.series.benchmark.length
        ? [{ name: `${bench} (${a.base})`, type: "line", data: a.series.benchmark, showSymbol: false, lineStyle: { width: 1, color: "#66b8ff" }, itemStyle: { color: "#66b8ff" } }]
        : []),
    ],
  };

  const columns: Column<PositionRow>[] = [
    { key: "t", label: "Wertpapier", sort: (x) => x.ticker, render: (x) => <TickerLink ticker={x.ticker} open="GP" /> },
    { key: "w", label: "Gewicht", num: true, sort: (x) => x.weight, render: (x) => fmtPct(x.weight, 1, false) },
    { key: "v", label: "Schwankung", num: true, sort: (x) => x.vol, title: explain("Schwankung (Volatilität)"), render: (x) => fmtPct(x.vol, 1, false) },
    { key: "b", label: "Beta", num: true, className: "col-opt2", sort: (x) => x.beta, title: explain("Beta"), render: (x) => fmt(x.beta, 2) },
    {
      key: "r", label: "Risikoanteil", num: true, sort: (x) => x.riskShare, title: explain("Risikoanteil"),
      render: (x) => (
        <span className="risk-cell">
          <span className="risk-bar"><span style={{ width: `${Math.max(0, ((x.riskShare ?? 0) / maxShare) * 100)}%` }} /></span>
          {fmtPct(x.riskShare, 1, false)}
        </span>
      ),
    },
    {
      key: "q", label: "Risiko/Gewicht", num: true, className: "col-opt1", title: "Über 1: Die Position trägt mehr zum Risiko bei, als ihr Gewicht vermuten lässt.",
      sort: (x) => (x.weight ? (x.riskShare ?? 0) / x.weight : null),
      render: (x) => {
        const q = x.weight ? (x.riskShare ?? 0) / x.weight : null;
        return <span className={isNum(q) && q > 1.3 ? "down" : ""}>{fmt(q, 2)}</span>;
      },
    },
  ];

  return (
    <>
      <div className="toolbar">
        <span className="lbl">RISIKO</span>
        <label className="small muted" title="Vergleichsindex für Beta und Wertentwicklung (in Basiswährung umgerechnet)">
          Vergleich{" "}
          <select
            className="field"
            value={p.benchmark ?? ""}
            disabled={busy || IS_STATIC}
            onChange={(e) => save({ ...p, benchmark: e.target.value || null })}
          >
            <option value="">Automatisch ({p.benchmark ? "Schwerpunkt" : bench})</option>
            {BENCHMARKS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <span className="small muted">1 Jahr · {r.days} Handelstage · {a.base}</span>
        {error && <span className="small down">{error}</span>}
        <span className="small muted" style={{ marginLeft: "auto" }}>{aq.isFetching ? "rechnet …" : ""}</span>
      </div>
      <div className="panel-body" style={{ overflow: "auto" }}>
        {!r.days ? (
          <Empty>Für Risikokennzahlen fehlt die Kurshistorie (mindestens 60 Handelstage). Hinweise siehe PORT.</Empty>
        ) : (
          <>
            <div className="kpis">
              <Kpi label="Schwankung p. a." value={fmtPct(r.vol, 1, false)} sub={`${bench} ${fmtPct(r.benchVol, 1, false)}`} title={explain("Schwankung (Volatilität)")} />
              <Kpi label={`Beta zum ${bench}`} value={fmt(r.beta, 2)} sub={isNum(r.beta) ? (r.beta > 1.1 ? "stärker als Index" : r.beta < 0.9 ? "ruhiger als Index" : "wie der Index") : undefined} title={explain("Beta")} />
              <Kpi label="Größter Rückgang" value={fmtPct(r.maxDrawdown, 1)} cls="down" sub={r.drawdownPeak ? `${fmtShortDate(r.drawdownPeak)} – ${fmtShortDate(r.drawdownTrough)}` : undefined} title={explain("Max. Drawdown")} />
              <Kpi label="VaR 95 % · 1 Tag" value={`${money(r.var95)} ${a.base}`} sub={`${fmtPct(r.var95Pct, 2, false)} des Depots`} title={explain("Value at Risk")} />
              <Kpi label="Expected Shortfall" value={`${money(r.es95)} ${a.base}`} sub="Ø schlechteste 5 % Tage" title={explain("Expected Shortfall")} />
              <Kpi label="Rendite 1 Jahr" value={fmtPct(r.return1y, 1)} cls={tone(r.return1y, 1)} sub={`${bench} ${fmtPct(r.benchReturn1y, 1)}`} />
              <Kpi label="Streuung" value={`${fmt(r.effectiveN, 1)} Pos.`} sub={`Top 5 = ${fmtPct(r.top5Weight, 0, false)}`} title={explain("Effektive Positionen")} />
            </div>
            <div className="risk-grid">
              <div className="risk-chart">
                <div className="section-title">Wertentwicklung (Start = 100)</div>
                <div style={{ height: 220 }}>
                  <Suspense fallback={null}>
                    <EChart option={option} />
                  </Suspense>
                </div>
              </div>
              <div>
                <div className="section-title">Risikobeitrag je Position</div>
                <Table rows={riskRows} columns={columns} rowKey={(x) => x.id} initialSort={{ key: "r", desc: true }} />
              </div>
            </div>
            <div style={{ padding: "0 8px" }}>
              <div className="section-title" title={explain("Korrelation")}>Korrelation der Tagesrenditen (größte Positionen)</div>
            </div>
            <CorrelationTable a={a} />
          </>
        )}
        <div className="notes">
          {a.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
          <div>Historische Simulation über ein Jahr: Was in der Vergangenheit passiert ist, kann sich anders wiederholen. Keine Anlageberatung.</div>
        </div>
      </div>
    </>
  );
}
