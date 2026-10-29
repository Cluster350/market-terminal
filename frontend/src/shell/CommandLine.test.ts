import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import { isNotFound, secTickerOf } from "./CommandLine";

describe("secTickerOf (Wertpapierteil für die Vorabprüfung)", () => {
  it("prüft erst, wenn der Wertpapierteil abgeschlossen ist", () => {
    expect(secTickerOf("NWND", false)).toBeNull(); // mitten im ersten Wort
    expect(secTickerOf("NWND ", false)).toBe("NWND.US");
    expect(secTickerOf("NWND US GP", false)).toBe("NWND.US");
    expect(secTickerOf("NWND US G", false)).toBe("NWND.US"); // G = Alias für GP
    expect(secTickerOf("GP ", false)).toBeNull();
    expect(secTickerOf("W 1 Comdty GP", false)).toBe("WHEAT.COMM");
  });

  it("vollständig nur mit Leerzeichen am Ende oder Funktion", () => {
    expect(secTickerOf("XYZQ US", true)).toBeNull();
    expect(secTickerOf("XYZQ US ", true)).toBe("XYZQ.US");
    expect(secTickerOf("XYZQ US DES", true)).toBe("XYZQ.US");
  });
});

describe("isNotFound", () => {
  it("nur 404 gilt als unbekanntes Wertpapier, nicht Netz-, Server- oder Budgetfehler (Regression)", () => {
    expect(isNotFound(new ApiError(404, "not_found", "Unbekannter Ticker"))).toBe(true);
    expect(isNotFound(new ApiError(502, "upstream", "EODHD nicht erreichbar"))).toBe(false);
    expect(isNotFound(new ApiError(429, "budget", "Tagesbudget erreicht"))).toBe(false);
    expect(isNotFound(new ApiError(0, "network", "Server nicht erreichbar"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});
