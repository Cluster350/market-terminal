import { describe, expect, it } from "vitest";
import { grid, marketProfile, niceStep, pocIndex, regularOnly, splitSessions, valueArea, volumeProfile, type Candle } from "./profile";

const c = (t: number, open: number, high: number, low: number, close: number, volume: number | null = 100): Candle => ({ t, open, high, low, close, volume });

describe("Raster", () => {
  it("wählt runde Schrittweiten", () => {
    expect(niceStep(0.37)).toBe(0.5);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(0.012)).toBeCloseTo(0.02, 10);
    expect(niceStep(100)).toBe(100);
    expect(niceStep(0)).toBe(1);
  });

  it("legt Stufen auf Vielfache der Schrittweite", () => {
    const g = grid(10.03, 10.97, 0.1);
    expect(g.base).toBe(10);
    expect(g.n).toBe(10);
    expect(g.price(3)).toBe(10.3); // ohne Rundungsfehler wie 10.299999
    expect(g.index(10.3)).toBe(3);
  });
});

describe("Volumenprofil", () => {
  it("verteilt das Volumen anteilig über die Kerzenspanne", () => {
    const p = volumeProfile([c(1, 10, 12, 10, 12, 100), c(2, 11, 11, 11, 11, 50)], { step: 1 })!;
    expect(p.levels.map((l) => l.volume)).toEqual([50, 100, 0]);
    expect(p.levels[1].up).toBe(100); // gleiche Eröffnung und Schluss zählt als steigend
    expect(p.levels[1].down).toBe(0);
    expect(p.poc).toBe(11.5);
    expect([p.val, p.vah]).toEqual([10, 12]);
    expect(p.total).toBe(150);
  });

  it("ignoriert Kerzen ohne Volumen", () => {
    expect(volumeProfile([c(1, 10, 11, 9, 10, 0), c(2, 10, 11, 9, 10, null)])).toBeNull();
  });

  it("findet die Value Area mit 70 %", () => {
    expect(valueArea([5, 10, 40, 30, 10, 5], 2)).toEqual([2, 3]); // 40 + 30 = 70 %
    expect(valueArea([5, 20, 40, 15, 10, 10], 2)).toEqual([1, 3]); // erst 20 (unten), dann 15
    expect(valueArea([0, 0, 100, 0], 2)).toEqual([2, 2]);
    expect(pocIndex([1, 3, 3, 1])).toBe(1);
    expect(pocIndex([5, 1, 1, 1, 5])).toBe(0);
  });
});

describe("Sitzungen", () => {
  const T0 = Date.UTC(2026, 9, 28, 13, 30) / 1000; // 9:30 New York (Sommerzeit)
  it("teilt nach Pausen und bei Devisen nach Kalendertag", () => {
    const a = [c(T0, 1, 1, 1, 1), c(T0 + 300, 1, 1, 1, 1), c(T0 + 86400, 1, 1, 1, 1)];
    expect(splitSessions(a, false).map((s) => s.length)).toEqual([2, 1]);
    const fx = [c(Date.UTC(2026, 9, 28, 23, 55) / 1000, 1, 1, 1, 1), c(Date.UTC(2026, 9, 29, 0, 0) / 1000, 1, 1, 1, 1)];
    expect(splitSessions(fx, true)).toHaveLength(2);
    expect(splitSessions(fx, false)).toHaveLength(1);
  });

  it("filtert den Haupthandel nach Börsenzeit", () => {
    const pre = c(T0 - 90 * 60, 1, 1, 1, 1);
    const open = c(T0, 1, 1, 1, 1);
    const last = c(T0 + 385 * 60, 1, 1, 1, 1); // 15:55
    const post = c(T0 + 390 * 60, 1, 1, 1, 1); // 16:00
    expect(regularOnly([pre, open, last, post], "NWND.US")).toEqual([open, last]);
    expect(regularOnly([pre, post], "EURUSD.FOREX")).toHaveLength(2);
    expect(regularOnly([pre, open], "GSPC.INDX")).toEqual([open]);
  });
});

