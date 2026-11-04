import { describe, expect, it } from "vitest";
import { PAGES } from "../state/workspace";
import { FN, resolveFn } from "./commands";
import { contractLabel, sameTicker, strikeWindow, type ChainRow } from "./options";

const row = (strike: number): ChainRow => ({ strike, call: null, put: null });

describe("Optionen (OMON)", () => {
  it("zeigt Kontrakte lesbar", () => {
    expect(contractLabel({ contract: "NWND261120C00145000", type: "call", exp: "2026-11-20", strike: 145 })).toBe("NWND 20.11.26 C 145");
    expect(contractLabel({ contract: "BRK.B270115P00412500", type: "put", exp: "2027-01-15", strike: 412.5 })).toBe("BRK.B 15.01.27 P 412,5");
  });

  it("filtert Strikes um den Kurs", () => {
    const rows = [80, 90, 95, 100, 105, 110, 125].map(row);
    expect(strikeWindow(rows, 100, 10).map((r) => r.strike)).toEqual([90, 95, 100, 105, 110]);
    expect(strikeWindow(rows, 100, null)).toHaveLength(7);
    expect(strikeWindow(rows, null, 10)).toHaveLength(7);
  });

  it("ist als Aktienfunktion erreichbar", () => {
    expect(resolveFn("optionen")).toBe("OMON");
    expect(resolveFn("OVDV")).toBe("OMON");
    expect(FN.OMON.needsTicker).toBe(true);
    expect(PAGES.find((p) => p.id === "equity")!.pool).toContain("OMON");
  });
});

describe("Platzhalter beim Tickerwechsel", () => {
  it("zeigt vorige Daten nur für denselben Wert", () => {
    const prev = { ticker: "NWND.US" };
    expect(sameTicker(prev, { queryKey: ["options-overview", "NWND.US", null] }, "NWND.US")).toBe(prev);
    expect(sameTicker(prev, { queryKey: ["options-overview", "NWND.US", null] }, "QBIT.US")).toBeUndefined();
    expect(sameTicker(prev, undefined, "QBIT.US")).toBeUndefined();
  });
});
