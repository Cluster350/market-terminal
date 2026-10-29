// Screener-Funktionen: EQS, IMAP, MOST sowie W (Watchlist) und HELP.

import { useEffect, useMemo, useState } from "react";
import { Change, Empty, ErrorState, Flash, Loading, Q, Table, TickerLink } from "../components/ui";
import { api, ApiError, IS_STATIC } from "../lib/api";
import { FUNCTIONS, normalizeTicker } from "../lib/commands";
import { DASH, displayTicker, fmt, fmtBig, fmtPrice, fmtStamp, isNum, sectorDe, tone } from "../lib/format";
import { useMovers, useQuotes, useScreen, useScreenFields, useStatus } from "../lib/queries";
import { rowKey } from "../lib/screen";
import type { ScreenField, ScreenFilter, ScreenOp, ScreenRow } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

// --- EQS ------------------------------------------------------------------------------

interface Draft {
  id: number;
  field: string;
  op: ScreenOp;
  value: string;
}

const OPS: { value: ScreenOp; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
];

let nextId = 1;
const d = (field: string, op: ScreenOp, value: string): Draft => ({ id: nextId++, field, op, value });

const PRESETS: { name: string; filters: () => Draft[]; sort: string; desc: boolean }[] = [
  { name: "Große Werte", filters: () => [d("market_cap", "gt", "50")], sort: "market_cap", desc: true },
  { name: "Value", filters: () => [d("pe", "lt", "15"), d("pe", "gt", "0"), d("div_yield", "gt", "2")], sort: "pe", desc: false },
  { name: "Momentum", filters: () => [d("perf_12m", "gt", "20"), d("dist_52w_high", "gt", "-10")], sort: "perf_12m", desc: true },
  { name: "Überverkauft", filters: () => [d("rsi14", "lt", "35")], sort: "rsi14", desc: false },
  { name: "Dividende", filters: () => [d("div_yield", "gt", "3")], sort: "div_yield", desc: true },
  { name: "Tech-Momentum", filters: () => [d("sector", "eq", "Technology"), d("perf_3m", "gt", "0")], sort: "perf_3m", desc: true },
];

const SAVED_KEY = "mt.screens";

type Saved = { name: string; filters: Draft[]; sort: string; desc: boolean };

/**
 * Gespeicherte Screens prüfen und Filter-IDs neu vergeben: Die gespeicherten IDs stammen aus
 * früheren Sitzungen und kollidierten mit neuen Filtern (Bearbeiten/Löschen traf dann beide).
 * Ein beschädigter Eintrag (kein Array) ließ das Panel bei jedem Laden abstürzen.
 */
export function parseSaved(json: string | null): Saved[] {
  try {
    const raw: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s) => s && typeof s.name === "string" && Array.isArray(s.filters))
      .map((s) => ({
        name: s.name,
        sort: typeof s.sort === "string" ? s.sort : "market_cap",
        desc: s.desc !== false,
        filters: (s.filters as Partial<Draft>[])
          .filter((f) => f && typeof f.field === "string")
          .map((f) => d(f.field!, OPS.some((o) => o.value === f.op) ? f.op! : "gt", String(f.value ?? ""))),
      }));
  } catch {
    return [];
  }
}

function loadSaved(): Saved[] {
  try {
    return parseSaved(localStorage.getItem(SAVED_KEY));
  } catch {
    return [];
  }
}

