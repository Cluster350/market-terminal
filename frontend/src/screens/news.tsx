// TOP – News-Terminal und CN – Firmen-News.

import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, ErrorState, Loading, Seg, TickerLink, useSize } from "../components/ui";
import { displayTicker, fmtAge, fmtDate, fmtTime, isNum, isToday } from "../lib/format";
import { useNews } from "../lib/queries";
import type { NewsItem } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

const TOPICS = [
  { value: "all", label: "Alle" },
  { value: "company", label: "Unternehmen" },
  { value: "earnings", label: "Earnings" },
  { value: "analyst", label: "Analysten" },
  { value: "mna", label: "M&A" },
  { value: "macro", label: "Makro" },
  { value: "markets", label: "Märkte" },
] as const;

const TOPIC_LABEL: Record<string, string> = Object.fromEntries(TOPICS.map((t) => [t.value, t.label]));

const READ_KEY = "mt.news.read";

function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveRead(s: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Array.from(s).slice(-500)));
  } catch {
    /* nur für diese Sitzung */
  }
}

function sentimentColor(p: number | null): string {
  if (!isNum(p)) return "#3a3a3a";
  if (p > 0.15) return "var(--up)";
  if (p < -0.15) return "var(--down)";
  return "#6a6a6a";
}

function sentimentLabel(p: number | null): string {
  if (!isNum(p)) return "ohne Bewertung";
  if (p > 0.15) return "positiv";
  if (p < -0.15) return "negativ";
  return "neutral";
}

function NewsRow({ n, selected, read, fresh, onOpen }: { n: NewsItem; selected: boolean; read: boolean; fresh: boolean; onOpen: () => void }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onOpen}
      className={fresh ? "flash-up" : ""}
      style={{
        display: "grid",
        gridTemplateColumns: "3px 6.5ch minmax(0, 1fr)",
        gap: 8,
        padding: "4px 8px 4px 0",
        borderBottom: "1px solid #161616",
        cursor: "pointer",
        background: selected ? "var(--select)" : undefined,
        alignItems: "start",
      }}
    >
      <span style={{ alignSelf: "stretch", background: sentimentColor(n.sentiment.polarity) }} title={`Stimmung ${sentimentLabel(n.sentiment.polarity)}`} />
      <span className="muted" title={`${fmtDate(n.date)} ${fmtTime(n.date)}`}>
        {isToday(n.date) ? fmtTime(n.date) : fmtDate(n.date).slice(0, 6)}
      </span>
      <span style={{ minWidth: 0 }}>
        {n.urgent && <span className="tag urgent" style={{ marginRight: 6 }}>EIL</span>}
        <span style={{ fontFamily: "var(--sans)", fontSize: 13, color: read ? "var(--muted)" : "var(--value)", fontWeight: read ? 400 : 500 }}>{n.title}</span>
        <span className="xs muted" style={{ display: "flex", gap: 8, marginTop: 1, flexWrap: "wrap" }}>
          {n.symbols.slice(0, 4).map((s) => (
            <TickerLink key={s} ticker={s} />
          ))}
          <span>{TOPIC_LABEL[n.topic] || n.topic}</span>
          {n.source && <span className="dim">{n.source}</span>}
        </span>
      </span>
    </div>
  );
}

function Reader({ n, onBack, related }: { n: NewsItem; onBack?: () => void; related: NewsItem[] }) {
  return (
    <article style={{ padding: "10px 14px", maxWidth: "78ch" }}>
      {onBack && (
        <button className="btn" onClick={onBack} style={{ marginBottom: 8 }}>
          ‹ Zurück zur Liste
        </button>
      )}
      <div className="small muted" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span>{fmtDate(n.date)} {fmtTime(n.date)}</span>
        {n.source && <span>{n.source}</span>}
        <span>{TOPIC_LABEL[n.topic] || n.topic}</span>
        <span style={{ color: sentimentColor(n.sentiment.polarity) }}>
          Stimmung {sentimentLabel(n.sentiment.polarity)}
          {isNum(n.sentiment.polarity) ? ` (${n.sentiment.polarity.toFixed(2).replace(".", ",")})` : ""}
        </span>
      </div>
      <h2 style={{ fontFamily: "var(--sans)", fontSize: 20, lineHeight: 1.25, margin: "6px 0 8px", fontWeight: 600, textWrap: "balance" } as React.CSSProperties}>
        {n.urgent && <span className="tag urgent" style={{ marginRight: 8, verticalAlign: "middle" }}>EIL</span>}
        {n.title}
      </h2>
      {n.symbols.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          {n.symbols.map((s) => (
            <span key={s} className="small">
              <TickerLink ticker={s} open="DES" /> <TickerLink ticker={s} open="GP">GP</TickerLink>
            </span>
          ))}
        </div>
      )}
      <div style={{ fontFamily: "var(--sans)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        {n.content || <span className="muted">Kein Volltext verfügbar.</span>}
      </div>
      {n.link && (
        <p>
          <a href={n.link} target="_blank" rel="noreferrer noopener">
            Originalquelle öffnen ↗
          </a>
        </p>
      )}
      {n.tags.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {n.tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
      )}
      {related.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 14 }}>Weitere Meldungen zu {displayTicker(n.symbols[0])}</div>
          {related.map((r) => (
            <div key={r.id} className="small" style={{ padding: "3px 0" }}>
              <span className="muted">{fmtAge(r.date)} </span>
              {r.title}
            </div>
          ))}
        </>
      )}
    </article>
  );
}

