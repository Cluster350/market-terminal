import { describe, expect, it } from "vitest";
import { FN, FUNCTIONS, nearestFn, normalizeTicker, parseCommand, resolveFn, unknownSecurityMessage } from "./commands";

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

describe("Gelbe Bloomberg-Tasten und Funktionsprüfung", () => {
  it("löst Index-, Devisen-, Anleihen- und Rohstoffkürzel auf", () => {
    expect(normalizeTicker("DAX INDEX")).toBe("GDAXI.INDX");
    expect(normalizeTicker("spx index")).toBe("GSPC.INDX");
    expect(normalizeTicker("GDAXI Index")).toBe("GDAXI.INDX");
    expect(normalizeTicker("EURUSD CURNCY")).toBe("EURUSD.FOREX");
    expect(normalizeTicker("BTC-USD Curncy")).toBe("BTC-USD.CC");
    expect(normalizeTicker("US10Y GOVT")).toBe("US10Y.GBOND");
    expect(normalizeTicker("GOLD COMDTY")).toBe("GOLD.COMM");
    expect(normalizeTicker("SAP GR EQUITY")).toBe("SAP.XETRA");
  });

  it("meldet unbekannte Funktionen statt sie zu ignorieren", () => {
    const c = parseCommand("NWND US GPP");
    expect(c?.kind).toBe("error");
    expect(parseCommand("ELBT GR")).toEqual({ kind: "ticker", ticker: "ELBT.XETRA" });
    expect(parseCommand("DAX INDEX GP")).toEqual({ kind: "fn", fn: "GP", ticker: "GDAXI.INDX" });
    expect(parseCommand("ELBT GR RV")).toEqual({ kind: "fn", fn: "RV", ticker: "ELBT.XETRA" });
    expect(parseCommand("EVTS")).toEqual({ kind: "fn", fn: "EVTS", ticker: null });
  });

  it("Prototyp-Namen sind keine Funktionen", () => {
    expect(parseCommand("toString")).toEqual({ kind: "ticker", ticker: "TOSTRING.US" });
  });
});

describe("Runde 3: Tippfehler und Rohstoff-Generika", () => {
  it("schlägt bei vertippten Funktionen die nächstliegende vor", () => {
    expect(nearestFn("HLEP")).toBe("HELP");
    expect(nearestFn("GPP")).toBe("GP");
    expect(nearestFn("HELP")).toBeNull(); // gültige Funktion
    expect(nearestFn("XYZQ")).toBeNull();
    const c = parseCommand("NWND US GPP");
    expect(c).toMatchObject({ kind: "error" });
    expect(c?.kind === "error" && c.message).toContain("Meinten Sie GP?");
  });

  it("meldet unbekannte Wertpapiere im Bloomberg-Format", () => {
    expect(unknownSecurityMessage("HLEP", "HLEP.US", "Unbekannter Ticker HLEP.US. Meinten Sie: HRVS.US, MTHR.SW?")).toBe(
      "„HLEP“ ist weder Funktion noch Wertpapier. Meinten Sie HELP? Wertpapiere: HRVS US, MTHR SW",
    );
    expect(unknownSecurityMessage("XYZQ US GP", "XYZQ.US", "Unbekannter Ticker XYZQ.US.")).toBe("Unbekanntes Wertpapier XYZQ US.");
    expect(unknownSecurityMessage("LMRX FP", "LMRX.PA", "Unbekannter Ticker LMRX.PA. Meinten Sie: LMRE.PA?")).toBe(
      "Unbekanntes Wertpapier LMRX FP. Meinten Sie: LMRE FP",
    );
  });

  it("löst Bloomberg-Generika für Rohstoffe auf", () => {
    expect(normalizeTicker("CL1 Comdty")).toBe("WTI.COMM");
    expect(normalizeTicker("CO1 COMDTY")).toBe("BRENT.COMM");
    expect(normalizeTicker("GC1 Comdty")).toBe("GOLD.COMM");
    expect(normalizeTicker("hasOwnProperty Comdty")).toBe("HASOWNPROPERTY.COMM");
  });
});

describe("Rohstoff-Generika in Bloomberg-Schreibweise", () => {
  it("einbuchstabige Wurzeln mit Leerzeichen (W 1 Comdty) wie W1 Comdty", () => {
    expect(normalizeTicker("W 1 Comdty")).toBe("WHEAT.COMM");
    expect(normalizeTicker("C 1 Comdty")).toBe("CORN.COMM");
    expect(normalizeTicker("S 1 COMDTY")).toBe("SOY.COMM");
    expect(normalizeTicker("W1 Comdty")).toBe("WHEAT.COMM");
    expect(normalizeTicker("CL1 Comdty")).toBe("WTI.COMM");
    expect(parseCommand("C 1 Comdty GP")).toEqual({ kind: "fn", fn: "GP", ticker: "CORN.COMM" });
  });
});