function toFilter(dr: Draft, fields: Map<string, ScreenField>): ScreenFilter | null {
  const f = fields.get(dr.field);
  if (!f || dr.value.trim() === "") return null;
  if (f.kind === "text" || f.kind === "choice") {
    return { field: dr.field, op: f.kind === "text" ? "contains" : dr.op === "neq" ? "neq" : "eq", value: dr.value.trim() };
  }
  const n = Number(dr.value.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return { field: dr.field, op: dr.op, value: f.kind === "money" ? n * 1e9 : n };
}

const RESULT_COLS: { key: string; label: string; num?: boolean; render: (r: ScreenRow) => React.ReactNode }[] = [
  { key: "ticker", label: "Ticker", render: (r) => <TickerLink ticker={r.ticker} /> },
  { key: "name", label: "Name", render: (r) => <span title={r.name ?? ""}>{r.name ?? DASH}</span> },
  { key: "sector", label: "Sektor", render: (r) => <span className="muted" title={r.industry ?? ""}>{sectorDe(r.sector)}</span> },
  { key: "currency", label: "Whg.", render: (r) => <span className="muted">{r.currency ?? DASH}</span> },
  { key: "price", label: "Kurs", num: true, render: (r) => fmtPrice(r.price) },
  { key: "chg_1d", label: "1T %", num: true, render: (r) => <Change value={r.chg1d} /> },
  {
    key: "market_cap",
    label: "Marktkap. USD",
    num: true,
    render: (r) => (
      <span title={isNum(r.marketCapLocal) && r.currency !== "USD" ? `${fmtBig(r.marketCapLocal)} ${r.currency ?? ""}` : undefined}>{fmtBig(r.marketCap)}</span>
    ),
  },
  { key: "pe", label: "KGV", num: true, render: (r) => fmt(r.pe, 1) },
  { key: "div_yield", label: "Div. %", num: true, render: (r) => fmt(r.divYield, 2) },
  { key: "perf_1m", label: "1M %", num: true, render: (r) => <Change value={r.perf1m} digits={1} /> },
  { key: "perf_3m", label: "3M %", num: true, render: (r) => <Change value={r.perf3m} digits={1} /> },
  { key: "perf_12m", label: "12M %", num: true, render: (r) => <Change value={r.perf12m} digits={1} /> },
  { key: "rsi14", label: "RSI", num: true, render: (r) => <span className={isNum(r.rsi14) ? (r.rsi14 > 70 ? "down" : r.rsi14 < 30 ? "up" : "") : ""}>{fmt(r.rsi14, 0)}</span> },
  { key: "vol_1y", label: "Vola %", num: true, render: (r) => fmt(r.vol1y, 1) },
  { key: "dist_52w_high", label: "52W-H %", num: true, render: (r) => <span className={tone(r.dist52wHigh)}>{fmt(r.dist52wHigh, 1)}</span> },
];

/**
 * CSV für deutsches Excel: Semikolon als Trenner und Dezimalkomma, ohne Tausenderpunkte.
 * Marktkapitalisierung in USD und in Handelswährung.
 */
export function toCsv(rows: ScreenRow[]): string {
  const cols: [string, string][] = [
    ["ticker", "Ticker"], ["name", "Name"], ["exchange", "Börse"], ["sector", "Sektor"], ["industry", "Branche"],
    ["currency", "Währung"], ["price", "Kurs"], ["chg_1d", "Veränd. 1T %"], ["market_cap", "Marktkap. USD"],
    ["market_cap_local", "Marktkap. Handelswährung"], ["pe", "KGV"], ["eps", "EPS"], ["div_yield", "Div.-Rendite %"],
    ["perf_1m", "Perf. 1M %"], ["perf_3m", "Perf. 3M %"], ["perf_12m", "Perf. 12M %"], ["rsi14", "RSI 14"],
    ["vol_1y", "Volatilität 1J %"], ["dist_52w_high", "Abst. 52W-Hoch %"],
  ];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(Math.round(v * 10000) / 10000).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(([, h]) => h).join(";"), ...rows.map((r) => cols.map(([k]) => esc(r[rowKey(k)])).join(";"))].join("\n");
}

