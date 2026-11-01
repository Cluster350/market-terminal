// Kopfzeile, Laufband, Panel-Raster und Statusleiste.

import { Component, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { dataHealth, IS_STATIC } from "../lib/api";
import { FN, FUNCTIONS, type FnCode } from "../lib/commands";
import { displayTicker, fmt, fmtBp, fmtPct, fmtPrice, fmtTime, tone } from "../lib/format";
import { useIndices, useQuotes, useStatus } from "../lib/queries";
import { SCREENS } from "../screens";
import { isSolo, LAYOUTS, openWindow, PAGES, useWorkspace } from "../state/workspace";
import { useNow } from "../components/ui";
import { CommandLine } from "./CommandLine";
import { resetAndReload } from "../lib/reset";

/** Knopf "⟲ STANDARD": Seite, Ansicht oder alles auf den Auslieferungszustand zurücksetzen. */
function ResetMenu() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const solo = isSolo(ws.state.window);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div
      className="reset-wrap"
      ref={boxRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation(); // nur das Menü schließen, nicht im Panel zurückgehen
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="key small-key"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Auf Standard zurücksetzen"
        onClick={() => {
          setOpen((o) => !o);
          setConfirmAll(false);
        }}
      >
        ⟲ <span className="wt-label">STANDARD</span>
      </button>
      {open && (
        <div className="reset-menu" role="menu">
          {!solo && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                ws.resetPage();
                setOpen(false);
              }}
            >
              <b>Diese Seite</b>
              <span>Layout und Panels dieser Seite wie bei der Auslieferung</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => resetAndReload("view")}>
            <b>Ganze Ansicht</b>
            <span>Alle Seiten, Fenster, Chart- und Filtereinstellungen. Watchlist und gespeicherte Screens bleiben.</span>
          </button>
          {!confirmAll ? (
            <button type="button" role="menuitem" onClick={() => setConfirmAll(true)}>
              <b>Alles (Werkszustand)</b>
              <span>Zusätzlich Watchlist, gespeicherte Screens, Befehlsverlauf und gelesene Meldungen</span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="danger" onClick={() => resetAndReload("all")} autoFocus>
              <b>Wirklich alles zurücksetzen?</b>
              <span>Klicken zum Bestätigen. Weitere Terminal-Fenster vorher schließen.</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const MARKETS: { label: string; tz: string; open: [number, number]; close: [number, number] }[] = [
  { label: "NY", tz: "America/New_York", open: [9, 30], close: [16, 0] },
  { label: "FFM", tz: "Europe/Berlin", open: [9, 0], close: [17, 30] },
  { label: "LDN", tz: "Europe/London", open: [8, 0], close: [16, 30] },
  { label: "TKY", tz: "Asia/Tokyo", open: [9, 0], close: [15, 0] },
];

function localParts(now: number, tz: string): { hh: number; mm: number; wd: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hh: Number(get("hour")) % 24, mm: Number(get("minute")), wd: get("weekday") };
}

function Clocks() {
  const now = useNow(15_000);
  return (
    <div className="clocks" aria-label="Börsenuhren">
      {MARKETS.map((m) => {
        const { hh, mm, wd } = localParts(now, m.tz);
        const mins = hh * 60 + mm;
        const open = !["Sat", "Sun"].includes(wd) && mins >= m.open[0] * 60 + m.open[1] && mins < m.close[0] * 60 + m.close[1];
        return (
          <span key={m.label} className={open ? "clock-open" : ""} title={`${m.label}: ${open ? "Börse geöffnet" : "Börse geschlossen"} (Handelszeiten ohne Feiertage)`}>
            {m.label}
            <b>
              {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
            </b>
          </span>
        );
      })}
    </div>
  );
}

function ModeBadge() {
  const status = useStatus();
  if (IS_STATIC) return <span className="mode-badge mode-demo" title="Statische Demo mit synthetischen Daten und fiktiven Unternehmen">DEMO</span>;
  if (!status.data) return null;
  return status.data.mode === "eodhd" ? (
    <span className="mode-badge mode-live" title="Daten von EODHD (verzögert)">EODHD</span>
  ) : (
    <span className="mode-badge mode-demo" title="Synthetische Daten, fiktive Unternehmen. EODHD_API_KEY setzen für echte Daten.">DEMO</span>
  );
}

function WindowTools() {
  const ws = useWorkspace();
  const [blocked, setBlocked] = useState(false);
  const layout = ws.state.pages[ws.state.page].layout;
  const solo = isSolo(ws.state.window);
  return (
    <div className="win-tools">
      {!solo && (
        <div className="seg" role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l.value} type="button" aria-pressed={layout === l.value} title={`${l.title} (Alt+L wechselt)`} onClick={() => ws.setLayout(l.value)}>
              {l.label}
            </button>
          ))}
        </div>
      )}
      {!solo && (
        <button
          type="button"
          className="key small-key"
          title="Diese Seite in einem neuen Fenster öffnen – z. B. für einen zweiten Monitor"
          onClick={() => {
            const ok = openWindow({ page: ws.state.page });
            setBlocked(!ok);
            if (!ok) setTimeout(() => setBlocked(false), 4000);
          }}
        >
          ⧉ <span className="wt-label">FENSTER</span>
        </button>
      )}
      <button
        type="button"
        className="key small-key"
        aria-pressed={ws.state.linked}
        title={ws.state.linked ? "Verknüpft: folgt dem Wertpapier der anderen Fenster. Klicken zum Lösen." : "Gelöst: dieses Fenster behält sein Wertpapier. Klicken zum Verknüpfen."}
        onClick={() => ws.setLinked(!ws.state.linked)}
      >
        {ws.state.linked ? "◆ LINK" : "◇ LINK"}
      </button>
      <ResetMenu />
      {blocked && <span className="small down">Pop-up blockiert – bitte im Browser erlauben.</span>}
    </div>
  );
}

