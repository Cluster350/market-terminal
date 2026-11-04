import { describe, expect, it } from "vitest";
import { aggregateIntraday } from "./intervals";
import { mergeTick } from "./realtime";
import type { Intraday, Quote } from "./types";

const quote: Quote = {
  ticker: "NWND.US", name: null, last: 100, change: 1, changePct: 1, open: 99, high: 101, low: 98, prevClose: 99, volume: 1000,
  timestamp: "2026-11-04T15:00:00Z", delayed: true, currency: "USD",
};

describe("Echtzeit-Ticks", () => {
  it("setzen jüngere Kurse ein und rechnen die Veränderung neu", () => {
    const m = mergeTick(quote, { t: "NWND.US", p: 102, ts: Date.parse("2026-11-04T15:00:05Z") });
    expect(m.last).toBe(102);
    expect(m.high).toBe(102);
    expect(m.changePct).toBeCloseTo((102 / 99 - 1) * 100, 6);
    expect(m.delayed).toBe(false);
  });
  it("ignorieren ältere und verzögerte Ticks", () => {
    expect(mergeTick(quote, { t: "NWND.US", p: 50, ts: Date.parse("2026-11-04T14:59:00Z") })).toBe(quote);
    expect(mergeTick(quote, { t: "NWND.US", p: 50, ts: Date.parse("2026-11-04T15:10:00Z"), d: 1 })).toBe(quote);
  });
});

describe("Intervalle", () => {
  it("fassen 5-Minuten-Kerzen zu 15 Minuten zusammen", () => {
    const t0 = 1_762_268_400;
    const d: Intraday = { ticker: "X", interval: "5m", t: [t0, t0 + 300, t0 + 600, t0 + 900], o: [1, 2, 3, 4], h: [2, 5, 4, 6], l: [0.5, 1, 2, 3], c: [2, 3, 4, 5], v: [10, 20, null, 5] };
    const a = aggregateIntraday(d, "15m");
    expect(a.t).toEqual([t0, t0 + 900]);
    expect([a.o[0], a.h[0], a.l[0], a.c[0], a.v[0]]).toEqual([1, 5, 0.5, 4, 30]);
  });
});
