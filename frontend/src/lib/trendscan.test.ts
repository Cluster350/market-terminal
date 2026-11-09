import { describe, expect, it } from "vitest";
import { scanColor, scanParams, T_CAP, trendScan } from "./trendscan";

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

  it("färbt nur deutliche Trends und kennt die Auswahl", () => {
    expect(scanColor(null)).toBeNull();
    expect(scanColor(1.5)).toBeNull();
    expect(scanColor(3)).toMatch(/^rgba\(41,209,125/);
    expect(scanColor(-30)).toMatch(/^rgba\(255,82,82,0\.300\)/);
    expect(scanParams("off")).toBeNull();
    expect(scanParams("back60")).toEqual({ direction: "forward", window: 60 });
    expect(scanParams("live20")).toEqual({ direction: "backward", window: 20 });
  });
});
