import { describe, expect, it } from "vitest";
import { parseSaved, toCsv } from "./screener";

describe("parseSaved (gespeicherte Screens aus localStorage)", () => {
  it("vergibt eindeutige, neue Filter-IDs (Regression: Kollision mit neuen Filtern)", () => {
    const json = JSON.stringify([
      { name: "A", sort: "pe", desc: false, filters: [{ id: 1, field: "pe", op: "lt", value: "15" }, { id: 2, field: "pe", op: "gt", value: "0" }] },
      { name: "B", sort: "market_cap", desc: true, filters: [{ id: 1, field: "div_yield", op: "gt", value: "3" }] },
    ]);
    const saved = parseSaved(json);
    const ids = saved.flatMap((s) => s.filters.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
    const again = parseSaved(json).flatMap((s) => s.filters.map((f) => f.id));
    expect(again.some((id) => ids.includes(id))).toBe(false);
    expect(saved[0]).toMatchObject({ name: "A", sort: "pe", desc: false });
    expect(saved[0].filters.map((f) => [f.field, f.op, f.value])).toEqual([["pe", "lt", "15"], ["pe", "gt", "0"]]);
  });

  it("beschädigte Inhalte stürzen nicht ab", () => {
    expect(parseSaved(null)).toEqual([]);
    expect(parseSaved("{kein json")).toEqual([]);
    expect(parseSaved('{"name":"x"}')).toEqual([]);
    expect(parseSaved("42")).toEqual([]);
    const s = parseSaved(JSON.stringify([null, { name: 1 }, { name: "ok", filters: [null, { field: 3 }, { field: "pe", op: "xx", value: 5 }] }]));
    expect(s).toHaveLength(1);
    expect(s[0].filters.map((f) => [f.field, f.op, f.value])).toEqual([["pe", "gt", "5"]]);
    expect(s[0].sort).toBe("market_cap");
    expect(s[0].desc).toBe(true);
  });
});

describe("toCsv", () => {
  it("Dezimalkomma, Semikolon und Schutz vor Formel-Injektion in Excel", () => {
    const row = {
      ticker: "X.US", name: "=HYPERLINK(\"http://x\")", exchange: "US", sector: "-Tech", industry: "@SUM", currency: "USD",
      price: 12.3456789, chg1d: -1.5, chg5d: null, marketCap: 1.5e9, marketCapLocal: 1.5e9, eps: null, pe: null, divYield: null,
      avgVol: null, perf1m: null, perf3m: null, perf12m: null, rsi14: null, vol1y: null, dist52wHigh: null,
    };
    const [head, line] = toCsv([row]).split("\n");
    expect(head.startsWith("Ticker;Name;")).toBe(true);
    const cells = line.split(";");
    expect(cells[1]).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(cells[3]).toBe("'-Tech");
    expect(cells[4]).toBe("'@SUM");
    expect(cells[6]).toBe("12,3457");
    expect(cells[7]).toBe("-1,5"); // negative Zahlen bleiben Zahlen
  });
});
