// BRIEF – Morgenbriefing und ASK – Fragen an die KI (LM Studio oder Demo-KI).
// Die KI liest nur Daten des Terminals. Funktionen und Wertpapiere öffnen erst nach einem Klick.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Empty, ErrorState, Loading, useNow } from "../components/ui";
import {
  aiApi,
  aiAvailable,
  aiErrorText,
  engineLabel,
  exampleQuestions,
  useAiStatus,
  type AiStatus,
  type AskResult,
  type Brief,
  type ChatTurn,
  type Suggestion,
} from "../lib/ai";
import { IS_STATIC } from "../lib/api";
import { FN, type FnCode } from "../lib/commands";
import { displayTicker, fmtTime } from "../lib/format";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

const isFnCode = (x: string | null | undefined): x is FnCode => !!x && Object.prototype.hasOwnProperty.call(FN, x);

/** Hinweis, wenn keine KI verfügbar ist (mit den Schritten für LM Studio). */
export function AiUnavailable({ status, error }: { status?: AiStatus; error?: unknown }) {
  return (
    <div className="state" style={{ alignItems: "flex-start", textAlign: "left" }}>
      <div style={{ maxWidth: "70ch", fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5 }}>
        <div className="lbl" style={{ fontFamily: "var(--mono)", marginBottom: 4 }}>KI NICHT VERFÜGBAR</div>
        <div>{status?.message ?? (error ? aiErrorText(error) : "Status wird geladen …")}</div>
        {status?.mode !== "off" && !IS_STATIC && (
          <ol className="small muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>LM Studio öffnen und ein Modell laden (z. B. Qwen 3 8B oder Llama 3.1 8B Instruct).</li>
            <li>Links auf „Developer“ gehen und den Server starten (Adresse {status?.baseUrl ?? "http://localhost:1234/v1"}).</li>
            <li>Ein paar Sekunden warten: Die Anzeige unten rechts wechselt auf „KI: LM Studio“.</li>
          </ol>
        )}
      </div>
    </div>
  );
}

/** Wartezeit-Anzeige für lokale Modelle (zählt Sekunden). */
function Working({ since, text }: { since: number; text: string }) {
  const now = useNow(1000);
  const secs = Math.max(0, Math.round((now - since) / 1000));
  return (
    <span className="ai-working">
      <span className="ai-spin" aria-hidden="true" />
      {text} {secs > 1 ? `(${secs} s)` : ""}
    </span>
  );
}

// --- BRIEF ---------------------------------------------------------------------------

