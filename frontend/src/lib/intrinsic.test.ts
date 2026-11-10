import { describe, expect, it } from "vitest";
import { changedLevers, distAxisBounds, inputToLever, leverToInput, parseLeverInput, type IvLever } from "./intrinsic";

const lv = (key: string, unit: IvLever["unit"], value: number, def = value): IvLever => ({ key, label: key, value, default: def, unit, min: 0, max: 1, step: 0.01, hint: "" });

describe("DCF-Hebel", () => {
  it("rechnet Prozent und Jahre für die Eingabe um", () => {
    expect(leverToInput(lv("g", "pct", 0.10356), 0.10356)).toBe(10.36);
    expect(inputToLever(lv("g", "pct", 0), 12.5)).toBeCloseTo(0.125, 12);
    expect(leverToInput(lv("y", "year", 5), 4.6)).toBe(5);
    expect(inputToLever(lv("y", "year", 5), 6.4)).toBe(6);
    expect(leverToInput(lv("s", "x", 0.9), 0.904)).toBe(0.9);
  });
  it("liest Eingaben mit Dezimalkomma; leeres Feld ist keine 0", () => {
    expect(parseLeverInput("12,5")).toBe(12.5);
    expect(parseLeverInput(" -3 ")).toBe(-3);
    expect(parseLeverInput("0")).toBe(0);
    expect(parseLeverInput("")).toBeNull();
    expect(parseLeverInput("   ")).toBeNull();
    expect(parseLeverInput("abc")).toBeNull();
  });
  it("schickt nur Hebel, die vom Startwert abweichen", () => {
    const defs = [lv("growth_next", "pct", 0.1, 0.1), lv("wacc", "pct", 0.09, 0.09)];
    expect(changedLevers({ growth_next: 0.1, wacc: 0.1 }, defs)).toEqual({ wacc: 0.1 });
    expect(changedLevers({ unbekannt: 1 }, defs)).toEqual({ unbekannt: 1 });
  });
});

describe("DCF-Histogramm", () => {
  const bins = [{ lo: 10, hi: 15 }, { lo: 15, hi: 20 }, { lo: 20, hi: 25 }];
  it("nimmt einen Kurs weit über der Bandbreite in die Achse (sonst fehlte die Kurs-Linie)", () => {
    const b = distAxisBounds(bins, [61, 20]);
    expect(b.max({ max: 22.5 })).toBeCloseTo(61 + (61 - 10) * 0.04, 9);
    expect(b.min({ min: 12.5 })).toBeUndefined();
    const low = distAxisBounds(bins, [4, null]);
    expect(low.min({ min: 12.5 })).toBeCloseTo(4 - (25 - 4) * 0.04, 9);
  });
  it("lässt die Achse automatisch, wenn Kurs und Wert im Bereich liegen", () => {
    const b = distAxisBounds(bins, [18, 21]);
    expect(b.min({ min: 12.5 })).toBeUndefined();
    expect(b.max({ max: 22.5 })).toBeUndefined();
    const none = distAxisBounds(bins, [null, undefined]);
    expect(none.min({ min: 12.5 })).toBeUndefined();
    expect(none.max({ max: 22.5 })).toBeUndefined();
  });
});
