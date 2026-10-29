import { describe, expect, it } from "vitest";
import { matches, rowKey, runScreen } from "./screen";
import type { ScreenRow } from "./types";

function row(p: Partial<ScreenRow>): ScreenRow {
  return {
    ticker: "X.US", name: null, exchange: "US", sector: null, industry: null, currency: "USD", price: null,
    chg1d: null, chg5d: null, marketCap: null, eps: null, pe: null, divYield: null, avgVol: null, perf1m: null,
    perf3m: null, perf12m: null, rsi14: null, vol1y: null, dist52wHigh: null, ...p,
  };
}

const UNI: ScreenRow[] = [
  row({ ticker: "A.US", name: "Alpha Inc", sector: "Technology", marketCap: 5e11, pe: 30, chg1d: 1.5 }),
  row({ ticker: "B.US", name: "beta corp", sector: "Healthcare", marketCap: 2e10, pe: 12, chg1d: -0.5 }),
  row({ ticker: "C.XETRA", name: "Gamma AG", exchange: "XETRA", sector: "Technology", marketCap: 8e10, pe: null, chg1d: 0 }),
  row({ ticker: "D.US", name: "Delta Inc", sector: "Energy", marketCap: null, pe: 8, chg1d: 3 }),
];

describe("rowKey", () => {
  it("wandelt Backend-Felder in camelCase wie models.to_camel", () => {
    expect(rowKey("market_cap")).toBe("marketCap");
    expect(rowKey("chg_1d")).toBe("chg1d");
    expect(rowKey("perf_12m")).toBe("perf12m");
    expect(rowKey("dist_52w_high")).toBe("dist52wHigh");
    expect(rowKey("rsi14")).toBe("rsi14");
  });

  it("stürzt bei leeren Teilen nicht ab (alte gespeicherte Screens)", () => {
    expect(() => rowKey("a__b")).not.toThrow();
    expect(rowKey("a__b")).toBe("aB");
    expect(rowKey("")).toBe("");
  });
});

describe("matches (wie Terminal._match)", () => {
  it("Vergleiche, in, contains und Textgleichheit ohne Groß-/Kleinschreibung", () => {
    const a = UNI[0];
    expect(matches(a, { field: "pe", op: "gt", value: 20 })).toBe(true);
    expect(matches(a, { field: "pe", op: "lte", value: 20 })).toBe(false);
    expect(matches(a, { field: "sector", op: "in", value: ["technology", "Energy"] })).toBe(true);
    expect(matches(a, { field: "name", op: "contains", value: "ALPHA" })).toBe(true);
    expect(matches(a, { field: "sector", op: "eq", value: "TECHNOLOGY" })).toBe(true);
    expect(matches(a, { field: "sector", op: "neq", value: "Technology" })).toBe(false);
    expect(matches(a, { field: "sector", op: "gt", value: "A" })).toBe(false);
  });

  it("fehlende Werte und ungültige Zahlen passen nie", () => {
    expect(matches(UNI[2], { field: "pe", op: "lt", value: 100 })).toBe(false);
    expect(matches(UNI[0], { field: "pe", op: "gt", value: "abc" })).toBe(false);
  });
});

describe("runScreen", () => {
  it("filtert, sortiert und stellt fehlende Werte ans Ende", () => {
    const r = runScreen(UNI, [], "pe", false, 10);
    expect(r.rows.map((x) => x.ticker)).toEqual(["D.US", "B.US", "A.US", "C.XETRA"]);
    const desc = runScreen(UNI, [], "market_cap", true, 10);
    expect(desc.rows.map((x) => x.ticker)).toEqual(["A.US", "C.XETRA", "B.US", "D.US"]);
  });

  it("Textsortierung ohne Groß-/Kleinschreibung", () => {
    expect(runScreen(UNI, [], "name", false).rows.map((x) => x.ticker)).toEqual(["A.US", "B.US", "D.US", "C.XETRA"]);
  });

  it("begrenzt auf limit (1…500) und meldet truncated", () => {
    const r = runScreen(UNI, [{ field: "sector", op: "eq", value: "Technology" }], "market_cap", true, 1);
    expect(r.rows).toHaveLength(1);
    expect(r.total).toBe(2);
    expect(r.truncated).toBe(true);
    expect(runScreen(UNI, [], "market_cap", true, 0).rows).toHaveLength(1);
    expect(runScreen([], [], "market_cap", true, 50)).toMatchObject({ rows: [], total: 0, truncated: false });
  });
});
