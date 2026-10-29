import { describe, expect, it } from "vitest";
import type { Time, UTCTimestamp } from "lightweight-charts";
import { alignRsi, dailyBars, intradayBars, rangeStart } from "./GP";
import type { History, Intraday } from "../lib/types";

// Ortszeit wie in Europe/Berlin: bis 25.10.2026 01:00 UTC UTC+2, danach UTC+1
const SWITCH = Date.UTC(2026, 9, 25, 1, 0) / 1000;
const berlin = (ts: number) => (ts + (ts < SWITCH ? 7200 : 3600)) as UTCTimestamp;

function intraday(ts: number[]): Intraday {
  const n = ts.map((_, i) => 100 + i);
  return { ticker: "BTC-USD.CC", interval: "5m", t: ts, o: n, h: n, l: n, c: n, v: n };
}

describe("intradayBars", () => {
  it("bleibt bei der Zeitumstellung streng aufsteigend (Regression: ungeordnete Daten)", () => {
    const ts: number[] = [];
    for (let t = SWITCH - 3600; t < SWITCH + 7200; t += 300) ts.push(t);
    const bars = intradayBars(intraday(ts), berlin);
    const times = bars.map((b) => b.time as number);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(bars.length).toBeLessThan(ts.length); // wiederholte Ortsstunde übersprungen
    expect(bars[bars.length - 1].ts).toBe(ts[ts.length - 1]); // Originalzeit bleibt erhalten
  });

  it("überspringt Balken mit fehlenden Werten", () => {
    const d = intraday([1000, 1300, 1600]);
    d.c[1] = null;
    expect(intradayBars(d, (t) => t as UTCTimestamp).map((b) => b.ts)).toEqual([1000, 1600]);
  });
});

describe("dailyBars", () => {
  it("überspringt doppelte Tage und korrigiert Hoch/Tief um Eröffnung und Schluss", () => {
    const h: History = {
      ticker: "X.US", currency: "USD",
      t: ["2026-10-26", "2026-10-27", "2026-10-27", "2026-10-28"],
      o: [10, null, 11, 12], h: [9, 12, 12, 13], l: [9, 10, 10, 11], c: [10, 11, 11.5, null], v: [1, 2, 3, 4],
    };
    const bars = dailyBars(h);
    expect(bars.map((b) => b.time)).toEqual(["2026-10-26", "2026-10-27"]);
    expect(bars[0]).toMatchObject({ open: 10, high: 10, low: 9, close: 10 });
    expect(bars[1]).toMatchObject({ open: 11, close: 11 }); // fehlende Eröffnung = Schluss
  });
});

describe("rangeStart / YTD am Jahreswechsel", () => {
  it("YTD-Stichtag ist der 31.12. des Vorjahres, damit ein Balken vom 1. Januar dazugehört", () => {
    expect(rangeStart("YTD", "2027-01-01")).toBe("2026-12-31");
    // Krypto handelt am 1.1.: der erste Balken nach dem Stichtag muss gefunden werden
    const h: History = {
      ticker: "BTC-USD.CC", currency: "USD", t: ["2026-12-30", "2026-12-31", "2027-01-01"],
      o: [1, 2, 3], h: [1, 2, 3], l: [1, 2, 3], c: [1, 2, 3], v: [null, null, null],
    };
    const all = dailyBars(h);
    const first = all.findIndex((b) => (b.time as string) > rangeStart("YTD", "2027-01-01"));
    expect(first).toBe(2);
    expect(rangeStart("1M", "2026-03-31")).toBe("2026-02-28");
  });
});

describe("alignRsi", () => {
  it("füllt Handelstage der Vergleichswerte mit Leerpunkten auf (gleiche logische Achse)", () => {
    const rsi = [{ time: "2026-11-25" as Time, value: 55 }, { time: "2026-11-27" as Time, value: 60 }];
    // DAX handelt an Thanksgiving (26.11.), die US-Aktie nicht
    const lines = [{ data: [{ time: "2026-11-25" as Time }, { time: "2026-11-26" as Time }, { time: "2026-11-27" as Time }] }];
    expect(alignRsi(rsi, lines)).toEqual([{ time: "2026-11-25", value: 55 }, { time: "2026-11-26" }, { time: "2026-11-27", value: 60 }]);
    expect(alignRsi(rsi, [{ data: rsi }])).toBe(rsi); // nichts zu ergänzen
  });
});
