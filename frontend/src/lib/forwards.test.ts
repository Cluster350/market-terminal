import { describe, expect, it } from "vitest";
import { hedgeImpact } from "../screens/portfolio";
import { PAGES } from "../state/workspace";
import { resolveFn } from "./commands";
import { FX_PAIRS, outrightDigits, pairLabel } from "./forwards";

describe("Terminkurse (FWD)", () => {
  it("formatiert Paare und Stellen", () => {
    expect(pairLabel("EURUSD")).toBe("EUR/USD");
    expect(outrightDigits(0.0001)).toBe(5);
    expect(outrightDigits(0.01)).toBe(3);
    expect(FX_PAIRS).toContain("USDJPY");
  });

  it("rechnet den Effekt einer Vollabsicherung auf das Depot", () => {
    const slices = [
      { key: "EUR", weight: 50 },
      { key: "USD", weight: 40 },
      { key: "CHF", weight: 10 },
    ];
    // 40 % in USD zu −1,7 % und 10 % in CHF zu +2,0 %: −0,68 + 0,2 = −0,48 % des Depots
    expect(hedgeImpact(slices, "EUR", { USD: -1.7, CHF: 2.0 })).toBeCloseTo(-0.48, 6);
    expect(hedgeImpact(slices, "EUR", { USD: null })).toBeNull();
  });

  it("ist über Befehle und die MAKRO-Seite erreichbar", () => {
    expect(resolveFn("termin")).toBe("FWD");
    expect(resolveFn("ABSICHERUNG")).toBe("FWD");
    expect(resolveFn("FRD")).toBe("FWD");
    expect(PAGES.find((p) => p.id === "macro")!.pool).toContain("FWD");
  });
});
