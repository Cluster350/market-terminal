// Intraday-Intervalle des Kurscharts (1 Min bis 1 Std) und das Zusammenfassen von Kerzen.

import type { Intraday } from "./types";

export const INTERVALS = ["1m", "5m", "15m", "1h"] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_LABEL: Record<Interval, string> = { "1m": "1 Min", "5m": "5 Min", "15m": "15 Min", "1h": "1 Std" };
export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

/** Kerzen zu einem gröberen Intervall zusammenfassen (statische Demo: aus 5-Minuten-Kerzen). */
export function aggregateIntraday(d: Intraday, interval: Interval): Intraday {
  const step = INTERVAL_SECONDS[interval];
  const out: Intraday = { ticker: d.ticker, interval, t: [], o: [], h: [], l: [], c: [], v: [] };
  d.t.forEach((ts, i) => {
    const c = d.c[i];
    if (c === null) return;
    const b = ts - (ts % step);
    const n = out.t.length - 1;
    if (n >= 0 && out.t[n] === b) {
      out.h[n] = Math.max(out.h[n] ?? c, d.h[i] ?? c);
      out.l[n] = Math.min(out.l[n] ?? c, d.l[i] ?? c);
      out.c[n] = c;
      out.v[n] = out.v[n] === null && d.v[i] === null ? null : (out.v[n] ?? 0) + (d.v[i] ?? 0);
    } else {
      out.t.push(b);
      out.o.push(d.o[i] ?? c);
      out.h.push(d.h[i] ?? c);
      out.l.push(d.l[i] ?? c);
      out.c.push(c);
      out.v.push(d.v[i]);
    }
  });
  return out;
}
