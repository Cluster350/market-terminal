import { describe, expect, it } from "vitest";
import { TrendDotsPrimitive } from "../components/trendDots";
import { dotStyle, dotTier, RANDOM_SHARE_STRONG, randomBaseline, randomQuantile, randomRank, scanParams, STRONG_TIER, T_CAP, trendScan, tscanLevels, vsRandomText } from "./trendscan";

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

  it("Punkte fließend: grau bis zum typischen Zufall, dann kräftiger und größer; Stufen für Text und Zählung", () => {
    expect(dotTier(0.3)).toBe(0);
    expect(dotTier(0.5)).toBe(1);
    expect(dotTier(0.89)).toBe(1);
    expect(dotTier(0.9)).toBe(STRONG_TIER);
    expect(dotTier(0.995)).toBe(3);
    expect(RANDOM_SHARE_STRONG).toBeCloseTo(0.1, 12);
    // bis Rang 50 % grau und klein, Richtung egal
    expect(dotStyle(5, 0.3)).toEqual({ color: "rgb(150,150,150)", radius: 2, mix: 0 });
    expect(dotStyle(-5, 0.5).color).toBe("rgb(150,150,150)");
    // dazwischen fließend: halbe Farbe bei 70 %
    const mid = dotStyle(5, 0.7);
    expect(mid.mix).toBeCloseTo(0.5, 12);
    expect(mid.color).toBe("rgb(96,180,138)");
    expect(mid.radius).toBeCloseTo(3, 12);
    // volle Farbe ab „deutlich“, größte Punkte ab „sehr deutlich“
    expect(dotStyle(9, 0.9)).toEqual({ color: "rgb(41,209,125)", radius: 4, mix: 1 });
    expect(dotStyle(-9, 0.95).color).toBe("rgb(255,82,82)");
    expect(dotStyle(-9, 0.99).radius).toBe(6);
    expect(dotStyle(-9, 1).radius).toBe(6);
    // stetig und monoton wachsend
    let prev = 0;
    for (let r = 0; r <= 1.0001; r += 0.01) {
      const st = dotStyle(1, Math.min(1, r));
      expect(st.radius).toBeGreaterThanOrEqual(prev);
      prev = st.radius;
    }
    // ehrlicher Wortlaut statt „zu x % sicher“
    expect(vsRandomText(0.92)).toBe("so gerade wie nur 8 von 100 Zufallskursen");
    expect(vsRandomText(0.75)).toBe("so gerade wie 25 von 100 Zufallskursen");
    expect(vsRandomText(0.999)).toBe("gerader als 99 von 100 Zufallskursen");
    const lv = tscanLevels(20);
    expect(lv.map((l) => l.value)).toEqual([randomQuantile(0.9, 20), randomQuantile(0.5, 20), 0, -randomQuantile(0.5, 20), -randomQuantile(0.9, 20)]);
    expect(lv.filter((l) => l.label)).toHaveLength(2);
  });

  it("liefert Steigung und Gerade zum Einzeichnen; keine Prozent-Veränderung um null (Renditen)", () => {
    // exakte Gerade mit Steigung 0,5: Gerade trifft die Kurse an beiden Enden
    const y = Array.from({ length: 40 }, (_, i) => 10 + 0.5 * i);
    const f = trendScan(y, "forward", 20)[3];
    expect(f.slope!).toBeCloseTo(0.5, 10);
    expect(f.fitAt!).toBeCloseTo(y[3], 10);
    expect(f.fitOther!).toBeCloseTo(y[f.other!], 10);
    expect(f.diff!).toBeCloseTo(y[f.other!] - y[3], 10);
    const b = trendScan(y, "backward", 20)[30];
    expect(b.slope!).toBeCloseTo(0.5, 10);
    expect(b.fitAt!).toBeCloseTo(y[30], 10);
    expect(b.fitOther!).toBeCloseTo(y[b.other!], 10);
    expect(b.diff!).toBeCloseTo(y[30] - y[b.other!], 10);
    // verrauschte Reihe: Gerade = OLS-Anpassung, Steigung gleich der Matrix-Rechnung über das gewählte Fenster
    const p = trendScan(series, "forward", 20)[50];
    const xs = Array.from({ length: p.len! }, (_, k) => k);
    const ys = xs.map((k) => series[50 + k]);
    const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
    const my = ys.reduce((a, v) => a + v, 0) / ys.length;
    const beta = xs.reduce((a, v, k) => a + (v - mx) * (ys[k] - my), 0) / xs.reduce((a, v) => a + (v - mx) ** 2, 0);
    expect(p.slope!).toBeCloseTo(beta, 10);
    expect(p.fitAt!).toBeCloseTo(my - beta * mx, 10);
    expect(p.fitOther!).toBeCloseTo(my + beta * (p.len! - 1 - mx), 10);
    // Rendite um null: Veränderung nur als Differenz, nicht in Prozent
    const yld = Array.from({ length: 40 }, (_, i) => -0.5 + 0.05 * i + (i % 2 ? 0.01 : -0.01));
    const r = trendScan(yld, "backward", 20);
    const crossing = r.map((q, i) => ({ q, i })).filter(({ q, i }) => q.other !== null && (yld[i] <= 0 || yld[q.other] <= 0));
    expect(crossing.length).toBeGreaterThan(5);
    expect(crossing.every(({ q }) => q.ret === null && q.diff !== null)).toBe(true);
    expect(r[39].diff!).toBeGreaterThan(0);
  });

  it("Punkte: Aussehen einmal beim Setzen gerechnet, gezeichnet wie dotStyle, starke zuletzt (oben)", () => {
    const dots = [
      { time: 1 as never, price: 10, t: 4, rank: 0.95 },
      { time: 2 as never, price: 11, t: null, rank: null },
      { time: 3 as never, price: 12, t: -3, rank: 0.7 },
    ];
    const prim = new TrendDotsPrimitive();
    const fills: string[] = [];
    const ctx = { set fillStyle(v: string) { fills.push(v); }, beginPath() {}, arc() {}, fill() {} };
    const chart = { timeScale: () => ({ logicalToCoordinate: (l: number) => l * 6, timeToCoordinate: (t: number) => t * 6 }) };
    prim.attached({ chart, series: { priceToCoordinate: (p: number) => p }, requestUpdate: () => {} } as never);
    prim.setDots(dots, false);
    expect(prim.dots.map((d) => d.time)).toEqual([2, 3, 1]);
    expect(prim.dots.map((d) => d.style)).toEqual([null, dotStyle(-3, 0.7), dotStyle(4, 0.95)]);
    prim.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (f: (a: unknown) => void) => f({ context: ctx, mediaSize: { width: 100 } }) } as never);
    // noch offen: dunkler Punkt; sonst dunkler Rand (ab etwas Farbe) und Punkt in der Farbe aus dotStyle
    expect(fills).toEqual(["#4a4a4a", "#0a0a0a", dotStyle(-3, 0.7).color, "#0a0a0a", dotStyle(4, 0.95).color]);
  });
});
