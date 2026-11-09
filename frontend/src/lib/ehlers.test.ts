import { describe, expect, it } from "vitest";
import {
  correlationTrend,
  decycler,
  evenBetterSinewave,
  fisherTransform,
  frama,
  highPass2,
  instantaneousTrend,
  laguerreRsi,
  mesa,
  oscillatorLines,
  overlayLines,
  reflexTrendflex,
  roofingFilter,
  superSmoother,
  ultimateSmoother,
  type Num,
} from "./ehlers";

const N = 400;
// Prüfreihe: 20-Balken-Zyklus + 7-Balken-Zyklus + leichter Anstieg (ohne Zufall, damit Referenzwerte stabil sind)
const series = Array.from({ length: N }, (_, i) => 100 + 10 * Math.sin((2 * Math.PI * i) / 20) + 0.05 * i + 3 * Math.sin((2 * Math.PI * i) / 7));
const constant = Array.from({ length: 300 }, () => 50);
const ramp = Array.from({ length: 300 }, (_, i) => 10 + 0.5 * i);
const last = (xs: Num[]) => xs[xs.length - 1] as number;
const defined = (xs: Num[]) => xs.filter((v): v is number => v !== null);

describe("Ehlers-Indikatoren", () => {
  it("stimmen mit den Referenzbibliotheken überein (TA-Lib MAMA/FAMA/HT_DCPERIOD, pandas-ta SSF/Fisher/CTI)", () => {
    // Werte aus TA-Lib 0.8.3 bzw. pandas-ta 0.4.71 (SSF in der bogenmaß-korrekten Variante) für dieselbe Reihe
    const m = mesa(series);
    expect(m.mama[250]).toBeCloseTo(112.3241764699, 4);
    expect(m.fama[250]).toBeCloseTo(112.591274673, 3);
    expect(m.period[250]).toBeCloseTo(20.1188868847, 2);
    expect(m.mama[399]).toBeCloseTo(115.9644090496, 4);
    expect(m.fama[399]).toBeCloseTo(117.7761765279, 3);
    expect(m.period[399]).toBeCloseTo(20.7136640306, 2);
    expect(superSmoother(series, 20)[250]).toBeCloseTo(119.5325372211, 8);
    expect(superSmoother(series, 20)[399]).toBeCloseTo(112.5261312293, 8);
    expect(fisherTransform(series, 10).fish[250]).toBeCloseTo(0.4631946361, 8);
    expect(fisherTransform(series, 10).fish[399]).toBeCloseTo(-1.6127309999, 8);
    expect(correlationTrend(series, 20)[250]).toBeCloseTo(0.7118524348, 8);
    expect(correlationTrend(series, 20)[399]).toBeCloseTo(-0.7766339543, 8);
  });

  it("Glättungen lassen einen gleichbleibenden Kurs unverändert (Verstärkung 1)", () => {
    for (const xs of [superSmoother(constant), ultimateSmoother(constant), instantaneousTrend(constant).it, mesa(constant).mama, mesa(constant).fama, decycler(constant)]) {
      expect(last(xs)).toBeCloseTo(50, 8);
    }
    expect(last(frama(constant.map((v) => v + 1), constant.map((v) => v - 1), constant))).toBeCloseTo(50, 8);
  });

  it("UltimateSmoother folgt einem Trend ohne Verzögerung und ist Kurs minus Hochpass", () => {
    expect(last(ultimateSmoother(ramp))).toBeCloseTo(last(ramp), 6);
    // zum Vergleich: der SuperSmoother hinkt dem Anstieg hinterher
    expect(last(ramp) - last(superSmoother(ramp))).toBeGreaterThan(1);
    const hp = highPass2(series, 20);
    const us = ultimateSmoother(series, 20);
    for (const i of [100, 250, 399]) expect((us[i] as number) + hp[i]).toBeCloseTo(series[i], 8);
  });

  it("Instantaneous Trendline und FRAMA folgen einer Geraden", () => {
    const it2 = instantaneousTrend(ramp);
    expect(Math.abs(last(it2.it) - last(ramp))).toBeLessThan(0.5);
    // auf einer Geraden ist die fraktale Dimension 1: FRAMA = Kurs
    expect(last(frama(ramp.map((v) => v + 0.1), ramp.map((v) => v - 0.1), ramp))).toBeCloseTo(last(ramp), 1);
  });

  it("Roofing-Filter entfernt Trend und langsame Wellen, behält den mittleren Zyklus", () => {
    expect(Math.abs(last(roofingFilter(constant)))).toBeLessThan(1e-9);
    expect(Math.abs(last(roofingFilter(ramp)))).toBeLessThan(1e-6);
    const amp = (period: number) => {
      const x = Array.from({ length: 600 }, (_, i) => Math.sin((2 * Math.PI * i) / period));
      return Math.max(...defined(roofingFilter(x)).slice(-200).map(Math.abs));
    };
    expect(amp(20)).toBeGreaterThan(0.6); // Zyklus im Durchlassbereich
    expect(amp(200)).toBeLessThan(0.15); // langsame Welle (Trend) gedämpft
    expect(amp(3)).toBeLessThan(0.2); // Rauschen gedämpft
  });

  it("Oszillatoren bleiben in ihrem Wertebereich und zeigen die Richtung", () => {
    const ebsw = defined(evenBetterSinewave(series));
    expect(Math.max(...ebsw)).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.min(...ebsw)).toBeGreaterThanOrEqual(-1 - 1e-9);
    expect(Math.max(...ebsw)).toBeGreaterThan(0.9); // reiner Zyklus erreicht fast +1 und −1
    const lr = defined(laguerreRsi(series));
    expect(Math.min(...lr)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lr)).toBeLessThanOrEqual(1);
    expect(last(laguerreRsi(ramp))).toBeCloseTo(1, 6);
    expect(last(laguerreRsi(ramp.map((v) => -v)))).toBeCloseTo(0, 6);
    expect(last(correlationTrend(ramp))).toBeCloseTo(1, 8);
    expect(last(correlationTrend(ramp.map((v) => -v)))).toBeCloseTo(-1, 8);
    const rt = reflexTrendflex(ramp);
    expect(last(rt.trendflex)).toBeGreaterThan(0.5); // Trend erkannt
    expect(Math.abs(last(rt.reflex))).toBeLessThan(1e-6); // auf einer Geraden kein Zyklus
    const fish = defined(fisherTransform(series).fish);
    expect(Math.max(...fish.map(Math.abs))).toBeLessThan(4);
  });

  it("misst die Zykluslänge eines reinen Zyklus", () => {
    const x = Array.from({ length: 500 }, (_, i) => 100 + 5 * Math.sin((2 * Math.PI * i) / 25));
    expect(last(mesa(x).period)).toBeGreaterThan(22);
    expect(last(mesa(x).period)).toBeLessThan(28);
  });

  it("liefert Linien in Länge der Kursreihe, mit Anlaufphase und für kurze Reihen", () => {
    const bars = series.map((c) => ({ high: c + 0.5, low: c - 0.5, close: c }));
    for (const k of ["ssf", "ultimate", "itrend", "mama", "frama", "decycler"] as const) {
      const lines = overlayLines(k, bars);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l.values).toHaveLength(N);
        expect(l.values[0]).toBeNull();
        expect(l.values[N - 1]).not.toBeNull();
      }
    }
    expect(overlayLines("off", bars)).toEqual([]);
    for (const k of ["fisher", "lrsi", "roof", "ebsw", "reflex", "cti", "cycle"] as const) {
      const r = oscillatorLines(k, bars);
      for (const l of r.lines) {
        expect(l.values).toHaveLength(N);
        expect(Number.isFinite(l.values[N - 1] as number)).toBe(true);
      }
      // kurze Reihe (z. B. 1T-Chart am Morgen): kein Absturz, nur Anlaufphase
      const short = oscillatorLines(k, bars.slice(0, 5));
      for (const l of short.lines) expect(l.values).toHaveLength(5);
    }
    expect(overlayLines("mama", [])).toEqual([]);
  });
});
