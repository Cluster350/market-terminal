import { describe, expect, it } from "vitest";
import { resolveFn } from "./commands";
import { explain } from "./glossary";
import { chance, dayLabel, pct } from "./seasonality";

describe("Saisonalität", () => {
  it("Beschriftungen", () => {
    expect(dayLabel(1)).toBe("1. Jan");
    expect(dayLabel(60)).toBe("1. Mär");
    expect(dayLabel(365)).toBe("31. Dez");
    expect(pct(1.234)).toBe("+1,2 %");
    expect(pct(-0.0312, 3)).toBe("−0,031 %");
    expect(pct(null)).toBe("–");
    expect(chance(0.004)).toBe("< 1 %");
    expect(chance(0.43)).toBe("43 %");
  });
  it("Befehl und Glossar", () => {
    for (const w of ["SAIS", "SAISON", "SAISONALITÄT", "SEASONALITY"]) expect(resolveFn(w)).toBe("SAIS");
    expect(explain("Vergleich zum Zufall")).toContain("tausendfach");
  });
});
