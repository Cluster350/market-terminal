import { describe, expect, it } from "vitest";
import { resolveFn } from "./commands";
import { axisSpan, clockwiseText, headingArrow, headingOf, quadrantOf, rotationTestText, tail, type RotMember } from "./rotation";

const member = (trend: (number | null)[], mom: (number | null)[]): RotMember => ({
  key: "X", label: "X", ticker: null, trend, momentum: mom, quadrant: null, heading: null, speed: null, rel4: null, rel13: null, fairGap: null, detail: null,
});

describe("Relative Rotation", () => {
  it("ordnet Felder, Schweif und Richtung zu", () => {
    expect([quadrantOf(101, 101), quadrantOf(101, 99), quadrantOf(99, 99), quadrantOf(99, 101), quadrantOf(null, 100)]).toEqual([
      "fuehrend", "schwaecher", "nachzuegler", "erholend", null,
    ]);
    const m = member([98, 99, null, 100, 101], [100, 100.5, 101, 101, 100.5]);
    expect(tail(m, 4, 3).map((p) => p.i)).toEqual([3, 4]); // Woche 2 ohne Trend fällt weg
    expect(tail(m, 1, 8).map((p) => p.i)).toEqual([0, 1]);
    const pts = [{ trend: 100, mom: 100 }, { trend: 101, mom: 101 }];
    expect(headingOf(pts)).toBeCloseTo(45);
    expect(headingArrow(45)).toBe("↗");
    expect(headingArrow(270)).toBe("↓");
    expect(headingArrow(null)).toBe("·");
    expect(axisSpan([100.2, 99.5])).toBe(2);
    expect(axisSpan([103.1, 98])).toBe(3.5);
  });

  it("beschreibt Rückblick und Uhrzeigersinn ehrlich", () => {
    const s = (avg: number) => ({ h4: { n: 10, avg, up: 0.5 }, h13: { n: 10, avg, up: 0.5 } });
    const test = { quadrants: { fuehrend: s(0.012), schwaecher: s(-0.004), nachzuegler: s(-0.01), erholend: s(0.02) }, clockwise: 70, counter: 30, clockwiseShare: 0.7 };
    expect(rotationTestText(test)).toBe("Rückblick, relative Entwicklung 13 Wochen nach einem Stand im Feld: führend +1,2 % · schwächer werdend −0,4 % · Nachzügler −1,0 % · erholend +2,0 %");
    expect(clockwiseText(test)).toMatch(/^Wechsel im Uhrzeigersinn: 70 % \(70 von 100\)\. Auch Zufallskurse/);
    expect(resolveFn("RRG")).toBe("RRG");
    expect(resolveFn("rotation")).toBe("RRG");
  });
});
