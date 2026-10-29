import { describe, expect, it } from "vitest";
import { FN, FUNCTIONS, normalizeTicker, parseCommand, resolveFn } from "./commands";

describe("normalizeTicker (wie services/tickers.py)", () => {
  it.each([
    ["aapl", "AAPL.US"],
    ["SAP GR", "SAP.XETRA"],
    ["SAP GR Equity", "SAP.XETRA"],
    ["vod ln", "VOD.LSE"],
    ["SAP.XETRA", "SAP.XETRA"],
    ["BRK-B", "BRK-B.US"],
    ["BTC-USD.CC", "BTC-USD.CC"],
    ["GSPC.INDX", "GSPC.INDX"],
    ["  nwnd  ", "NWND.US"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeTicker(raw)).toBe(expected);
  });

  it.each(["", "   ", "a b c", "../etc", "AAPL/US", "x".repeat(40), "AA PL!", "."])("lehnt %j ab", (raw) => {
    expect(normalizeTicker(raw)).toBeNull();
  });
});

describe("resolveFn", () => {
  it("kennt Codes und Aliasse, unabhängig von Groß-/Kleinschreibung", () => {
    expect(resolveFn("gp")).toBe("GP");
    expect(resolveFn("news")).toBe("TOP");
    expect(resolveFn("?")).toBe("HELP");
    expect(resolveFn("NWND")).toBeNull();
  });

  it("Objekt-Prototyp ist keine Funktion", () => {
    expect(resolveFn("constructor")).toBeNull();
    expect(resolveFn("__proto__")).toBeNull();
    expect(resolveFn("toString")).toBeNull();
  });

  it("jede Funktion ist in FN registriert", () => {
    for (const f of FUNCTIONS) expect(FN[f.code]).toBe(f);
  });
});

describe("parseCommand", () => {
  it("Ticker, Funktion und Kombinationen", () => {
    expect(parseCommand("GP")).toEqual({ kind: "fn", fn: "GP", ticker: null });
    expect(parseCommand("NWND GP")).toEqual({ kind: "fn", fn: "GP", ticker: "NWND.US" });
    expect(parseCommand("ELBT GR DES")).toEqual({ kind: "fn", fn: "DES", ticker: "ELBT.XETRA" });
    expect(parseCommand("NWND.US")).toEqual({ kind: "ticker", ticker: "NWND.US" });
    expect(parseCommand("ELBT GR")).toEqual({ kind: "ticker", ticker: "ELBT.XETRA" });
    expect(parseCommand("   ")).toBeNull();
  });

  it("entfernt <GO> und ein abschließendes GO", () => {
    expect(parseCommand("NWND GP <GO>")).toEqual({ kind: "fn", fn: "GP", ticker: "NWND.US" });
    expect(parseCommand("NWND GP<GO>")).toEqual({ kind: "fn", fn: "GP", ticker: "NWND.US" });
    expect(parseCommand("nwnd gp go")).toEqual({ kind: "fn", fn: "GP", ticker: "NWND.US" });
    expect(parseCommand("GO")).toBeNull();
  });

  it("Ticker, die auf GO enden, bleiben vollständig (Regression: WGO wurde zu W)", () => {
    expect(parseCommand("WGO")).toEqual({ kind: "ticker", ticker: "WGO.US" });
    expect(parseCommand("AGO DES")).toEqual({ kind: "fn", fn: "DES", ticker: "AGO.US" });
    expect(parseCommand("ALGO")).toEqual({ kind: "ticker", ticker: "ALGO.US" });
    expect(parseCommand("WGO <GO>")).toEqual({ kind: "ticker", ticker: "WGO.US" });
  });

  it("meldet unbekannte Eingaben verständlich", () => {
    const r = parseCommand("AA PL! GP");
    expect(r?.kind).toBe("error");
    expect(parseCommand("a b c d")?.kind).toBe("error");
  });
});
