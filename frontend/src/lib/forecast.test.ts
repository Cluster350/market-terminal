import { describe, expect, it } from "vitest";
import { cleanFeatures, comparedText, digitsFor, fanData, gainText, isFeatureList, xQuery, fcTime, fmtVal, qualityLine, verdictClass, verdictLabel, type FcQuality, type ForecastResult } from "./forecast";

const quality = (over: Partial<FcQuality> = {}): FcQuality => ({
  origins: 20, pairs: 50, mae: 0.16, maeNaive: 0.24, skill: 0.33, cover50: 0.5, cover80: 0.79, rawCover80: 0.7, bandScale: 1.2,
  compared: [], modelMae1: null, consensusMae: null, consensusN: 0, ...over,
});

const result = (over: Partial<ForecastResult> = {}): ForecastResult => ({
  kind: "event", key: "US:CPI YoY", label: "CPI YoY · US", unit: "%", freq: "release",
  history: { t: ["2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"], v: [2.9, 3.0, 3.1, 3.2] },
  consensus: { t: ["2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"], v: [2.8, null, 3.0, 3.3] },
  nextConsensus: 3.3,
  forecast: { t: ["2026-11-12", "2026-12-12"], median: [3.25, 3.3], lo50: [3.15, 3.15], hi50: [3.35, 3.45], lo80: [3.0, 2.95], hi80: [3.5, 3.6] },
  engine: "chronos", engineLabel: "Chronos-2", quality: quality(), verdict: "gut", verdictText: "Im Rückblick 33 % genauer.", note: null, extra: {},
  ...over,
});