export function EQS(_: ScreenProps) {
  const fieldsQ = useScreenFields();
  const fields = useMemo(() => new Map((fieldsQ.data ?? []).map((f) => [f.key, f])), [fieldsQ.data]);
  const [drafts, setDrafts] = useState<Draft[]>(PRESETS[0].filters);
  const [applied, setApplied] = useState<{ filters: Draft[]; sort: string; desc: boolean }>({ filters: PRESETS[0].filters(), sort: "market_cap", desc: true });
  const [saved, setSaved] = useState(loadSaved);
  const [saveName, setSaveName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const filters = useMemo(() => applied.filters.map((x) => toFilter(x, fields)).filter((x): x is ScreenFilter => !!x), [applied.filters, fields]);
  const q = useScreen({ filters, sort: applied.sort, desc: applied.desc, limit: 250, enrich: true });

  const run = (next?: Partial<typeof applied>) => setApplied((a) => ({ ...a, filters: drafts, ...next }));

  function persist(list: typeof saved) {
    setSaved(list);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      /* ignorieren */
    }
  }

  async function copyCsv() {
    if (!q.data) return;
    const csv = toCsv(q.data.rows);
    try {
      await navigator.clipboard.writeText(csv);
      setCopied("CSV in die Zwischenablage kopiert.");
    } catch {
      setCopied("Kopieren nicht erlaubt – bitte im lokalen Terminal „CSV speichern“ nutzen.");
    }
    setTimeout(() => setCopied(null), 3000);
  }

  function downloadCsv() {
    if (!q.data) return;
    const blob = new Blob(["﻿" + toCsv(q.data.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `screen-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const groups: { key: ScreenField["group"]; label: string }[] = [
    { key: "descriptive", label: "Beschreibend" },
    { key: "fundamental", label: "Fundamental" },
    { key: "technical", label: "Technisch" },
  ];

  if (fieldsQ.isPending) return <Loading />;
  if (fieldsQ.isError) return <ErrorState error={fieldsQ.error} onRetry={() => fieldsQ.refetch()} />;

  return (
    <>
      <div className="toolbar" style={{ alignItems: "flex-start" }}>
        <span className="lbl small">Vorlagen</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className="btn"
            onClick={() => {
              const f = p.filters();
              setDrafts(f);
              setApplied({ filters: f, sort: p.sort, desc: p.desc });
            }}
          >
            {p.name}
          </button>
        ))}
        {saved.map((s) => (
          <span key={s.name} style={{ display: "inline-flex" }}>
            <button
              className="btn"
              style={{ borderColor: "var(--label)" }}
              onClick={() => {
                setDrafts(s.filters);
                setApplied({ filters: s.filters, sort: s.sort, desc: s.desc });
              }}
            >
              ★ {s.name}
            </button>
            <button className="btn" title="Gespeicherten Screen löschen" onClick={() => persist(saved.filter((x) => x.name !== s.name))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="toolbar"
        style={{ display: "grid", gap: 4, justifyItems: "start" }}
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {drafts.map((dr) => {
          const f = fields.get(dr.field);
          return (
            <div key={dr.id} style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <select
                className="field"
                aria-label="Feld"
                value={dr.field}
                onChange={(e) => setDrafts((x) => x.map((y) => (y.id === dr.id ? { ...y, field: e.target.value, value: "" } : y)))}
              >
                {groups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {(fieldsQ.data ?? [])
                      .filter((f) => f.group === g.key)
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {f && (f.kind === "choice" || f.kind === "text") ? (
                <>
                  <select className="field" aria-label="Operator" value={dr.op === "neq" ? "neq" : "eq"} onChange={(e) => setDrafts((x) => x.map((y) => (y.id === dr.id ? { ...y, op: e.target.value as ScreenOp } : y)))}>
                    <option value="eq">{f.kind === "text" ? "enthält" : "ist"}</option>
                    {f.kind === "choice" && <option value="neq">ist nicht</option>}
                  </select>
                  {f.kind === "choice" ? (
                    <select className="field" aria-label="Wert" value={dr.value} onChange={(e) => setDrafts((x) => x.map((y) => (y.id === dr.id ? { ...y, value: e.target.value } : y)))}>
                      <option value="">– wählen –</option>
                      {f.choices.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="field" aria-label="Wert" value={dr.value} onChange={(e) => setDrafts((x) => x.map((y) => (y.id === dr.id ? { ...y, value: e.target.value } : y)))} />
                  )}
                </>
              ) : (
                <>
                  <select className="field" aria-label="Operator" value={dr.op} onChange={(e) => setDrafts((x) => x.map((y) => (y.id === dr.id ? { ...y, op: e.target.value as ScreenOp } : y)))}>
                    {OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field"
                    inputMode="decimal"
                    aria-label="Wert"
                    style={{ width: 90 }}
                    value={dr.value}
                    onChange={(e) => setDrafts((x) => x.map((y) => (y.id === dr.id ? { ...y, value: e.target.value } : y)))}
                  />
                  <span className="small muted">{f?.kind === "money" ? "Mrd." : f?.kind === "percent" ? "%" : ""}</span>
                </>
              )}
              <button type="button" className="btn" aria-label="Filter entfernen" onClick={() => setDrafts((x) => x.filter((y) => y.id !== dr.id))}>
                ×
              </button>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn" onClick={() => setDrafts((x) => [...x, d("pe", "lt", "")])}>
            + Filter
          </button>
          <button type="submit" className="btn primary">
            Screen ausführen
          </button>
          <span className="sep" />
          <input className="field" placeholder="Name zum Speichern" aria-label="Name für gespeicherten Screen" value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ width: 150 }} />
          <button
            type="button"
            className="btn"
            disabled={!saveName.trim()}
            onClick={() => {
              const name = saveName.trim();
              persist([...saved.filter((s) => s.name !== name), { name, filters: drafts, sort: applied.sort, desc: applied.desc }]);
              setSaveName("");
            }}
          >
            Speichern
          </button>
          <span className="sep" />
          <button type="button" className="btn" onClick={copyCsv} disabled={!q.data?.rows.length}>
            CSV kopieren
          </button>
          {!IS_STATIC && (
            <button type="button" className="btn" onClick={downloadCsv} disabled={!q.data?.rows.length}>
              CSV speichern
            </button>
          )}
          {copied && <span className="small lbl">{copied}</span>}
        </div>
      </form>
      <div className="panel-body">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.rows.length ? (
          <Empty>Keine Treffer. Filter lockern oder eine Vorlage wählen.</Empty>
        ) : (
          <table className="t" style={{ opacity: q.isPlaceholderData ? 0.6 : 1 }}>
            <thead>
              <tr>
                {RESULT_COLS.map((c) => {
                  const active = applied.sort === c.key;
                  return (
                    <th
                      key={c.key}
                      className={`${c.num ? "num" : ""} sortable ${active ? "sorted" : ""}`}
                      aria-sort={active ? (applied.desc ? "descending" : "ascending") : undefined}
                      onClick={c.key === "currency" ? undefined : () => setApplied((a) => ({ ...a, sort: c.key, desc: a.sort === c.key ? !a.desc : !!c.num }))}
                    >
                      {c.label}
                      {active ? (applied.desc ? " ▼" : " ▲") : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.ticker}>
                  {RESULT_COLS.map((c) => (
                    <td key={c.key} className={c.num ? "num" : c.key === "name" ? "cell-name" : ""}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {q.data && (
        <div className="notes">
          {q.data.total} Treffer{q.data.truncated ? ` (erste ${q.data.rows.length} angezeigt)` : ""} · {q.data.notes.join(" ")}
        </div>
      )}
    </>
  );
}

// --- MOST -----------------------------------------------------------------------------

function MoverTable({ title, rows, volume }: { title: string; rows: ScreenRow[]; volume?: boolean }) {
  const ws = useWorkspace();
  return (
    <div style={{ minWidth: 0 }}>
      <div className="section-title" style={{ padding: "6px 8px 3px" }}>{title}</div>
      <Table
        rows={rows}
        rowKey={(r) => r.ticker}
        onRowClick={(r) => ws.setSecurity(r.ticker)}
        columns={[
          {
            key: "t",
            label: "Wert",
            className: "cell-name",
            render: (r) => (
              <span title={r.name ?? undefined}>
                <span className="lbl">{displayTicker(r.ticker)}</span>
                <span className="xs muted" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              </span>
            ),
          },
          { key: "p", label: "Kurs", num: true, render: (r) => fmtPrice(r.price) },
          volume
            ? { key: "v", label: "Ø Vol.", num: true, render: (r) => fmtBig(r.avgVol, 1) }
            : { key: "c", label: "%", num: true, render: (r) => <Change value={r.chg1d} arrowSign /> },
        ]}
      />
    </div>
  );
}

export function MOST(_: ScreenProps) {
  const q = useMovers();
  return (
    <div className="panel-body">
      <Q q={q}>
        {(m) => (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
            <MoverTable title="Gewinner" rows={m.gainers} />
            <MoverTable title="Verlierer" rows={m.losers} />
            <MoverTable title="Meistgehandelt" rows={m.active} volume />
          </div>
        )}
      </Q>
    </div>
  );
}

// --- W (Watchlist) ----------------------------------------------------------------------

export function W(_: ScreenProps) {
  const ws = useWorkspace();
  const list = ws.state.watchlist;
  const q = useQuotes(list);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [input]);
  const rows = q.data ?? [];

  return (
    <>
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault();
          const t = normalizeTicker(input);
          if (!t) return setErr("Ticker nicht erkannt.");
          if (list.includes(t)) return setErr("Bereits in der Watchlist.");
          try {
            // Nur bekannte Wertpapiere aufnehmen (Tippfehler sonst als „n. v.“ in der Liste)
            const hit = await api.resolve(t);
            if (list.includes(hit.ticker)) return setErr("Bereits in der Watchlist.");
            ws.watchAdd(hit.ticker);
            setInput("");
          } catch (ex) {
            setErr(ex instanceof ApiError ? ex.message : "Ticker konnte nicht geprüft werden.");
          }
        }}
      >
        <input className="field" placeholder="Ticker hinzufügen, z. B. QBIT US" aria-label="Ticker hinzufügen" value={input} onChange={(e) => setInput(e.target.value)} style={{ width: 200 }} />
        <button className="btn" type="submit">
          Hinzufügen
        </button>
        {err && <span className="small down">{err}</span>}
        <span className="small muted" style={{ marginLeft: "auto" }}>{list.length} Werte</span>
      </form>
      <div className="panel-body">
        {!list.length ? (
          <Empty>Die Watchlist ist leer. Ticker oben eingeben oder in einem Aktien-Panel auf +W klicken.</Empty>
        ) : q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Ticker</th>
                <th className="num">Kurs</th>
                <th className="num">%</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.ticker} className={`clickable ${ws.state.security === r.ticker ? "selected" : ""}`} onClick={() => ws.setSecurity(r.ticker)}>
                  <td className="cell-name" title={`${r.name ?? r.ticker} · Stand ${fmtStamp(r.timestamp)}`}>
                    <span className="lbl">{displayTicker(r.ticker)}</span>
                    {r.name && <div className="xs muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>}
                  </td>
                  <td className="num">
                    <Flash value={r.last}>
                      <b>{r.last === null || r.last === undefined ? <span className="muted" title="Keine Kursdaten">n. v.</span> : fmtPrice(r.last, r.ticker)}</b>
                    </Flash>
                    <div className="xs muted">{fmtStamp(r.timestamp)}</div>
                  </td>
                  <td className="num">
                    {r.ticker.endsWith(".GBOND") ? <span className={tone(r.change)}>{isNum(r.change) ? `${Math.round(r.change * 100)} bp` : DASH}</span> : <Change value={r.changePct} />}
                  </td>
                  <td className="num nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="tool" title="Nach oben" disabled={i === 0} onClick={() => ws.watchMove(r.ticker, -1)}>↑</button>
                    <button className="tool" title="Nach unten" disabled={i === rows.length - 1} onClick={() => ws.watchMove(r.ticker, 1)}>↓</button>
                    <button className="tool" title="Entfernen" onClick={() => ws.watchRemove(r.ticker)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// --- HELP -------------------------------------------------------------------------------

export function HELP(_: ScreenProps) {
  const ws = useWorkspace();
  const status = useStatus();
  const groups = Array.from(new Set(FUNCTIONS.map((f) => f.group)));
  const example = ws.state.watchlist.find((t) => !t.endsWith(".INDX") && !t.endsWith(".FOREX")) ?? "NWND.US";
  return (
    <div className="panel-body" style={{ padding: "8px 12px" }}>
      <div className="section-title">Bedienung</div>
      <div style={{ fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, maxWidth: "80ch" }}>
        <p style={{ margin: "4px 0" }}>
          Befehle tippen Sie in die Befehlszeile oben. Schreiben Sie zuerst den Ticker, dann die Funktion, und bestätigen Sie mit Enter oder <b className="lbl">GO</b>.
          Beispiele: <code className="lbl">{displayTicker(example)} GP</code>, <code className="lbl">{example.split(".")[0]} DES</code>, <code className="lbl">ECO</code>, <code className="lbl">TOP</code>.
        </p>
        <p style={{ margin: "4px 0" }}>
          Ticker gehen im EODHD-Format (<code>SAP.XETRA</code>) oder mit Börsenkürzel wie bei Bloomberg (<code>SAP GR</code>, <code>VOD LN</code>). Ohne Börse wird US angenommen.
          Ein Ticker allein wechselt das aktive Wertpapier; alle Aktien-Panels folgen ihm.
        </p>
      </div>
      <div className="section-title">Tastenkürzel</div>
      <table className="t" style={{ maxWidth: 560 }}>
        <tbody>
          {[
            ["/ oder einfach lostippen", "Befehlszeile"],
            ["Esc", "Befehlszeile leeren"],
            ["↑ ↓ / Tab", "Vorschläge wählen / übernehmen"],
            ["Alt + 1 … 4", "Seite AKTIE, MAKRO, SCREENER, NEWS"],
            ["Alt + ← →", "Aktives Panel wechseln"],
            ["Alt + M", "Aktives Panel maximieren"],
            ["↑ ↓ (im aktiven News-Panel)", "Meldungen durchblättern"],
          ].map(([k, v]) => (
            <tr key={k}>
              <td className="lbl">{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {groups.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          <table className="t">
            <tbody>
              {FUNCTIONS.filter((f) => f.group === g).map((f) => (
                <tr key={f.code} className="clickable" onClick={() => ws.runFn(f.code)}>
                  <td style={{ width: "8ch" }}>
                    <span className="fn-chip">{f.code}</span>
                  </td>
                  <td style={{ width: "20ch" }}>{f.title}</td>
                  <td className="muted wrap">{f.desc}{f.needsTicker ? " (braucht Wertpapier)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="section-title">Datenquelle</div>
      <p style={{ fontFamily: "var(--sans)", fontSize: 13, maxWidth: "80ch" }}>
        {IS_STATIC
          ? "Diese Seite ist eine statische Demo. Alle Unternehmen sind frei erfunden, Kurse und Kennzahlen synthetisch. Mit eigenem EODHD-Key lokal gestartet, zeigt das Terminal echte Marktdaten."
          : status.data?.mode === "eodhd"
            ? "Daten von EODHD. Kurse sind verzögert; Fundamentaldaten werden täglich, Makrodaten wöchentlich aktualisiert."
            : "Demo-Modus: fiktive Unternehmen und synthetische Kurse. Für echte Daten EODHD_API_KEY in der .env-Datei setzen und das Backend neu starten."}
      </p>
    </div>
  );
}
