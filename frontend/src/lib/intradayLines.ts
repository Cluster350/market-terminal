// Intraday-Linien für Vergleichsdiagramme (CRYP 24 h / 7 Tage, FCTR Heute / 5 Tage): mehrere Werte auf einmal,
// auf 100 normiert bzw. als Verhältnis zum Markt.

import { useQueries } from "@tanstack/react-query";
import { api, IS_STATIC } from "./api";
import type { Interval } from "./intervals";
import type { Intraday } from "./types";

export const useIntradaySet = (tickers: string[], days: number, interval: Interval, enabled: boolean) =>
  useQueries({
    queries: tickers.map((t) => ({
      queryKey: ["intraday", t, days, interval],
      queryFn: () => api.intraday(t, days, interval),
      enabled: enabled && !IS_STATIC && !!t,
      staleTime: 60_000,
      refetchInterval: enabled ? 60_000 : (false as const),
      retry: false,
    })),
  });

/** Kurse ab ``fromTs`` (Sekunden) als [Zeit in ms, Wert], auf den ersten Kurs im Zeitraum = 100 normiert. */
export function intradayNormalized(d: Intraday | undefined, fromTs: number): [number, number][] {
  const out: [number, number][] = [];
  if (!d) return out;
  let base: number | null = null;
  d.t.forEach((ts, i) => {
    const c = d.c[i];
    if (ts < fromTs || c === null || c === undefined || !(c > 0)) return;
    if (base === null) base = c;
    out.push([ts * 1000, (c / base) * 100]);
  });
  return out;
}

/** Verhältnis a ÷ b an gemeinsamen Zeitpunkten ab ``fromTs``, auf 100 normiert (steigt = a läuft besser). */
export function intradayRatio(a: Intraday | undefined, b: Intraday | undefined, fromTs: number): [number, number][] {
  if (!a || !b) return [];
  const mb = new Map<number, number>();
  b.t.forEach((ts, i) => {
    const c = b.c[i];
    if (c !== null && c !== undefined && c > 0) mb.set(ts, c);
  });
  const out: [number, number][] = [];
  let base: number | null = null;
  a.t.forEach((ts, i) => {
    const c = a.c[i];
    const m = mb.get(ts);
    if (ts < fromTs || c === null || c === undefined || !(c > 0) || !m) return;
    const r = c / m;
    if (base === null) base = r;
    out.push([ts * 1000, (r / base) * 100]);
  });
  return out;
}

/** Beginn des Zeitraums: letzter Zeitstempel aller Reihen minus ``hours`` (für „24 Stunden“, „7 Tage“). */
export function windowStart(sets: (Intraday | undefined)[], hours: number): number {
  const last = Math.max(0, ...sets.map((d) => (d && d.t.length ? d.t[d.t.length - 1] : 0)));
  return last - hours * 3600;
}

/** Intraday-Kurse in US-Dollar in Euro umrechnen: Kurs ÷ EUR/USD zum selben Zeitpunkt (bzw. zum letzten Kurs
 * davor, z. B. Freitagsschluss am Wochenende). Ohne Devisenkurs bis dahin fällt der Punkt weg (null). */
export function inEur(d: Intraday | undefined, eurusd: Intraday | undefined): Intraday | undefined {
  if (!d || !eurusd || !eurusd.t.length) return undefined;
  let j = 0;
  let rate: number | null = null;
  const c = d.t.map((ts, i) => {
    while (j < eurusd.t.length && eurusd.t[j] <= ts) {
      const x = eurusd.c[j++];
      if (x !== null && x !== undefined && x > 0) rate = x;
    }
    const v = d.c[i];
    return v === null || v === undefined || rate === null ? null : v / rate;
  });
  return { ...d, c };
}