describe("Prognose: Fächerdaten", () => {
  it("hängt die Prognose an den Verlauf und lässt den Fächer am letzten Ist-Wert beginnen", () => {
    const d = fanData(result());
    expect(d.categories).toEqual(["12.07.", "12.08.", "12.09.", "12.10.", "12.11.", "12.12."]);
    expect(d.splitIndex).toBe(4);
    expect(d.hist).toEqual([2.9, 3.0, 3.1, 3.2, null, null]);
    expect(d.median).toEqual([null, null, null, 3.2, 3.25, 3.3]);
    expect(d.lo80.slice(3)).toEqual([3.2, 3.0, 2.95]);
    expect(d.band80.slice(3).map((x) => Math.round((x as number) * 100) / 100)).toEqual([0, 0.5, 0.65]);
    expect(d.band50[0]).toBeNull();
    // Konsens: frühere Schätzungen an den Ist-Terminen, danach der Konsens für den nächsten Termin
    expect(d.consensus).toEqual([2.8, null, 3.0, 3.3, 3.3, null]);
  });

  it("kürzt den Verlauf und zeigt bei langen Zeiträumen Monat und Jahr", () => {
    const t = Array.from({ length: 30 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15`);
    const r = result({ history: { t, v: t.map((_, i) => i) }, consensus: null, nextConsensus: null });
    const d = fanData(r, 12);
    expect(d.categories).toHaveLength(14);
    expect(d.consensus).toBeNull();
    expect(d.categories[0]).toMatch(/^[A-Za-zä]{3,4}\.? 25$/);
    expect(fcTime("2026", "year")).toBe("2026");
    expect(fcTime("2026-11-12", "release")).toBe("12.11.");
    expect(fcTime("2026-11-12", "month")).toMatch(/Nov\.? 26/);
  });
});

describe("Prognose: Anzeige", () => {
  it("formuliert Rückblick-Test, Vergleich und Urteil", () => {
    expect(qualityLine(quality())).toBe("Rückblick-Test an 20 früheren Zeitpunkten: Fehler 0,16 · „bleibt wie zuletzt“ 0,24 · 80-%-Band traf 79 %");
    expect(qualityLine(quality({ origins: 0, mae: null }))).toMatch(/Zu wenig/);
    const cmp = quality({ compared: [{ engine: "chronos", label: "Chronos-2", mae: 0.16, skill: 0.3 }, { engine: "simple", label: "Statistik (gedämpfter Trend)", mae: 0.17, skill: 0.25 }] });
    expect(comparedText(cmp)).toBe("Auto-Auswahl nach Rückblick-Fehler: Chronos-2 0,16 · Statistik 0,17");
    expect(comparedText(quality())).toBe("");
    expect([verdictClass("gut"), verdictClass("schwach"), verdictClass("knapp")]).toEqual(["up", "down", "flat"]);
    expect(verdictLabel("wenig")).toBe("wenig Daten");
  });

  it("wählt Nachkommastellen nach Größenordnung", () => {
    expect(digitsFor(result())).toBe(2);
    expect(digitsFor(result({ history: { t: ["a"], v: [225] } }))).toBe(1);
    expect(digitsFor(result({ history: { t: ["a"], v: [48_000] } }))).toBe(0);
    expect(fmtVal(3.256, result())).toBe("3,26 %");
    expect(fmtVal(48_000, result({ unit: "USD", history: { t: ["a"], v: [48_000] } }))).toBe("48.000");
  });
});

describe("Schwankungskegel", () => {
  it("rechnet Werktage und die Spanne nach der Wurzel-Zeit-Regel", async () => {
    const { coneLines, nextBusinessDays } = await import("./forecast");
    expect(nextBusinessDays("2026-11-06", 3)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]); // Freitag -> Mo, Di, Mi
    const c = coneLines("2026-11-06", 100, 25.2, 21);
    expect(c.up1).toHaveLength(22);
    expect(c.up1[0]).toEqual({ time: "2026-11-06", value: 100 });
    const s = 0.252 * Math.sqrt(21 / 252);
    expect(c.up1[21].value).toBeCloseTo(100 * Math.exp(s), 6);
    expect(c.lo2[21].value).toBeCloseTo(100 * Math.exp(-2 * s), 6);
    expect(c.up1[21].time).toBe("2026-12-07");
  });
});

describe("Prognose: Einflussgrößen", () => {
  it("bereinigt die Auswahl und baut die Abfrage", () => {
    expect(cleanFeatures([" WTI.COMM ", "", "WTI.COMM", 5, "m:USA:gdp_growth_annual"])).toEqual(["WTI.COMM", "m:USA:gdp_growth_annual"]);
    expect(cleanFeatures(["a", "b", "c", "d", "e", "f"])).toHaveLength(5);
    expect(cleanFeatures("kaputt")).toEqual([]);
    expect(isFeatureList(["a"])).toBe(true);
    expect(isFeatureList([1])).toBe(false);
    expect(isFeatureList(Array(6).fill("a"))).toBe(false);
    expect(xQuery([])).toBe("");
    expect(xQuery(["SPY US", "e:US:CPI & Co"])).toBe("&x=SPY%20US&x=e%3AUS%3ACPI%20%26%20Co");
  });
  it("zeigt den Nutzen mit Vorzeichen", () => {
    expect(gainText(0.124)).toBe("+12 %");
    expect(gainText(-0.05)).toBe("−5 %");
    expect(gainText(0)).toBe("±0 %");
    expect(gainText(null)).toBe("–");
  });
  it("zeichnet die Vergleichslinie ohne Einflussgrößen nur, wenn welche genutzt wurden", () => {
    const base = { t: ["2026", "2027"], median: [9, 8], lo50: [8, 7], hi50: [10, 9], lo80: [7, 6], hi80: [11, 10] };
    const fx = { features: [{ key: "k", label: "K", mae: 1, gain: 0.1 }], maeBase: 1, maeWith: 0.9, gain: 0.1, helps: true, text: "", baseline: base, baseEngineLabel: "S", points: 30, notes: [] };
    const d = fanData(result({ features: fx }));
    expect(d.baseline?.slice(-2)).toEqual([9, 8]);
    expect(d.baseline?.[d.splitIndex - 1]).toBe(d.hist[d.splitIndex - 1]); // beginnt am letzten Ist-Wert
    expect(fanData(result({ features: { ...fx, features: [] } })).baseline).toBeNull();
    expect(fanData(result()).baseline).toBeNull();
  });
});