export function TopBar() {
  const ws = useWorkspace();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">MT</span>
        <span className="brand-name">{ws.state.window === "main" ? "MARKET TERMINAL" : `FENSTER ${ws.state.window.replace(/^solo-/, "").toUpperCase()}`}</span>
      </div>
      {!isSolo(ws.state.window) && (
        <nav className="keys" aria-label="Seiten">
          {PAGES.map((p) => (
            <button key={p.id} type="button" className="key" aria-pressed={ws.state.page === p.id} onClick={() => ws.setPage(p.id)} title={`Alt+${p.key}`}>
              <span className="n">{p.key}</span>
              {p.label}
            </button>
          ))}
        </nav>
      )}
      <WindowTools />
      <CommandLine />
      <Clocks />
      <ModeBadge />
    </header>
  );
}

export function TickerTape() {
  const ws = useWorkspace();
  const idx = useIndices();
  const watch = useQuotes(ws.state.watchlist.slice(0, 20));
  const items = [
    ...(idx.data ?? []).map((r) => ({ ticker: r.ticker, name: r.name, last: r.last, chg: r.changePct })),
    ...(watch.data ?? [])
      .filter((q) => q.last !== null && !q.ticker.endsWith(".INDX"))
      .map((q) => ({ ticker: q.ticker, name: displayTicker(q.ticker), last: q.last, chg: q.changePct })),
  ];
  if (!items.length) return <div className="tape" aria-hidden="true" />;
  const row = (suffix: string) =>
    items.map((it) => (
      <span key={it.ticker + suffix} className="tape-item" onClick={() => ws.setSecurity(it.ticker, { open: "GP" })} title={it.ticker}>
        <span className="nm">{it.name}</span>
        <span>{fmtPrice(it.last, it.ticker)}</span>
        <span className={tone(it.chg)}>{fmtPct(it.chg)}</span>
      </span>
    ));
  return (
    <div className="tape" aria-label="Laufband">
      <div className="tape-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="state err" role="alert">
          <span className="msg">Dieses Panel ist abgestürzt: {this.state.error.message}</span>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Neu laden
          </button>
        </div>
      );
    return this.props.children;
  }
}

