// Startprotokoll: zeigt die tatsächlichen Ladeschritte beim ersten Öffnen einer Sitzung.
// Jede Zeile erscheint erst, wenn der Schritt wirklich abgeschlossen ist; die geladenen
// Daten liegen danach im Cache und füllen die Panels sofort.

import { useEffect, useMemo, useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, IS_STATIC } from "../lib/api";
import { displayTicker } from "../lib/format";
import { useCalendar, useIndices, useNews, useQuotes, useStatus } from "../lib/queries";
import { PAGES, useWorkspace } from "../state/workspace";

const BOOT_KEY = "mt.booted";
const MAX_MS = 2600;
const MIN_MS = 650;

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function thisWeek(): { from: string; to: string } {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

/** Soll das Startprotokoll in dieser Sitzung erscheinen? */
export function shouldBoot(): boolean {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    if (sessionStorage.getItem(BOOT_KEY)) return false;
  } catch {
    /* ohne sessionStorage einfach anzeigen */
  }
  return true;
}

interface Step {
  label: string;
  q: UseQueryResult<unknown> | null;
  ok: (data: never) => string;
  fixed?: string;
  /** Schritt kann noch nicht beginnen (z. B. Watchlist vor dem Datenmodus) */
  waiting?: boolean;
}

export function Boot({ onDone }: { onDone: () => void }) {
  const ws = useWorkspace();
  const status = useStatus();
  const indices = useIndices();
  const watch = useQuotes(ws.state.watchlist.slice(0, 20));
  const week = useMemo(thisWeek, []);
  // Gleiche Abfrageparameter wie ECO und TOP, damit die Panels die Daten wiederverwenden
  const calendar = useCalendar({ ...week, country: undefined, importance: 1 });
  const news = useNews({ tickers: undefined, topic: "all", q: undefined, limit: 200 });
  const [leaving, setLeaving] = useState(false);
  const started = useRef(Date.now());
  const finished = useRef(false);

  const steps: Step[] = [
    {
      label: "Datenquelle",
      q: status as UseQueryResult<unknown>,
      ok: (d: { mode: string }) => (IS_STATIC ? "STATISCHE DEMO (synthetisch)" : d.mode === "eodhd" ? "EODHD · verzögerte Kurse" : "DEMO (synthetisch)"),
    },
    {
      label: "Weltindizes",
      q: indices as UseQueryResult<unknown>,
      ok: (d: { last: number | null }[]) => `${d.filter((r) => r.last !== null).length}/${d.length} geladen`,
    },
    {
      label: "Watchlist",
      q: ws.state.watchlist.length ? (watch as UseQueryResult<unknown>) : null,
      ok: (d: { last: number | null }[]) => `${d.filter((r) => r.last !== null).length} Werte mit Kurs`,
      fixed: "leer",
      // Die Standard-Watchlist kommt erst mit dem Datenmodus; vorher wäre "leer" nur ein Zwischenstand
      waiting: !ws.state.mode,
    },
    {
      label: "Wirtschaftskalender",
      q: calendar as UseQueryResult<unknown>,
      ok: (d: unknown[]) => `${d.length} Termine diese Woche`,
    },
    {
      label: "Nachrichten",
      q: news as UseQueryResult<unknown>,
      ok: (d: { items: { urgent: boolean }[] }) => `${d.items.length} Meldungen, ${d.items.filter((n) => n.urgent).length} Eilmeldungen`,
    },
  ];

  const settled = steps.map((s) => !s.waiting && (!s.q || s.q.isSuccess || s.q.isError));
  const shown = settled.findIndex((x) => !x);
  const visible = shown < 0 ? steps.length : shown;
  const allDone = shown < 0;

  function finish() {
    if (finished.current) return;
    finished.current = true;
    try {
      sessionStorage.setItem(BOOT_KEY, "1");
    } catch {
      /* ignorieren */
    }
    setLeaving(true);
    setTimeout(onDone, 260);
  }

  useEffect(() => {
    const hard = setTimeout(finish, MAX_MS);
    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      clearTimeout(hard);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!allDone) return;
    const wait = Math.max(MIN_MS - (Date.now() - started.current), 0) + 380;
    const t = setTimeout(finish, wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  const page = PAGES.find((p) => p.id === ws.state.page);

  return (
    <div className={`boot ${leaving ? "boot-out" : ""}`} role="status" aria-live="polite" aria-label="Terminal wird gestartet">
      <div className="boot-box">
        <div className="boot-title">
          <span className="brand-mark">MT</span> MARKET TERMINAL
        </div>
        {steps.slice(0, Math.min(visible + 1, steps.length)).map((s, i) => {
          const done = settled[i];
          const err = s.q?.isError ? s.q.error : null;
          const text = s.waiting
            ? "lädt"
            : !s.q
              ? s.fixed ?? ""
              : err
                ? err instanceof ApiError
                  ? err.message
                  : "Fehler"
                : done
                  ? s.ok(s.q.data as never)
                  : "lädt";
          return (
            <div key={s.label} className="boot-line">
              <span className="boot-label">› {s.label}</span>
              <span className="boot-dots" aria-hidden="true" />
              <span className={err ? "down" : done ? "flat" : "muted"}>{text}</span>
              <span className={`boot-state ${err ? "down" : done ? "up" : "muted"}`}>{err ? "FEHLER" : done ? "OK" : <span className="boot-spin" />}</span>
            </div>
          );
        })}
        {allDone && (
          <div className="boot-line">
            <span className="boot-label">› Arbeitsbereich</span>
            <span className="boot-dots" aria-hidden="true" />
            <span className="flat">
              {page?.label}
              {ws.state.security ? ` · ${displayTicker(ws.state.security)}` : ""}
              {ws.state.window !== "main" ? " · Zusatzfenster" : ""}
            </span>
            <span className="boot-state up">OK</span>
          </div>
        )}
        <div className="boot-foot">
          {allDone ? <span className="lbl">BEREIT</span> : <span className="muted">Startet …</span>}
          <span className="boot-cursor" aria-hidden="true" />
          <span className="dim boot-skip">Beliebige Taste überspringt</span>
        </div>
      </div>
    </div>
  );
}
