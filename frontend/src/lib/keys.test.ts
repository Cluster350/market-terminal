import { describe, expect, it } from "vitest";
import { isTextEntry } from "./keys";

describe("isTextEntry (Regression R3-1: Tippen nach Auswahlfeld)", () => {
  it("Textfelder behalten Tasten, Auswahlfelder und Checkboxen nicht", () => {
    expect(isTextEntry({ tagName: "INPUT", isContentEditable: false, type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", isContentEditable: false, type: "search" })).toBe(true);
    expect(isTextEntry({ tagName: "TEXTAREA", isContentEditable: false })).toBe(true);
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextEntry({ tagName: "SELECT", isContentEditable: false })).toBe(false);
    expect(isTextEntry({ tagName: "INPUT", isContentEditable: false, type: "checkbox" })).toBe(false);
    expect(isTextEntry({ tagName: "BUTTON", isContentEditable: false })).toBe(false);
  });
});
