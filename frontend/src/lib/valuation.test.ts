import { describe, expect, it } from "vitest";
import { resolveFn } from "./commands";
import { PAGES } from "../state/workspace";
import { decompositionText, fmtPe, groupRows, peTone, positionBlocks, quadrant, type ValRow } from "./valuation";

const row = (over: Partial<ValRow> = {}): ValRow => ({
  key: "Technology", label: "Technologie", kind: "sector", region: "us", n: 25, peYears: {}, negativeYears: [], peTtm: 30, avg: 25,
  low: 15, high: 40, position: 0.7, chg12m: 2, growthNext: 0.12, rev30: -0.01, rev90: -0.03, up30: 5, down30: 12, dist52: -0.25, state: "baer",
  ...over,
});

describe("Bewertungstrend: Anzeige", () => {
  it("formatiert KGVs, Verluste und die Lage", () => {
    expect(fmtPe(24.06)).toBe("24,1");
    expect(fmtPe(null)).toBe("–");
    expect(fmtPe(-3)).toBe("neg.");
    expect(fmtPe(20, true)).toBe("neg.");
    expect(fmtPe(1500)).toBe(">999");
    expect(positionBlocks(0)).toBe("▮▯▯▯▯");
    expect(positionBlocks(0.55)).toBe("▮▮▮▯▯");
    expect(positionBlocks(1)).toBe("▮▮▮▮▮");
    expect(positionBlocks(null)).toBe("");
    expect([peTone(30, 25), peTone(20, 25), peTone(25, 25), peTone(null, 25)]).toEqual(["pe-hi", "pe-lo", "", ""]);
  });

  it("gliedert nach Zustand und Region", () => {
    const rows = [row({ key: "a", state: "nahe", region: "Europa" }), row({ key: "b", state: "baer", region: "Nordamerika" }), row({ key: "c", state: "nahe", region: "Europa" })];
    const byState = groupRows(rows, "state");
    expect(byState.map((g) => g.rows.map((r) => r.key))).toEqual([["b"], ["a", "c"]]);
    expect(byState[0].title).toMatch(/Bärenmarkt/);
    expect(groupRows(rows, "region").map((g) => g.title)).toEqual(["Europa", "Nordamerika"]);
    expect(groupRows(rows, "none")).toEqual([{ title: null, rows }]);
  });

  it("erklärt Zerlegung und Quadranten in Worten", () => {
    expect(decompositionText("1 Jahr", { price: 0.25, earnings: 0.05, pe: 0.19 })).toBe("1 Jahr: Kurse +25 %, Gewinne +5 % → KGV +19 % (teurer geworden)");
    expect(decompositionText("5 Jahre", { price: null, earnings: 0.1, pe: null })).toMatch(/zu wenig Daten/);
    expect(quadrant(0.8, -0.02)).toMatch(/Vorsicht/);
    expect(quadrant(0.2, 0.02)).toMatch(/Erholungskandidat/);
    expect(quadrant(null, 0.02)).toBe("");
  });

  it("ist als Funktion BWT erreichbar", () => {
    expect(resolveFn("BWT")).toBe("BWT");
    expect(resolveFn("kgv")).toBe("BWT");
    expect(resolveFn("Sektoren")).toBe("BWT");
    expect(PAGES.find((p) => p.id === "macro")!.pool).toContain("BWT");
  });
});