function Provenance({ delayed }: { delayed: boolean | undefined }) {
  const status = useStatus();
  const health = useSyncExternalStore(dataHealth.subscribe, dataHealth.get);
  const mode = IS_STATIC ? "static" : status.data?.mode;
  const [label, title] = health.stale
    ? ["CACHE", "Datenquelle zuletzt nicht erreichbar – zwischengespeicherte Werte"]
    : mode === "eodhd"
      ? delayed === false
        ? ["LIVE", "Echtzeitkurs"]
        : ["VERZ.", "Kurs von EODHD, ca. 15–20 Minuten verzögert"]
      : ["SYNTH", "Synthetischer Demo-Kurs (fiktive Daten)"];
  return (
    <span className="tag prov" title={title}>
      {label}
    </span>
  );
}

function PanelTitle({ fn, ticker }: { fn: FnCode; ticker: string | null }) {
  const q = useQuotes(FN[fn].needsTicker && ticker ? [ticker] : []);
  // Platzhalterdaten des vorigen Tickers nicht unter dem neuen Namen zeigen
  const quote = q.data?.[0]?.ticker === ticker ? q.data[0] : undefined;
  return (
    <span className="panel-title">
      {FN[fn].title}
      {FN[fn].needsTicker && ticker && (
        <>
          {" · "}
          <b>{displayTicker(ticker)}</b>
          {quote?.name ? ` ${quote.name}` : ""}
          {quote?.last !== null && quote?.last !== undefined && (
            <>
              {" "}
              {ticker.endsWith(".GBOND") ? (
                <>
                  <b>{fmt(quote.last, 3)} %</b> <span className={tone(quote.change, 2)}>{fmtBp(quote.change)}</span>
                </>
              ) : (
                <>
                  <b>{fmtPrice(quote.last, ticker)}</b> <span className={tone(quote.changePct, 2)}>{fmtPct(quote.changePct)}</span>
                </>
              )}{" "}
              <Provenance delayed={quote.delayed} />
            </>
          )}
        </>
      )}
    </span>
  );
}

function Panel({ fn, index }: { fn: FnCode; index: number }) {
  const ws = useWorkspace();
  const active = ws.state.active[ws.state.page] === index;
  const maximized = ws.state.maximized === index;
  const Screen = SCREENS[fn];
  const pinned = ws.state.pins[ws.state.page]?.[index] ?? null;
  const ticker = pinned ?? ws.state.security;
  return (
    <section
      className={`panel ${active ? "active" : ""}`}
      onMouseDown={() => !active && ws.setActive(index)}
      aria-label={`${fn} ${FN[fn].title}`}
    >
      <div className="panel-head">
        <span className="fn-chip">{fn}</span>
        <PanelTitle fn={fn} ticker={ticker} />
        <div className="panel-tools">
          {FN[fn].needsTicker && (
            <button
              className={`tool ${pinned ? "pinned" : ""}`}
              aria-pressed={!!pinned}
              title={
                pinned
                  ? `Fixiert auf ${displayTicker(pinned)}: folgt nicht dem Arbeitsbereich. Klicken zum Lösen.`
                  : "Panel fixieren: behält sein Wertpapier, z. B. Index neben Aktie oder BTP neben Bund"
              }
              onClick={() => ws.pinPanel(index, pinned ? null : ws.state.security)}
              disabled={!pinned && !ws.state.security}
            >
              {pinned ? "◆ FIX" : "◇ FIX"}
            </button>
          )}
          {FN[fn].needsTicker && ticker && !ws.state.watchlist.includes(ticker) && (
            <button className="tool" title="Zur Watchlist hinzufügen" onClick={() => ws.watchAdd(ticker)}>
              +W
            </button>
          )}
          <select
            className="fn-select"
            aria-label="Funktion dieses Panels wechseln"
            value={fn}
            onChange={(e) => ws.setPanelFn(index, e.target.value as FnCode)}
            onMouseDown={() => ws.setActive(index)}
          >
            {FUNCTIONS.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code} – {f.title}
              </option>
            ))}
          </select>
          <button className="tool" title="In neuem Fenster öffnen (z. B. für einen weiteren Monitor)" onClick={() => openWindow({ fn })}>
            ⧉
          </button>
          <button className="tool" title={maximized ? "Wiederherstellen (Alt+M)" : "Maximieren (Alt+M)"} onClick={() => ws.maximize(maximized ? null : index)}>
            {maximized ? "▣" : "□"}
          </button>
        </div>
      </div>
      <div className="panel-body flush">
        <Boundary resetKey={`${fn}|${ticker}`}>
          <Suspense fallback={null}>
            {FN[fn].needsTicker && !ticker ? (
              <div className="state">Kein Wertpapier gewählt. Ticker in die Befehlszeile eingeben.</div>
            ) : (
              <Screen ticker={ticker} active={active} />
            )}
          </Suspense>
        </Boundary>
      </div>
    </section>
  );
}

