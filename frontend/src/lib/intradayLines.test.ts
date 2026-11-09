import { describe, expect, it } from "vitest";
import { intradayNormalized, intradayRatio, windowStart } from "./intradayLines";
import { rotationTestText, unitLabel } from "./rotation";
import type { Intraday } from "./types";

const bars = (t: number[], c: (number | null)[]): Intraday => ({ ticker: "X", interval: "5m", t, o: c, h: c, l: c, c, v: c.map(() => null) });

describe("Intraday-Linien und Takt der Rotation", () => {
  it("normiert Intraday-Kurse und rechnet Verhältnisse zum Markt", () => {
    const a = bars([100, 400, 700, 1000], [50, 55, null, 60]);
    expect(intradayNormalized(a, 300)).toEqual([[400_000, 100], [1_000_000, (60 / 55) * 100]]);
    const m = bars([400, 700, 1000], [10, 10, 12]);
    // 55/10 -> 60/12: der Faktor läuft schlechter als der Markt
    expect(intradayRatio(a, m, 0)).toEqual([[400_000, 100], [1_000_000, (5 / 5.5) * 100]]);
    expect(intradayRatio(undefined, m, 0)).toEqual([]);
    expect(windowStart([a, m, undefined], 24)).toBe(1000 - 24 * 3600);
  });

  it("beschriftet Wochen und Tage", () => {
    expect(unitLabel("w", 13)).toBe("13 Wochen");
    expect(unitLabel("d", 20)).toBe("20 Handelstage");
    expect(unitLabel("d", 5, true)).toBe("5 T");
    const test = { quadrants: { fuehrend: { h20: { n: 3, avg: 0.01, up: 0.6 } } } } as never;
    expect(rotationTestText(test, "d", 20)).toContain("20 Handelstage nach einem Stand im Feld: führend +1,0 %");
  });
});
