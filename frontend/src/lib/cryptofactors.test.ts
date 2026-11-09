import { describe, expect, it } from "vitest";
import { monthsBack, normalized } from "./crypto";
import { loadingText, relativeLine, strength } from "./factors";
import { resolveFn } from "./commands";
import { fmtPrice } from "./format";

describe("Krypto und Faktoren", () => {
  it("normiert Linien ab dem Stichtag auf 100", () => {
    const line = { t: ["2026-01-01", "2026-02-01", "2026-03-01"], v: [50, 100, 150] };
    expect(normalized(line, "2026-01-15")).toEqual([["2026-02-01", 100], ["2026-03-01", 150]]);
    expect(normalized({ t: ["a", "b"], v: [null, 0] }, "")).toEqual([]);
    expect(monthsBack("2026-11-06", 12)).toBe("2025-11-06");
    expect(monthsBack("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBack("2026-01-15", 120)).toBe("2016-01-15");
  });

  it("bewertet Faktorlasten nach dem t-Wert", () => {
    expect(strength(2.5)).toBe("deutlich");
    expect(strength(-1.2)).toBe("schwach");
    expect(strength(0.4)).toBe("kaum");
    expect(strength(null)).toBe("–");
    expect(loadingText({ key: "momentum", label: "Momentum", ticker: "MTUM.US", beta: 0.32, t: 2.4 })).toBe("Momentum: +0,32 → eher die Gewinner der letzten Monate, deutlich");
    expect(loadingText({ key: "size", label: "Kleine Firmen", ticker: "IWM.US", beta: -0.2, t: -1.5 })).toBe("Kleine Firmen: −0,20 → eher große Firmen, schwach");
    expect(loadingText({ key: "size", label: "Kleine Firmen", ticker: "IWM.US", beta: 0.05, t: 0.2 })).toContain("keine erkennbare");
    expect(relativeLine(["a", "b"], [10, null], [5, 5])).toEqual({ t: ["a", "b"], v: [2, null] });
  });

  it("kennt die neuen Befehle und zeigt Kleinstkurse lesbar", () => {
    expect(resolveFn("CRYP")).toBe("CRYP");
    expect(resolveFn("krypto")).toBe("CRYP");
    expect(resolveFn("bitcoin")).toBe("CRYP");
    expect(resolveFn("FCTR")).toBe("FCTR");
    expect(resolveFn("faktoren")).toBe("FCTR");
    expect(fmtPrice(0.0000213)).toBe("0,00002130");
    expect(fmtPrice(0.42)).toBe("0,4200");
    expect(fmtPrice(64000.5)).toBe("64.000,50");
  });
});
