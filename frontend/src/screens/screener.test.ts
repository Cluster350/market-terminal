import { describe, expect, it } from "vitest";
import { parseSaved } from "./screener";

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
