// Echtzeit-Kurse im Browser: ein Ereignisstrom (Server-Sent Events) je Fenster für alle gerade
// sichtbaren Werte. Kopfzeilen, Watchlist und andere Kursanzeigen werden über den React-Query-Cache
// aktualisiert; der Kurschart zeichnet damit die laufende Kerze.

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { IS_STATIC } from "./api";
import type { Quote } from "./types";

export interface LiveTick {
  t: string; // Ticker (EODHD-Format, z. B. NWND.US)
  p: number; // Kurs
  ts: number; // Millisekunden UTC
  v?: number; // Stückzahl des Abschlusses
  d?: 1; // verzögert (kein Echtzeit-Strom für diesen Wert)
}

export interface LiveStatus {
  mode: string; // "eodhd", "demo" oder "aus"
  connected: boolean;
  live: string[];
  delayed: string[];
  symbols: number;
  limit: number;
  message: string | null;
}

type TickFn = (ticks: LiveTick[]) => void;

class LiveManager {
  private es: EventSource | null = null;
  private refs = new Map<string, number>();
  private current = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickFns = new Set<TickFn>();
  private statusFns = new Set<(s: LiveStatus | null) => void>();
  status: LiveStatus | null = null;
  last = new Map<string, LiveTick>();

  /** Interesse an Werten anmelden; die Rückgabe meldet es wieder ab. */
  want(tickers: string[]): () => void {
    const list = Array.from(new Set(tickers.filter(Boolean)));
    for (const t of list) this.refs.set(t, (this.refs.get(t) ?? 0) + 1);
    this.schedule();
    return () => {
      for (const t of list) {
        const n = (this.refs.get(t) ?? 1) - 1;
        if (n <= 0) this.refs.delete(t);
        else this.refs.set(t, n);
      }
      this.schedule();
    };
  }

  onTicks(fn: TickFn): () => void {
    this.tickFns.add(fn);
    return () => this.tickFns.delete(fn);
  }

  onStatus(fn: (s: LiveStatus | null) => void): () => void {
    this.statusFns.add(fn);
    return () => this.statusFns.delete(fn);
  }

  isLive(ticker: string | null | undefined): boolean {
    return !!ticker && !!this.status?.live.includes(ticker);
  }

  private schedule() {
    if (IS_STATIC || typeof EventSource === "undefined") return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reconnect(), 250); // mehrere Änderungen bündeln
  }

  private reconnect() {
    const list = Array.from(this.refs.keys()).sort().slice(0, 60);
    const key = list.join(",");
    if (key === this.current && this.es) return;
    this.es?.close();
    this.es = null;
    this.current = key;
    if (!list.length) return;
    const es = new EventSource(`/api/stream?tickers=${encodeURIComponent(key)}`);
    es.addEventListener("status", (e) => {
      try {
        this.status = JSON.parse((e as MessageEvent).data) as LiveStatus;
        for (const fn of this.statusFns) fn(this.status);
      } catch {
        /* unvollständige Nachricht */
      }
    });
    es.onmessage = (e) => {
      let ticks: LiveTick[];
      try {
        ticks = JSON.parse(e.data) as LiveTick[];
      } catch {
        return;
      }
      for (const t of ticks) this.last.set(t.t, t);
      for (const fn of this.tickFns) fn(ticks);
    };
    // Bei Verbindungsabbruch verbindet sich EventSource selbst neu (Server neu gestartet …)
    this.es = es;
  }
}

export const live = new LiveManager();

/** Kurs mit einem jüngeren Echtzeit-Tick aktualisieren (verzögerte Ticks ändern Kurse nicht). */
export function mergeTick(q: Quote, tick: LiveTick): Quote {
  if (tick.d) return q;
  const qts = q.timestamp ? Date.parse(q.timestamp) : 0;
  if (Number.isFinite(qts) && tick.ts <= qts) return q;
  const p = tick.p;
  const prev = q.prevClose;
  return {
    ...q,
    last: p,
    change: prev ? p - prev : q.change,
    changePct: prev ? (p / prev - 1) * 100 : q.changePct,
    high: q.high !== null ? Math.max(q.high, p) : q.high,
    low: q.low !== null ? Math.min(q.low, p) : q.low,
    timestamp: new Date(tick.ts).toISOString(),
    delayed: false,
  };
}

function quoteTickers(qc: QueryClient): string[] {
  const out = new Set<string>();
  for (const q of qc.getQueryCache().findAll({ queryKey: ["quotes"], type: "active" })) {
    const tickers = q.queryKey[1];
    if (Array.isArray(tickers)) for (const t of tickers) if (typeof t === "string") out.add(t);
  }
  return Array.from(out);
}

/**
 * Einmal je Fenster: alle gerade angezeigten Kurse abonnieren und Ticks in den Cache schreiben
 * (höchstens zweimal pro Sekunde), damit jede Kursanzeige ohne eigene Logik live läuft.
 */
export function useLiveQuotesBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    if (IS_STATIC) return;
    let release: (() => void) | null = null;
    let key = "";
    const refresh = () => {
      const tickers = quoteTickers(qc).sort();
      const k = tickers.join(",");
      if (k === key) return;
      key = k;
      release?.();
      release = live.want(tickers);
    };
    refresh();
    const iv = setInterval(refresh, 3000);
    let pending = new Map<string, LiveTick>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const ticks = pending;
      pending = new Map();
      qc.setQueriesData<Quote[]>({ queryKey: ["quotes"] }, (old) => {
        if (!Array.isArray(old)) return old;
        let changed = false;
        const next = old.map((q) => {
          const t = ticks.get(q.ticker);
          if (!t) return q;
          const m = mergeTick(q, t);
          if (m !== q) changed = true;
          return m;
        });
        return changed ? next : old;
      });
    };
    const off = live.onTicks((ticks) => {
      for (const t of ticks) if (!t.d) pending.set(t.t, t);
      if (pending.size && !flushTimer) flushTimer = setTimeout(flush, 500);
    });
    return () => {
      clearInterval(iv);
      off();
      release?.();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [qc]);
}

/** Status des Stroms (live/verzögert je Wert) für Anzeigen wie „● Echtzeit“. */
export function useLiveStatus(): LiveStatus | null {
  const [s, setS] = useState<LiveStatus | null>(live.status);
  useEffect(() => live.onStatus(setS), []);
  return s;
}
