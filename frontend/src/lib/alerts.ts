// Kursalarme und Kursmarken: /api/alerts, Abfrage-Hook und Hilfen für Benachrichtigungen.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, IS_STATIC, request } from "./api";
import { fmt, fmtPrice } from "./format";

export type AlertKind = "price" | "change";
export type Direction = "above" | "below";

export interface Alert {
  id: string;
  ticker: string;
  kind: AlertKind;
  level: number;
  direction: Direction;
  alarm: boolean;
  active: boolean;
  note: string;
  created: string;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  price?: number | null;
  changePct?: number | null;
  distancePct?: number | null;
  name?: string | null;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  ticker: string;
  kind: AlertKind;
  level: number;
  direction: Direction;
  price: number | null;
  changePct: number | null;
  at: string;
  message: string;
}

export interface AlertsResponse {
  alerts: Alert[];
  events: AlertEvent[];
  interval: number;
  checkedAt: string | null;
}

export interface AlertInput {
  ticker: string;
  kind: AlertKind;
  level: number;
  direction?: Direction | null;
  alarm?: boolean;
  note?: string;
}

export type AlertPatch = Partial<Pick<Alert, "level" | "direction" | "alarm" | "active" | "note">>;

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

const STATIC_MSG = "In der statischen Demo gibt es keine Alarme. Lokal gestartet prüft das Terminal sie im Hintergrund.";
const staticFail = async (): Promise<never> => {
  throw new ApiError(403, "static", STATIC_MSG);
};

export const alertsApi = IS_STATIC
  ? {
      list: async (): Promise<AlertsResponse> => ({ alerts: [], events: [], interval: 0, checkedAt: null }),
      create: staticFail as (a: AlertInput) => Promise<Alert>,
      update: staticFail as (id: string, p: AlertPatch) => Promise<Alert>,
      remove: staticFail as (id: string) => Promise<unknown>,
      clearEvents: staticFail as () => Promise<unknown>,
      check: staticFail as () => Promise<AlertEvent[]>,
    }
  : {
      // Leise: Die Abfrage alle 15 s soll die Datenanzeige der Statusleiste nicht beeinflussen
      list: () => request<AlertsResponse>("/alerts", undefined, { quiet: true }),
      create: (a: AlertInput) => request<Alert>("/alerts", json("POST", a)),
      update: (id: string, p: AlertPatch) => request<Alert>(`/alerts/${encodeURIComponent(id)}`, json("PATCH", p)),
      remove: (id: string) => request<unknown>(`/alerts/${encodeURIComponent(id)}`, json("DELETE")),
      clearEvents: () => request<unknown>("/alerts/events", json("DELETE")),
      check: () => request<AlertEvent[]>("/alerts/check", json("POST")),
    };

export const useAlerts = () =>
  useQuery({ queryKey: ["alerts"], queryFn: alertsApi.list, refetchInterval: IS_STATIC ? false : 15_000, staleTime: 5_000 });

/** Nach einer Änderung die Liste neu laden (auch die Linien im Chart). */
export function useAlertsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["alerts"] });
}

export function conditionLabel(a: Pick<Alert, "kind" | "level" | "direction" | "ticker">): string {
  if (a.kind === "change") return `Tages${a.direction === "above" ? "plus" : "minus"} ab ${fmt(a.level, a.level < 1 ? 2 : 1)} %`;
  return `${a.direction === "above" ? "über" : "unter"} ${fmtPrice(a.level, a.ticker)}`;
}

export type AlertStatus = "armed" | "fired" | "off" | "mark";

export function alertStatus(a: Alert): AlertStatus {
  if (!a.alarm) return "mark";
  if (a.active) return "armed";
  return a.triggeredAt ? "fired" : "off";
}

// --- Bereits gemeldete Auslösungen (fensterübergreifend, damit nur ein Fenster meldet) ----------

const SEEN_KEY = "mt.alerts.seen.v1";

export function readSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw === null ? null : new Set(JSON.parse(raw) as string[]);
  } catch {
    return null;
  }
}

export function writeSeen(ids: Iterable<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(ids).slice(-300)));
  } catch {
    /* ohne Speicher meldet jedes Fenster selbst */
  }
}

/**
 * Neue, noch nicht gemeldete Auslösungen. Beim allerersten Start (noch keine Liste) gelten alle
 * vorhandenen als gesehen – sonst käme eine Flut alter Meldungen.
 */
export function takeNewEvents(events: AlertEvent[], seen: Set<string> | null): { fresh: AlertEvent[]; seen: Set<string> } {
  if (seen === null) return { fresh: [], seen: new Set(events.map((e) => e.id)) };
  const fresh = events.filter((e) => !seen.has(e.id));
  const next = new Set(seen);
  for (const e of fresh) next.add(e.id);
  return { fresh, seen: next };
}

/** Kurzer Signalton ohne Audiodatei. */
export function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, start: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + 0.3);
    };
    tone(880, 0);
    tone(1175, 0.18);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* ohne Ton */
  }
}
