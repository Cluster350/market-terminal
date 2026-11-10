import { describe, expect, it } from "vitest";
import { changedLevers, inputToLever, leverToInput, type IvLever } from "./intrinsic";

const lv = (key: string, unit: IvLever["unit"], value: number, def = value): IvLever => ({ key, label: key, value, default: def, unit, min: 0, max: 1, step: 0.01, hint: "" });

describe("DCF-Hebel", () => {
  it("rechnet Prozent und Jahre für die Eingabe um", () => {
    expect(leverToInput(lv("g", "pct", 0.10356), 0.10356)).toBe(10.36);
    expect(inputToLever(lv("g", "pct", 0), 12.5)).toBeCloseTo(0.125, 12);
    expect(leverToInput(lv("y", "year", 5), 4.6)).toBe(5);
    expect(inputToLever(lv("y", "year", 5), 6.4)).toBe(6);
    expect(leverToInput(lv("s", "x", 0.9), 0.904)).toBe(0.9);
  });
  it("schickt nur Hebel, die vom Startwert abweichen", () => {
    const defs = [lv("growth_next", "pct", 0.1, 0.1), lv("wacc", "pct", 0.09, 0.09)];
    expect(changedLevers({ growth_next: 0.1, wacc: 0.1 }, defs)).toEqual({ wacc: 0.1 });
    expect(changedLevers({ unbekannt: 1 }, defs)).toEqual({ unbekannt: 1 });
  });
});