describe("Market Profile", () => {
  const T0 = Date.UTC(2026, 9, 28, 13, 30) / 1000;
  // Sitzung: Abschnitt A (6 × 5 min) 100–101, B 101–102, C 99–100, D 100–101
  const session = (start: number) =>
    [[100, 101], [101, 102], [99, 100], [100, 101]].flatMap(([lo, hi], k) =>
      Array.from({ length: 6 }, (_, j) => c(start + (k * 6 + j) * 300, lo + 0.2, hi, lo, hi - 0.2, 10)),
    );

  it("vergibt Buchstaben je 30 Minuten und berechnet POC, Value Area und Initial Balance", () => {
    const mp = marketProfile([...session(T0), ...session(T0 + 86400)], { ticker: "NWND.US", count: 5, step: 1 })!;
    expect(mp.sessions).toHaveLength(2);
    const s = mp.sessions[1];
    expect(s.periods).toBe(4);
    const row = (p: number) => s.letters[Math.round((p - mp.base) / mp.step)];
    expect(row(99)).toBe("C");
    expect(row(100)).toBe("ACD");
    expect(row(101)).toBe("ABD");
    expect(row(102)).toBe("B");
    expect([s.ibLow, s.ibHigh]).toEqual([100, 102]);
    expect(s.tpoCount).toBe(8);
    expect(mp.price(s.pocIndex)).toBe(100); // Gleichstand 100/101: näher an der Mitte der Spanne
    expect(s.vaHigh - s.vaLow).toBeGreaterThanOrEqual(1);
    expect([s.open, s.close]).toEqual([100.2, 100.8]);
  });

  it("nimmt nur die letzten Sitzungen", () => {
    const mp = marketProfile([...session(T0), ...session(T0 + 86400)], { ticker: "NWND.US", count: 1, step: 1 })!;
    expect(mp.sessions).toHaveLength(1);
    expect(mp.sessions[0].start).toBe(T0 + 86400);
  });
});

describe("Funktion TPO", () => {
  it("liest Intraday-Daten tolerant ein", async () => {
    const { candlesOf } = await import("../screens/tpo");
    const out = candlesOf({ ticker: "X.US", interval: "5m", t: [1, 2, 3], o: [10, null, 10], h: [11, null, 9], l: [9, null, 9.5], c: [10.5, null, 10], v: [100, null, null] });
    expect(out).toHaveLength(2); // Kerze ohne Schluss fällt weg
    expect(out[1]).toMatchObject({ high: 10, low: 9.5 }); // Hoch mindestens Eröffnung/Schluss
    expect(out[1].volume).toBeNull();
  });

  it("ordnet die Eröffnung zur Vortags-Value-Area ein", async () => {
    const { openVsValue } = await import("../screens/tpo");
    const prev = { vah: 105, val: 100 } as never;
    expect(openVsValue({ open: 106 } as never, prev)).toBe("über VA");
    expect(openVsValue({ open: 99 } as never, prev)).toBe("unter VA");
    expect(openVsValue({ open: 102 } as never, prev)).toBe("in VA");
    expect(openVsValue({ open: 102 } as never, undefined)).toBe("–");
  });

  it("kennt Befehl und Seite", async () => {
    const { resolveFn, FN } = await import("./commands");
    const { PAGES } = await import("../state/workspace");
    expect(resolveFn("MP")).toBe("TPO");
    expect(resolveFn("volumenprofil")).toBe("TPO");
    expect(FN.TPO.needsTicker).toBe(true);
    expect(PAGES.find((p) => p.id === "equity")!.pool).toContain("TPO");
  });
});

describe("Volumen je Sitzung", () => {
  it("rechnet POC und Value Area auch nach Volumen", () => {
    const T0 = Date.UTC(2026, 9, 28, 13, 30) / 1000;
    // A, C, D bei 100 (viele Buchstaben, wenig Volumen); B bei 101–102 mit hohem Volumen
    const cs = [c(T0, 100, 100.9, 100, 100.5, 10), c(T0 + 1800, 101, 102, 101, 102, 1000), c(T0 + 3600, 100, 100.6, 100, 100.2, 10), c(T0 + 5400, 100, 100.6, 100, 100.2, 10)];
    const s = marketProfile(cs, { ticker: "NWND.US", count: 1, step: 1 })!.sessions[0];
    expect(s.volPocIndex).not.toBe(s.pocIndex); // viel Volumen bei 101–102, viele Buchstaben bei 100–101
    expect(s.volVaLow).toBeLessThanOrEqual(s.volPocIndex!);
    expect(s.volVaHigh).toBeGreaterThanOrEqual(s.volPocIndex!);
  });
});
