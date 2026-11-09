import { describe, expect, it } from "vitest";
import type { Time, UTCTimestamp } from "lightweight-charts";
import { alignRsi, csvTime, dailyBars, intradayBars, rangeStart, scanFitPoints, snapToBars } from "./GP";
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

describe("scanFitPoints (Gerade beim Fadenkreuz im Trend-Scan)", () => {
  // fünf gezeigte Tage; Trend am vierten Tag (Index 3) laufend seit 10 Balken, also vor dem Zeitraum
  const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
  const row = (i: number, other: string, fitOther: number) => ({
    time: days[i] as Time, t: 12, slope: 2, fitAt: 100, fitOther, other: { time: other as Time },
  });

  it("schneidet die Gerade am ersten gezeigten Balken ab, wenn der Trend davor beginnt (Regression: fremder Zeitpunkt auf der Achse)", () => {
    const rows = days.map((_, i) => row(i, "2026-09-29", 82));
    const pts = scanFitPoints(rows, 3);
    expect(pts.map((p) => p.time)).toEqual(["2026-10-12", "2026-10-15"]);
    expect(pts[0].value).toBeCloseTo(100 - 2 * 3); // dieselbe Gerade, nur kürzer
    expect(pts[1].value).toBe(100);
  });

  it("lässt die Gerade unverändert, wenn beide Enden im Zeitraum liegen", () => {
    const rows = days.map((_, i) => row(i, "2026-10-13", 96));
    expect(scanFitPoints(rows, 4)).toEqual([
      { time: "2026-10-13", value: 96 },
      { time: "2026-10-16", value: 100 },
    ]);
  });

  it("zeigt am ersten Balken keine Gerade, wenn sie ganz vor dem Zeitraum läge, und nichts ohne Ergebnis", () => {
    const rows = days.map((_, i) => row(i, "2026-09-29", 82));
    expect(scanFitPoints(rows, 0)).toEqual([]);
    expect(scanFitPoints([{ ...rows[0], t: null }], 0)).toEqual([]);
    expect(scanFitPoints(rows, -1)).toEqual([]);
  });

  it("Intraday: Trendbeginn im 1T-Vorlauf (Vortag) wird ebenfalls abgeschnitten", () => {
    const t0 = 1794234600; // erster Balken des Tages
    const rows = [0, 1, 2].map((k) => ({ time: (t0 + k * 300) as UTCTimestamp, t: -9, slope: -0.5, fitAt: 50, fitOther: 55, other: { time: (t0 - 86400) as UTCTimestamp } }));
    const pts = scanFitPoints(rows, 2);
    expect(pts.map((p) => p.time)).toEqual([t0, t0 + 600]);
    expect(pts[0].value).toBeCloseTo(51);
  });
});

describe("csvTime", () => {
  it("Intraday: Originalzeit in UTC statt der auf Ortszeit verschobenen Achsenzeit (Regression: Spalte „Zeit (UTC)“)", () => {
    const ts = Date.UTC(2026, 10, 9, 14, 30) / 1000;
    const local = (ts + 3600) as UTCTimestamp; // Achse in Ortszeit (Berlin, UTC+1)
    expect(csvTime(local, ts)).toBe("2026-11-09 14:30");
  });

  it("Tagesbalken: Datum wie gezeigt", () => {
    expect(csvTime("2026-11-09" as Time)).toBe("2026-11-09");
  });
});

describe("snapToBars (KGV-Band im Kurschart)", () => {
  const bars = ["2026-09-29", "2026-09-30", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-06"];

  it("legt Monatsenden am Wochenende auf den letzten Handelstag davor (Regression: Lücke und versetztes Unterfenster)", () => {
    const pts = [
      { time: "2026-08-31", value: 1 }, // vor dem ersten Balken: fällt weg
      { time: "2026-09-30", value: 2 },
      { time: "2026-10-31", value: 3 }, // Samstag
      { time: "2026-11-08", value: 4 }, // heute (Sonntag)
    ];
    const out = snapToBars(pts, bars);
    expect(out).toEqual([
      { time: "2026-09-30", value: 2 },
      { time: "2026-10-30", value: 3 },
      { time: "2026-11-06", value: 4 },
    ]);
    for (const p of out) expect(bars).toContain(p.time); // keine fremden Zeitpunkte auf der Achse
  });

  it("zwei Werte am selben Handelstag: der spätere (aktuellere) zählt", () => {
    expect(snapToBars([{ time: "2026-10-31", value: 1 }, { time: "2026-11-01", value: 2 }], bars)).toEqual([{ time: "2026-10-30", value: 2 }]);
  });

  it("ohne Balken bleibt nichts", () => {
    expect(snapToBars([{ time: "2026-10-31", value: 1 }], [])).toEqual([]);
  });
});
