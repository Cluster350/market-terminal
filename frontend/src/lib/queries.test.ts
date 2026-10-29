import { describe, expect, it } from "vitest";
import { ApiError, emptyQuote } from "./api";
import { retry } from "./queries";

describe("retry", () => {
  it("wiederholt Netz- und Serverfehler höchstens zweimal, Clientfehler nie", () => {
    expect(retry(0, new ApiError(0, "network", "x"))).toBe(true);
    expect(retry(1, new ApiError(502, "upstream", "x"))).toBe(true);
    expect(retry(2, new ApiError(502, "upstream", "x"))).toBe(false);
    expect(retry(0, new ApiError(404, "not_found", "x"))).toBe(false);
    expect(retry(0, new ApiError(429, "budget", "x"))).toBe(false);
    expect(retry(0, new Error("x"))).toBe(true);
  });
});

describe("emptyQuote (statischer Modus)", () => {
  it("hat alle Felder als null wie das Backend, nicht undefined", () => {
    const q = emptyQuote("NOPE.US");
    expect(q.ticker).toBe("NOPE.US");
    for (const k of ["last", "change", "changePct", "open", "high", "low", "prevClose", "volume", "timestamp", "name", "currency"] as const) {
      expect(q[k]).toBeNull();
    }
  });
});