export function NewsTerminal({ tickers, compact, active }: { tickers?: string[]; compact?: boolean; active: boolean }) {
  const ws = useWorkspace();
  const [topic, setTopic] = useState<string>("all");
  const [scope, setScope] = useState<"all" | "watch">("all");
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(loadRead);
  const [paused, setPaused] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const effectiveTickers = tickers ?? (scope === "watch" ? ws.state.watchlist.slice(0, 10) : undefined);
  const q = useNews({ tickers: effectiveTickers, topic, q: debounced || undefined, limit: 200 });

  // Neue Meldungen seit dem letzten Abruf kurz hervorheben
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const frozen = useRef<NewsItem[] | null>(null);
  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    return urgentOnly ? all.filter((n) => n.urgent) : all;
  }, [q.data, urgentOnly]);
  if (!paused) frozen.current = items;
  const shown = paused && frozen.current ? frozen.current : items;

  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.items.map((n) => n.id));
    if (seen.current) {
      const added = new Set(Array.from(ids).filter((id) => !seen.current!.has(id)));
      if (added.size) {
        setFresh(added);
        const t = setTimeout(() => setFresh(new Set()), 4000);
        seen.current = ids;
        return () => clearTimeout(t);
      }
    }
    seen.current = ids;
  }, [q.data]);

  useEffect(() => {
    seen.current = null;
  }, [topic, scope, debounced, tickers?.join(",")]);

  const selected = shown.find((n) => n.id === selectedId) ?? null;
  const [listRef, size] = useSize<HTMLDivElement>();
  const twoCol = !compact && size.w > 760;

  function open(n: NewsItem) {
    setSelectedId(n.id);
    if (!read.has(n.id)) {
      const next = new Set(read);
      next.add(n.id);
      setRead(next);
      saveRead(next);
    }
  }

  // Tastatur: ↑/↓ blättert, wenn dieses Panel aktiv ist
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = shown.findIndex((n) => n.id === selectedId);
      const next = e.key === "ArrowDown" ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0);
      if (shown[next]) open(shown[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const related = selected?.symbols[0]
    ? shown.filter((n) => n.id !== selected.id && n.symbols.includes(selected.symbols[0])).slice(0, 4)
    : [];
  const unread = shown.filter((n) => !read.has(n.id)).length;

  return (
    <>
      <div className="toolbar">
        <Seg label="Thema" value={topic} options={TOPICS.map((t) => ({ value: t.value, label: t.label }))} onChange={setTopic} />
        {!tickers && (
          <Seg
            label="Umfang"
            value={scope}
            options={[
              { value: "all", label: "Alle Quellen" },
              { value: "watch", label: "Watchlist" },
            ]}
            onChange={setScope}
          />
        )}
        <input className="field" placeholder="Suchen …" aria-label="News durchsuchen" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 150 }} />
        <label className="check">
          <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
          Nur Eilmeldungen
        </label>
        <button className="btn" onClick={() => setPaused((p) => !p)} title={paused ? "Live-Aktualisierung fortsetzen" : "Liste anhalten, um in Ruhe zu lesen"}>
          {paused ? "▶ Fortsetzen" : "❚❚ Anhalten"}
        </button>
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {shown.length} Meldungen · {unread} ungelesen
          {!paused && <span className="up"> · LIVE</span>}
        </span>
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: twoCol ? "minmax(0, 11fr) minmax(0, 9fr)" : "minmax(0, 1fr)" }}>
        {(!selected || twoCol) && (
          <div role="listbox" aria-label="Meldungen" style={{ overflow: "auto", minHeight: 0, borderRight: twoCol ? "1px solid var(--rule)" : undefined }}>
            {q.isPending ? (
              <Loading rows={10} />
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !shown.length ? (
              <Empty>Keine Meldungen für diese Auswahl.</Empty>
            ) : (
              shown.map((n) => (
                <NewsRow key={n.id} n={n} selected={n.id === selectedId} read={read.has(n.id)} fresh={fresh.has(n.id)} onOpen={() => open(n)} />
              ))
            )}
            {q.data?.sourcesNote && <div className="notes">{q.data.sourcesNote}</div>}
          </div>
        )}
        {twoCol && !selected && <Empty>Meldung auswählen (Klick oder ↑/↓), um sie hier zu lesen.</Empty>}
        {selected && (
          <div style={{ overflow: "auto", minHeight: 0 }}>
            <Reader n={selected} related={related} onBack={twoCol ? undefined : () => setSelectedId(null)} />
          </div>
        )}
      </div>
    </>
  );
}

export function TOP({ active }: ScreenProps) {
  return <NewsTerminal active={active} />;
}

export function CN({ ticker, active }: ScreenProps) {
  return <NewsTerminal tickers={ticker ? [ticker] : []} compact active={active} />;
}
