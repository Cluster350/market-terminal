import { describe, expect, it } from "vitest";
import { DOT_SERIES, dotColor, dotSeriesIndex, dotTier, randomBaseline, randomQuantile, randomRank, scanParams, T_CAP, trendScan, tscanLevels } from "./trendscan";

// Prüfreihe ohne Zufall: 40-Balken-Welle + 7-Balken-Welle + leichter Anstieg
const series = Array.from({ length: 300 }, (_, i) => 100 + 10 * Math.sin((2 * Math.PI * i) / 40) + 0.02 * i + 1.5 * Math.sin((2 * Math.PI * i) / 7));

describe("Trend-Scanning (wie mlfinlab trend_scanning_labels)", () => {
  it("stimmt mit der Matrix-Rechnung nach mlfinlab überein (OLS, Fenster 5 … 19 bei 20)", () => {
    // Referenz: (XᵀX)⁻¹Xᵀy, Varianz aus den Residuen, Längen np.arange(5, 20) – wie get_betas/trend_scanning_labels
    const f = trendScan(series, "forward", 20, 5, 1);
    expect(f[50].t).toBeCloseTo(-26.574597696429787, 9);
    expect(f[50].len).toBe(19);
    expect(f[50].ret).toBeCloseTo(-0.19421566105963217, 12);
    expect(f[50].other).toBe(68); // Trendende t1 = Index + Länge − 1
    expect(f[123].t).toBeCloseTo(12.405651721049518, 9);
    expect(f[123].len).toBe(6);
    expect(f[200].t).toBeCloseTo(13.776635204920833, 9);
    expect(f[200].ret).toBeCloseTo(0.08983415052412802, 12);
    const b = trendScan(series, "backward", 20, 5, 1);
    expect(b[50].t).toBeCloseTo(23.470057649690236, 9);
    expect(b[50].len).toBe(19);
    expect(b[123].t).toBeCloseTo(15.008928749830373, 9);
    expect(b[123].len).toBe(14);
    expect(b[200].t).toBeCloseTo(10.889344485635391, 9);
    expect(b[200].other).toBe(193); // Trendbeginn = Index − Länge + 1
  });

  it("lässt die Ränder offen: vorwärts die letzten window − 1, rückwärts die ersten window − 1 Balken", () => {
    const f = trendScan(series, "forward", 20);
    expect(f.slice(-19).every((p) => p.t === null)).toBe(true);
    expect(f[300 - 20].t).not.toBeNull();
    const b = trendScan(series, "backward", 20);
    expect(b.slice(0, 19).every((p) => p.t === null)).toBe(true);
    expect(b[19].t).not.toBeNull();
    expect(trendScan([1, 2, 3], "forward", 20)).toHaveLength(3);
  });

  it("erkennt Richtung, begrenzt perfekte Geraden und kommt mit großen Kursen zurecht", () => {
    const up = Array.from({ length: 60 }, (_, i) => 160000 + 25 * i + (i % 2 ? 3 : -3));
    expect(trendScan(up, "forward", 20)[0].t!).toBeGreaterThan(2);
    expect(trendScan(up, "backward", 20)[59].t!).toBeGreaterThan(2);
    const down = up.map((v) => 400000 - v);
    expect(trendScan(down, "backward", 20)[59].t!).toBeLessThan(-2);
    const line = Array.from({ length: 30 }, (_, i) => 10 + i);
    expect(trendScan(line, "forward", 20)[0].t).toBe(T_CAP);
    expect(trendScan(line.map(() => 5), "forward", 20)[0].t).toBe(0);
  });

  it("kennt die Auswahl", () => {
    expect(scanParams("off")).toBeNull();
    expect(scanParams("back60")).toEqual({ direction: "forward", window: 60 });
    expect(scanParams("live20")).toEqual({ direction: "backward", window: 20 });
  });

  it("vergleicht mit dem Zufall: reiner Zufallskurs hat schon große t-Werte, Rang verteilt sich gleichmäßig", () => {
    // typischer |t| eines Zufallskurses (Irrfahrt) – weit über der Lehrbuchgrenze 2
    const q50w20 = randomQuantile(0.5, 20);
    const q50w60 = randomQuantile(0.5, 60);
    expect(q50w20).toBeGreaterThan(5);
    expect(q50w20).toBeLessThan(8);
    expect(q50w60).toBeGreaterThan(9);
    expect(q50w60).toBeLessThan(14);
    expect(randomQuantile(0.9, 20)).toBeGreaterThan(q50w20);
    expect(randomBaseline(20)).toBe(randomBaseline(20)); // nur einmal gerechnet
    // fester Startwert: immer dieselben Zahlen
    expect(randomQuantile(0.5, 20)).toBe(q50w20);
    // neuer, unabhängiger Zufallskurs: Ränge gleichmäßig zwischen 0 und 1 (Median ≈ 0,5, ≈ 10 % über 0,9)
    let s = 7;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const g = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const y = [100];
    for (let i = 1; i < 4000; i++) y.push(y[i - 1] + g());
    const ranks = trendScan(y, "backward", 20)
      .map((p) => randomRank(p.t, 20))
      .filter((r): r is number => r !== null)
      .sort((a, b) => a - b);
    expect(ranks[Math.floor(ranks.length / 2)]).toBeGreaterThan(0.4);
    expect(ranks[Math.floor(ranks.length / 2)]).toBeLessThan(0.6);
    const above90 = ranks.filter((r) => r >= 0.9).length / ranks.length;
    expect(above90).toBeGreaterThan(0.05);
    expect(above90).toBeLessThan(0.16);
    // echter, sauberer Trend: stärker als fast alle Zufallsfälle
    const trend = Array.from({ length: 60 }, (_, i) => 100 + 2 * i + (i % 3) - 1);
    expect(randomRank(trendScan(trend, "backward", 20)[59].t, 20)!).toBeGreaterThan(0.99);
    expect(randomRank(null, 20)).toBeNull();
  });

  it("Punkte: Größe nach Stärke, Farbe nach Richtung, grau im Zufallsbereich", () => {
    expect(dotTier(0.3)).toBe(0);
    expect(dotTier(0.5)).toBe(1);
    expect(dotTier(0.8)).toBe(2);
    expect(dotTier(0.95)).toBe(3);
    expect(dotTier(0.995)).toBe(4);
    expect(dotTier(1)).toBe(4);
    expect(dotColor(5, 0)).toMatch(/^rgba\(150,150,150/);
    expect(dotColor(-5, 0)).toMatch(/^rgba\(150,150,150/);
    expect(dotColor(9, 3)).toMatch(/^rgba\(41,209,125,0\.95\)/);
    expect(dotColor(-9, 4)).toMatch(/^rgba\(255,82,82,1\.00\)/);
    // je Stufe und Richtung eine Reihe mit fester Farbe
    expect(DOT_SERIES).toHaveLength(9);
    expect(DOT_SERIES[dotSeriesIndex(3, 0)].color).toBe(dotColor(3, 0));
    expect(DOT_SERIES[dotSeriesIndex(-3, 0)].color).toBe(dotColor(-3, 0));
    for (const tier of [1, 2, 3, 4]) {
      for (const t of [7, -7]) {
        const d = DOT_SERIES[dotSeriesIndex(t, tier)];
        expect(d.color).toBe(dotColor(t, tier));
        expect(d.tier).toBe(tier);
      }
    }
    const lv = tscanLevels(20);
    expect(lv.map((l) => l.value)).toEqual([randomQuantile(0.9, 20), randomQuantile(0.5, 20), 0, -randomQuantile(0.5, 20), -randomQuantile(0.9, 20)]);
    expect(lv.filter((l) => l.label)).toHaveLength(2);
  });
});
