import { describe, expect, it } from "vitest";
import { FN, resolveFn } from "./commands";
import { explain } from "./glossary";
import { bandLabel, compChange, compValue, divergences, isExtreme, rankColor, sliceFrom } from "./sentiment";

describe("Stimmungsterminal", () => {
  it("färbt Ränge: blau – grau – magenta, grau zwischen 30 und 70", () => {
    expect(rankColor(0)).toBe("#5b8cff");
    expect(rankColor(10)).toBe("#5b8cff");
    expect(rankColor(30)).toBe("#8f8f8f");
    expect(rankColor(50)).toBe("#8f8f8f");
    expect(rankColor(70)).toBe("#8f8f8f");
    expect(rankColor(95)).toBe("#ff5fa2");
    expect(rankColor(20)).not.toBe(rankColor(10));
    expect(rankColor(null)).toBe("#5c5c5c");
    expect(isExtreme(4)).toBe(true);
    expect(isExtreme(50)).toBe(false);
    expect(isExtreme(96)).toBe(true);
  });

  it("formatiert Werte und Wochenveränderungen je Baustein", () => {
    expect(compValue({ key: "breite", unit: "pct" }, 47.2)).toBe("47 %");
    expect(compValue({ key: "vola", unit: "pct" }, 1.94)).toBe("1,9 %");
    expect(compValue({ key: "haefen", unit: "pp" }, -1.8)).toBe("−1,8 Pp");
    expect(compValue({ key: "hochtief", unit: "pp" }, 0.8)).toBe("+0,8 %");
    expect(compValue({ key: "putcall", unit: "ratio" }, 0.937)).toBe("0,94");
    expect(compValue({ key: "news", unit: "tone" }, 0.04)).toBe("+0,04");
    expect(compValue({ key: "vix", unit: "num" }, null)).toBe("–");
    expect(compChange({ key: "breite", unit: "pct" }, 47, 51)).toBe("↓ 4 Pp");
    expect(compChange({ key: "vix", unit: "num" }, 18.7, 17.3)).toBe("↑ 1,4");
    expect(compChange({ key: "vix", unit: "num" }, 18.7, 18.7)).toBe("→ 0");
  });

  it("findet Strecken, in denen der Index steigt, die Breite aber nicht", () => {
    const idx = Array.from({ length: 60 }, (_, i) => 100 + i);
    const adl = Array.from({ length: 60 }, (_, i) => (i < 30 ? i : 60 - i));
    const d = divergences(idx, adl, 10);
    expect(d.length).toBe(1);
    expect(d[0][0]).toBeGreaterThan(30);
    expect(d[0][1]).toBe(59);
    expect(divergences(idx, idx, 10)).toEqual([]);
  });

  it("Zeitraum und Rückblick-Beschriftung", () => {
    const dates = ["2020-01-01", "2024-06-01", "2025-01-02", "2025-06-01"];
    expect(sliceFrom(dates, 12)).toBe(1);
    expect(sliceFrom(dates, 0)).toBe(0);
    expect(bandLabel([20, 40])).toBe("Ähnlich vorsichtig (2. Fünftel) wie heute");
  });

  it("Befehl STIM mit deutschen und englischen Wörtern, Glossar", () => {
    expect(FN.STIM.group).toBe("Makro");
    for (const w of ["STIM", "STIMMUNG", "ANGST", "GIER", "MOOD", "SENT"]) expect(resolveFn(w)).toBe("STIM");
    expect(explain("Put/Call")).toContain("Näherung");
    expect(explain("Angst & Gier")).toContain("keine Empfehlung");
    expect(explain("ø Volatilität")).toContain("kein Ersatz für den VIX");
  });
});