export function BRIEF(_: ScreenProps) {
  const ws = useWorkspace();
  const status = useAiStatus();
  const qc = useQueryClient();
  const tickers = ws.state.watchlist.slice(0, 30);
  const on = aiAvailable(status.data);
  const key = ["ai-brief", status.data?.mode, tickers.join(",")];
  const [started, setStarted] = useState(() => Date.now());
  const q = useQuery({
    queryKey: key,
    queryFn: () => {
      setStarted(Date.now());
      return aiApi.brief(tickers, false);
    },
    enabled: on,
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    setStarted(Date.now());
    try {
      qc.setQueryData(key, await aiApi.brief(tickers, true));
    } catch (e) {
      setRefreshError(e);
    } finally {
      setRefreshing(false);
    }
  }

  if (status.isPending) return <Loading rows={4} />;
  if (!on) return <AiUnavailable status={status.data} error={status.error} />;
  const b = q.data;
  const busy = q.isFetching || refreshing;
  return (
    <>
      <div className="toolbar">
        <span className="lbl">MORGENBRIEFING</span>
        {b && <span className="small muted">erstellt {fmtTime(b.created)} · {engineLabel(b.engine, b.model)}</span>}
        <button className="btn" style={{ marginLeft: "auto" }} onClick={refresh} disabled={busy || IS_STATIC} title="Mit den aktuellen Daten neu erstellen">
          ↻ Neu erstellen
        </button>
      </div>
      <div className="panel-body" style={{ padding: "8px 14px", overflow: "auto" }}>
        {busy && (
          <div style={{ marginBottom: 8 }}>
            <Working since={started} text={status.data?.mode === "lmstudio" ? "Das Sprachmodell schreibt das Briefing …" : "Briefing wird erstellt …"} />
          </div>
        )}
        {q.isError && !b ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !b ? (
          !busy && <Empty>Noch kein Briefing.</Empty>
        ) : (
          <BriefView brief={b} openFn={ws.openFn} />
        )}
        {refreshError != null && <div className="small down" style={{ marginTop: 6 }}>Neu erstellen fehlgeschlagen: {aiErrorText(refreshError)}</div>}
      </div>
    </>
  );
}

export function BriefView({ brief, openFn }: { brief: Brief; openFn: (fn: FnCode) => void }) {
  // Meldungen in der Reihenfolge ihrer ersten Nennung nummerieren
  const numbers = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of brief.sections) for (const p of s.points) for (const src of p.sources) if (brief.news[src] && !m.has(src)) m.set(src, m.size + 1);
    return m;
  }, [brief]);
  return (
    <article style={{ maxWidth: "90ch" }}>
      <h2 className="brief-headline">{brief.headline}</h2>
      {!brief.sections.length && <Empty>Für heute liegen kaum Daten vor.</Empty>}
      {brief.sections.map((s) => (
        <section key={s.title} style={{ marginBottom: 8 }}>
          <div className="section-title">{s.title}</div>
          <ul className="brief-points">
            {s.points.map((p, i) => (
              <li key={i}>
                <span>{p.text}</span>
                {p.sources.map((src) =>
                  isFnCode(src) ? (
                    <button key={src} type="button" className="src-chip fn" title={`${FN[src].title} öffnen`} onClick={() => openFn(src)}>
                      {src}
                    </button>
                  ) : numbers.has(src) ? (
                    <span key={src} className="src-chip" title={brief.news[src]}>
                      {numbers.get(src)}
                    </span>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {numbers.size > 0 && (
        <>
          <div className="section-title">Meldungen</div>
          <ol className="brief-sources small">
            {Array.from(numbers.entries()).map(([id, n]) => (
              <li key={id} value={n}>
                {brief.news[id]}
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="xs dim" style={{ marginTop: 10 }}>
        Automatisch aus den Terminal-Daten erstellt. Kürzel wie WEI oder ECO öffnen die Quelle. Keine Anlageberatung.
      </div>
    </article>
  );
}

// --- ASK -----------------------------------------------------------------------------

type Msg = { role: "user"; text: string } | { role: "assistant"; result: AskResult } | { role: "error"; text: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Antworttext mit **fett** und markierten Zahlen ohne Beleg. */
export function AnswerText({ text, unverified }: { text: string; unverified: string[] }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  const re = unverified.length ? new RegExp(`(?<![\\d.,])(${unverified.map(escapeRe).join("|")})(?![\\d])`, "g") : null;
  const mark = (chunk: string, key: string): ReactNode[] => {
    if (!re) return [chunk];
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of chunk.matchAll(re)) {
      const at = m.index ?? 0;
      if (at > last) out.push(chunk.slice(last, at));
      out.push(
        <mark key={`${key}-${at}`} className="unverified" title="Diese Zahl steht in keinem der abgefragten Datensätze – bitte selbst prüfen.">
          {m[0]}
        </mark>,
      );
      last = at + m[0].length;
    }
    if (last < chunk.length) out.push(chunk.slice(last));
    return out;
  };
  return (
    <div className="ai-answer">
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={i}>{mark(p.slice(2, -2), `b${i}`)}</b> : <Fragment key={i}>{mark(p, `t${i}`)}</Fragment>,
      )}
    </div>
  );
}

function Answer({ r, onSuggestion }: { r: AskResult; onSuggestion: (s: Suggestion) => void }) {
  return (
    <div className="chat-a">
      <AnswerText text={r.answer} unverified={r.unverified} />
      {r.suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {r.suggestions.map((s) => (
            <button key={s.label} type="button" className="btn" onClick={() => onSuggestion(s)} title="Im Terminal öffnen">
              → {s.ticker ? `${displayTicker(s.ticker)} ${s.fn}` : s.label}
            </button>
          ))}
        </div>
      )}
      {r.trace.length > 0 && (
        <details className="ai-trace">
          <summary>Verwendete Daten ({r.trace.length})</summary>
          <ul>
            {r.trace.map((t, i) => (
              <li key={i} className={t.ok ? "" : "down"}>
                {t.ok ? "✓" : "✗"} {t.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="xs dim" style={{ marginTop: 4 }}>
        {engineLabel(r.engine, r.model)}
        {r.engine === "lmstudio" ? ` · ${r.steps} Schritt${r.steps === 1 ? "" : "e"} · ${r.seconds.toFixed(1).replace(".", ",")} s` : ""}
        {r.unverified.length > 0 && (
          <span className="warn">
            {" "}
            · {r.unverified.length} Zahl{r.unverified.length === 1 ? "" : "en"} ohne Beleg markiert
          </span>
        )}
      </div>
    </div>
  );
}

export function ASK({ active }: ScreenProps) {
  const ws = useWorkspace();
  const status = useAiStatus();
  const on = aiAvailable(status.data);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<{ since: number; ctrl: AbortController } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const staticExamples = useQuery({ queryKey: ["ai-examples"], queryFn: aiApi.examples, enabled: IS_STATIC, staleTime: Infinity });
  const security = ws.state.security;
  const examples = IS_STATIC ? staticExamples.data ?? [] : exampleQuestions(security ? displayTicker(security) : null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Laufende Frage abbrechen, wenn das Panel geschlossen wird
  const ctrlRef = useRef<AbortController | null>(null);
  useEffect(() => () => ctrlRef.current?.abort(), []);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history: ChatTurn[] = [];
    for (const m of messages.slice(-8)) {
      if (m.role === "user") history.push({ role: "user", content: m.text.slice(0, 2000) });
      else if (m.role === "assistant") history.push({ role: "assistant", content: m.result.answer.slice(0, 2000) });
    }
    setMessages((ms) => [...ms, { role: "user", text }]);
    setInput("");
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setBusy({ since: Date.now(), ctrl });
    try {
      const result = await aiApi.ask({ question: text.slice(0, 2000), ticker: security, watchlist: ws.state.watchlist.slice(0, 30), history: history.slice(-6) }, ctrl.signal);
      setMessages((ms) => [...ms, { role: "assistant", result }]);
    } catch (e) {
      setMessages((ms) => [...ms, { role: "error", text: aiErrorText(e) }]);
    } finally {
      setBusy(null);
      field.current?.focus();
    }
  }

  function onSuggestion(s: Suggestion) {
    if (!isFnCode(s.fn)) return;
    if (s.ticker && FN[s.fn].needsTicker) {
      // Seite mit Aktien-Panels: dort bleiben (Nachbarpanel), sonst zur Seite AKTIE
      const stay = ws.state.pages[ws.state.page].panels.some((f) => FN[f].needsTicker);
      ws.setSecurity(s.ticker, { open: s.fn, stay });
    } else {
      ws.openFn(s.fn);
    }
  }

  if (status.isPending) return <Loading rows={4} />;
  if (!on) return <AiUnavailable status={status.data} error={status.error} />;
  return (
    <>
      <div className="toolbar">
        <span className="lbl">KI-ASSISTENT</span>
        <span className="small muted">{engineLabel(status.data?.mode === "lmstudio" ? "lmstudio" : "demo", status.data?.model)}</span>
        {security && <span className="small muted">· Kontext {displayTicker(security)}</span>}
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => setMessages([])} disabled={!messages.length || !!busy}>
          Neues Gespräch
        </button>
      </div>
      <div ref={scroller} className="chat" aria-live="polite">
        {!messages.length && (
          <div className="small muted" style={{ fontFamily: "var(--sans)", fontSize: 13, lineHeight: 1.5, maxWidth: "75ch" }}>
            Fragen Sie in eigenen Worten, zum Beispiel nach einer Aktie, nach Terminen oder nach dem Markt. Die KI holt sich die Zahlen aus dem Terminal
            und zeigt unter jeder Antwort, welche Daten sie genutzt hat. Zahlen ohne Beleg werden <mark className="unverified">markiert</mark>. Sie kann
            nichts kaufen, verkaufen oder verändern.
            {status.data?.mode === "demo" && (
              <div style={{ marginTop: 4 }}>
                Gerade antwortet die <b>Demo-KI</b> nach festen Regeln. Mit LM Studio versteht sie freie Fragen.
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="chat-q">{m.text}</div>
          ) : m.role === "assistant" ? (
            <Answer key={i} r={m.result} onSuggestion={onSuggestion} />
          ) : (
            <div key={i} className="chat-a down">{m.text}</div>
          ),
        )}
        {busy && (
          <div className="chat-a">
            <Working since={busy.since} text={status.data?.mode === "lmstudio" ? "Das Sprachmodell sucht Daten und formuliert …" : "Suche Daten …"} />
            <button className="btn" style={{ marginLeft: 8 }} onClick={() => busy.ctrl.abort()}>
              Abbrechen
            </button>
          </div>
        )}
      </div>
      {examples.length > 0 && !busy && !messages.length && (
        <div className="ai-examples">
          {examples.slice(0, 6).map((ex) => (
            <button key={ex} type="button" className="ex-chip" onClick={() => send(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={field}
          className="field"
          rows={2}
          maxLength={2000}
          value={input}
          placeholder="Frage an die KI … (Enter sendet, Umschalt+Enter neue Zeile)"
          aria-label="Frage an die KI"
          autoFocus={active}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={!input.trim() || !!busy}>
          Fragen
        </button>
      </form>
    </>
  );
}
