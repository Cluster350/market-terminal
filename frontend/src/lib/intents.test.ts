import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";
import { countryCode } from "./intents";

describe("Länder im Befehl", () => {
  it("versteht IT GC, GC IT, FWD DE und Ländernamen", () => {
    expect(parseCommand("IT GC")).toEqual({ kind: "fn", fn: "GC", ticker: null, country: "IT" });
    expect(parseCommand("GC IT")).toEqual({ kind: "fn", fn: "GC", ticker: null, country: "IT" });
    expect(parseCommand("FWD DE")).toEqual({ kind: "fn", fn: "FWD", ticker: null, country: "DE" });
    expect(parseCommand("Japan ECO")).toEqual({ kind: "fn", fn: "ECO", ticker: null, country: "JP" });
    expect(countryCode("gbr")).toBe("UK");
  });
  it("lässt Ticker bei anderen Funktionen in Ruhe", () => {
    expect(parseCommand("DE GP")).toEqual({ kind: "fn", fn: "GP", ticker: "DE.US" });
    expect(parseCommand("NWND US GC")).toEqual({ kind: "fn", fn: "GC", ticker: "NWND.US" });
  });
});