export function PanelGrid() {
  const ws = useWorkspace();
  const page = ws.state.pages[ws.state.page];
  const max = ws.state.maximized;
  const panels = page.panels.map((fn, i) => ({ fn, i })).filter((p) => max === null || p.i === max);
  return (
    <main className={`grid ${max !== null ? "max" : page.layout}`}>
      {panels.map(({ fn, i }) => (
        <Panel key={`${ws.state.page}-${i}`} fn={fn} index={i} />
      ))}
    </main>
  );
}

export function StatusBar() {
  const status = useStatus();
  const health = useSyncExternalStore(dataHealth.subscribe, dataHealth.get);
  const now = useNow(10_000);
  const s = status.data;
  const mode = IS_STATIC ? "Statische Demo · fiktive Unternehmen, synthetische Kurse" : s?.mode === "eodhd" ? "Quelle: EODHD (Kurse verzögert)" : s ? "Demo-Modus · fiktive Unternehmen, synthetische Kurse" : "Verbinde …";
  const age = health.lastOk ? Math.round((now - health.lastOk) / 1000) : null;
  return (
    <footer className="statusbar">
      <span className={s?.mode === "eodhd" ? "ok" : "warn"}>{mode}</span>
      {health.lastError ? (
        <span className="err">⚠ {health.lastError}</span>
      ) : health.stale ? (
        <span className="warn" title="Die Datenquelle war nicht erreichbar; es werden zwischengespeicherte Werte angezeigt.">⚠ Teilweise veraltete Daten</span>
      ) : (
        <span>
          Aktualisiert {health.lastOk ? fmtTime(new Date(health.lastOk)) : "–"}
          {age !== null && age > 120 ? " (älter als 2 Min.)" : ""}
          {health.inflight > 0 ? " · lädt …" : ""}
        </span>
      )}
      {s?.budget && (
        <span title={Object.entries(s.budget.byEndpoint).map(([k, v]) => `${k}: ${v}`).join("\n")}>
          API-Calls heute ≈ {s.budget.used.toLocaleString("de-DE")} / {s.budget.limit.toLocaleString("de-DE")}
          {s.account?.apiRequests != null ? ` (EODHD: ${s.account.apiRequests.toLocaleString("de-DE")})` : ""}
        </span>
      )}
      <span className="right">
        <kbd>/</kbd> Befehl · <kbd>Alt</kbd>+<kbd>1–4</kbd> Seiten · <kbd>Alt</kbd>+<kbd>←→</kbd> Panel · <kbd>Alt</kbd>+<kbd>M</kbd> Max · <kbd>HELP</kbd>
      </span>
    </footer>
  );
}
