// TOP – News-Terminal und CN – Firmen-News.

import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, ErrorState, Loading, Seg, TickerLink, useSize } from "../components/ui";
import { displayTicker, fmtAge, fmtDate, fmtTime, isNum, isToday, safeUrl } from "../lib/format";
import { aiAvailable, engineLabel, EVENT_LABEL, RELEVANCE_LABEL, useAiStatus, useNewsInsights, type NewsInsight } from "../lib/ai";
import { IS_STATIC } from "../lib/api";
import { useIntent } from "../lib/intents";
import { DEFAULT_SIGNAL, isSignalSettings, SIGNAL_EVENT, type SignalSettings } from "../lib/newsSignal";
import { usePersistentState } from "../lib/persist";
import { useNews } from "../lib/queries";
import { useCsvExport } from "../lib/exporter";
import { newsTone } from "../lib/sound";
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

const fmtSigned = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x).toFixed(2).replace(".", ",")}`;

/** KI-Relevanz als Punkte (0–3), Farbe nach KI-Stimmung. */
function Relevance({ insight, pending }: { insight?: NewsInsight; pending: boolean }) {
  if (!insight) {
    return (
      <span className="ai-rel dim" title={pending ? "KI ordnet ein …" : "Noch nicht eingeordnet"}>
        {pending ? "···" : ""}
      </span>
    );
  }
  const r = Math.max(0, Math.min(3, insight.relevance));
  return (
    <span
      className="ai-rel"
      style={{ color: sentimentColor(insight.sentiment) }}
      title={`KI: ${RELEVANCE_LABEL[r]} (${r}/3) · ${EVENT_LABEL[insight.event] ?? insight.event} · Stimmung ${sentimentLabel(insight.sentiment)} (${fmtSigned(insight.sentiment)})\n${insight.summary}`}
    >
      {"●".repeat(r)}
      <span className="ai-rel-off">{"●".repeat(3 - r)}</span>
    </span>
  );
}

function NewsRow({ n, selected, read, fresh, onOpen, ai, insight, pending }: {
  n: NewsItem; selected: boolean; read: boolean; fresh: boolean; onOpen: () => void; ai: boolean; insight?: NewsInsight; pending: boolean;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onOpen}
      className={fresh ? "flash-up" : ""}
      style={{
        display: "grid",
        gridTemplateColumns: ai ? "3px 12ch 3.4ch minmax(0, 1fr)" : "3px 12ch minmax(0, 1fr)",
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
        {/* Ältere Meldungen mit Datum und Uhrzeit (vorher nur das Datum) */}
        {isToday(n.date) ? fmtTime(n.date) : `${fmtDate(n.date).slice(0, 6)} ${fmtTime(n.date)}`}
      </span>
      {ai && <Relevance insight={insight} pending={pending} />}
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

function InsightBox({ insight, pending, failed }: { insight?: NewsInsight; pending: boolean; failed?: string }) {
  if (!insight) {
    return (
      <div className="ai-box">
        <div className="ai-box-head">
          <span className="lbl">KI-EINORDNUNG</span>
        </div>
        <div className="small muted">{failed ? `Nicht möglich: ${failed}` : pending ? "Das Sprachmodell ordnet die Meldung ein …" : "Noch nicht eingeordnet."}</div>
      </div>
    );
  }
  const r = Math.max(0, Math.min(3, insight.relevance));
  return (
    <div className="ai-box" aria-label="KI-Einordnung">
      <div className="ai-box-head">
        <span className="lbl">KI-EINORDNUNG</span>
        <span className="tag" title="Relevanz für den Kurs, 0 bis 3">{RELEVANCE_LABEL[r]}</span>
        <span className="tag">{EVENT_LABEL[insight.event] ?? insight.event}</span>
        <span className="tag">{insight.horizon}</span>
        <span style={{ color: sentimentColor(insight.sentiment) }}>
          Stimmung {sentimentLabel(insight.sentiment)} ({fmtSigned(insight.sentiment)})
        </span>
      </div>
      <div className="ai-box-text">{insight.summary}</div>
      {insight.reason && <div className="small muted">{insight.reason}</div>}
      {(insight.tickers.length > 0 || insight.sectors.length > 0) && (
        <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 3 }}>
          {insight.tickers.map((t) => (
            <TickerLink key={t} ticker={t} />
          ))}
          {insight.sectors.map((sec) => (
            <span key={sec} className="muted">{sec}</span>
          ))}
        </div>
      )}
      <div className="xs dim" style={{ marginTop: 3 }}>
        {engineLabel(insight.engine, insight.model)} · automatische Einschätzung, keine Anlageberatung
      </div>
    </div>
  );
}

function Reader({ n, onBack, related, onOpen, ai }: {
  n: NewsItem; onBack?: () => void; related: NewsItem[]; onOpen: (id: string) => void;
  ai?: { insight?: NewsInsight; pending: boolean; failed?: string } | null;
}) {
  const link = safeUrl(n.link);
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
      {ai && <InsightBox insight={ai.insight} pending={ai.pending} failed={ai.failed} />}
      <div style={{ fontFamily: "var(--sans)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
        {n.content || <span className="muted">Kein Volltext verfügbar.</span>}
      </div>
      {link && (
        <p>
          <a href={link} target="_blank" rel="noreferrer noopener">
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
            <button key={r.id} type="button" className="link-row small" onClick={() => onOpen(r.id)}>
              <span className="muted">{fmtAge(r.date)} </span>
              {r.title}
            </button>
          ))}
        </>
      )}
    </article>
  );
}

export function NewsTerminal({ tickers, compact, active, signal }: { tickers?: string[]; compact?: boolean; active: boolean; signal?: boolean }) {
  const ws = useWorkspace();
  const [topic, setTopic] = useState<string>("all");
  const [scope, setScope] = useState<"all" | "watch">("all");
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [relevantOnly, setRelevantOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(loadRead);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState<NewsItem | null>(null);
  // Hinweis „Lesen“ einer wichtigen Meldung: Filter zurücksetzen und die Meldung öffnen
  useIntent("TOP", (v) => {
    if (!signal || !v.newsId) return;
    setTopic("all");
    setScope("all");
    setSearch("");
    setUrgentOnly(false);
    setRelevantOnly(false);
    setPaused(false);
    setPinned(v.news ?? null);
    setSelectedId(v.newsId);
    if (!read.has(v.newsId)) {
      const next = new Set(read);
      next.add(v.newsId);
      setRead(next);
      saveRead(next);
    }
  });
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  // Die API nimmt bis zu 30 Ticker je Abfrage (vorher 10 – Werte ab Position 11 fehlten stumm)
  const effectiveTickers = tickers ?? (scope === "watch" ? ws.state.watchlist.slice(0, WATCH_NEWS_MAX) : undefined);
  const watchTruncated = !tickers && scope === "watch" && ws.state.watchlist.length > WATCH_NEWS_MAX;
  // Leere Watchlist: Eine leere Tickerliste würde sonst wie "alle Quellen" abgefragt
  const watchEmpty = !tickers && scope === "watch" && !ws.state.watchlist.length;
  const q = useNews({ tickers: effectiveTickers, topic, q: debounced || undefined, limit: 200 }, !watchEmpty);

  // Neue Meldungen seit dem letzten Abruf kurz hervorheben
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const frozen = useRef<NewsItem[] | null>(null);
  const items = useMemo(() => {
    const all = watchEmpty ? [] : q.data?.items ?? []; // keine Platzhalterdaten des vorigen Umfangs
    return urgentOnly ? all.filter((n) => n.urgent) : all;
  }, [q.data, urgentOnly, watchEmpty]);
  if (!paused) frozen.current = items;
  const unfiltered = paused && frozen.current ? frozen.current : items;

  // KI-Einordnung: die obersten 40 Meldungen im Hintergrund, die gelesene sofort
  const aiStatus = useAiStatus();
  const ai = aiAvailable(aiStatus.data);
  const top = useMemo(() => unfiltered.slice(0, AI_LIST_MAX), [unfiltered]);
  const listAi = useNewsInsights(top, "normal", aiStatus.data);
  const selectedItem = unfiltered.find((n) => n.id === selectedId) ?? (pinned && pinned.id === selectedId ? pinned : null);
  const selectedAi = useNewsInsights(selectedItem ? [selectedItem] : [], "high", aiStatus.data);
  const insightOf = (id: string): NewsInsight | undefined => selectedAi.data?.insights[id] ?? listAi.data?.insights[id];
  const pendingIds = new Set([...(listAi.data?.pending ?? []), ...(selectedAi.data?.pending ?? [])]);
  const shown = ai && relevantOnly ? unfiltered.filter((n) => (insightOf(n.id)?.relevance ?? -1) >= 2) : unfiltered;

  // CSV: die angezeigten Meldungen (mit KI-Einordnung, soweit vorhanden)
  useCsvExport(() => {
    if (!shown.length) return [];
    return [
      {
        title: "Nachrichten",
        columns: ["Datum", "Uhrzeit", "Titel", "Quelle", "Kürzel", "Eilmeldung", "Stimmung (Quelle)", "KI-Relevanz", "KI-Stimmung", "KI-Ereignis", "KI-Zusammenfassung", "Link"],
        rows: shown.map((n) => {
          const ins = insightOf(n.id);
          return [
            fmtDate(n.date),
            n.date.length > 10 ? fmtTime(n.date) : null,
            n.title,
            n.source,
            n.symbols.map(displayTicker).join(", "),
            n.urgent ? "ja" : "",
            isNum(n.sentiment.polarity) ? n.sentiment.polarity : null,
            ins ? RELEVANCE_LABEL[ins.relevance] ?? ins.relevance : null,
            ins ? ins.sentiment : null,
            ins ? EVENT_LABEL[ins.event] ?? ins.event : null,
            ins?.summary ?? null,
            safeUrl(n.link),
          ];
        }),
      },
    ];
  });

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

  const selected = selectedItem;
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
        {watchTruncated && <span className="small muted">erste {WATCH_NEWS_MAX} Werte</span>}
        <input className="field" placeholder="Suchen …" aria-label="News durchsuchen" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 150 }} />
        <label className="check">
          <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
          Nur Eilmeldungen
        </label>
        {ai && (
          <label className="check" title={`Nur Meldungen, die die KI als kursrelevant einstuft (Relevanz 2 oder 3). Eingeordnet werden die neuesten ${AI_LIST_MAX} Meldungen.`}>
            <input type="checkbox" checked={relevantOnly} onChange={(e) => setRelevantOnly(e.target.checked)} />
            KI: kursrelevant
          </label>
        )}
        {signal && !IS_STATIC && <SignalControl />}
        <button className="btn" onClick={() => setPaused((p) => !p)} title={paused ? "Live-Aktualisierung fortsetzen" : "Liste anhalten, um in Ruhe zu lesen"}>
          {paused ? "▶ Fortsetzen" : "❚❚ Anhalten"}
        </button>
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {shown.length} Meldungen · {unread} ungelesen
          {!paused && <span className="up" title="Neue Meldungen erscheinen automatisch"> · AUTO</span>}
        </span>
      </div>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: twoCol ? "minmax(0, 11fr) minmax(0, 9fr)" : "minmax(0, 1fr)" }}>
        {(!selected || twoCol) && (
          <div role="listbox" aria-label="Meldungen" style={{ overflow: "auto", minHeight: 0, borderRight: twoCol ? "1px solid var(--rule)" : undefined }}>
            {watchEmpty ? (
              <Empty>Die Watchlist ist leer – keine Meldungen.</Empty>
            ) : q.isPending ? (
              <Loading rows={10} />
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !shown.length ? (
              <Empty>
                {ai && relevantOnly
                  ? listAi.data?.pending.length
                    ? "Die KI ordnet die Meldungen noch ein …"
                    : `Keine kursrelevanten Meldungen unter den neuesten ${AI_LIST_MAX}.`
                  : "Keine Meldungen für diese Auswahl."}
              </Empty>
            ) : (
              shown.map((n) => (
                <NewsRow
                  key={n.id}
                  n={n}
                  selected={n.id === selectedId}
                  read={read.has(n.id)}
                  fresh={fresh.has(n.id)}
                  onOpen={() => open(n)}
                  ai={ai}
                  insight={insightOf(n.id)}
                  pending={pendingIds.has(n.id)}
                />
              ))
            )}
            {q.data?.sourcesNote && <div className="notes">{q.data.sourcesNote}</div>}
          </div>
        )}
        {twoCol && !selected && <Empty>Meldung auswählen (Klick oder ↑/↓), um sie hier zu lesen.</Empty>}
        {selected && (
          <div style={{ overflow: "auto", minHeight: 0 }}>
            <Reader n={selected} related={related} ai={ai ? { insight: insightOf(selected.id), pending: pendingIds.has(selected.id), failed: selectedAi.data?.failed[selected.id] } : null} onOpen={(id) => {
              const r = unfiltered.find((x) => x.id === id);
              if (r) open(r);
            }} onBack={twoCol ? undefined : () => setSelectedId(null)} />
          </div>
        )}
      </div>
    </>
  );
}

const WATCH_NEWS_MAX = 30;
const AI_LIST_MAX = 40;

export function TOP({ active }: ScreenProps) {
  return <NewsTerminal active={active} signal />;
}

/** Einstellungen des Nachrichten-Signals (Ton und Hinweis bei wichtigen Meldungen). */
function SignalControl() {
  const [s, setS] = usePersistentState<SignalSettings>("news.signal", DEFAULT_SIGNAL, isSignalSettings);
  const update = (patch: Partial<SignalSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    // der Signalgeber in diesem Fenster übernimmt die Einstellung sofort
    window.dispatchEvent(new CustomEvent<SignalSettings>(SIGNAL_EVENT, { detail: next }));
  };
  return (
    <span className="signal-ctl" title="Ton und Hinweis unten rechts bei wichtigen Meldungen – auch wenn TOP nicht offen ist">
      <span className="small muted">🔔 Signal</span>
      <select className="field" aria-label="Signal bei Meldungen" value={s.mode} onChange={(e) => update({ mode: e.target.value as SignalSettings["mode"] })}>
        <option value="off">aus</option>
        <option value="urgent">Eilmeldungen</option>
        <option value="important">Eil + kursrelevant (KI)</option>
      </select>
      {s.mode !== "off" && (
        <>
          <select className="field" aria-label="Signal für" value={s.scope} onChange={(e) => update({ scope: e.target.value as SignalSettings["scope"] })}>
            <option value="mine">Watchlist + Depot</option>
            <option value="all">alle Meldungen</option>
          </select>
          <label className="check" title="Signalton (sonst nur der Hinweis)">
            <input type="checkbox" checked={s.sound} onChange={(e) => update({ sound: e.target.checked })} />
            Ton
          </label>
          <button type="button" className="tool" title="Ton probehören" onClick={() => newsTone(s.mode === "urgent")}>
            ▶
          </button>
        </>
      )}
    </span>
  );
}

export function CN({ ticker, active }: ScreenProps) {
  return <NewsTerminal tickers={ticker ? [ticker] : []} compact active={active} />;
}
