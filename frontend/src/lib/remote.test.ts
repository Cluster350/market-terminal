import { describe, expect, it } from "vitest";
import { isForWindow, parseRemote } from "./remote";

describe("Fernsteuerung (Stream Deck)", () => {
  it("liest nur gültige Aufträge", () => {
    expect(parseRemote('{"id":1,"target":"main","command":"STIM"}')?.command).toBe("STIM");
    expect(parseRemote('{"id":2,"target":"main","page":"macro"}')?.page).toBe("macro");
    expect(parseRemote('{"id":3,"target":"main","page":"admin"}')).toBeNull();
    expect(parseRemote(`{"id":4,"command":"${"x".repeat(81)}"}`)).toBeNull();
    expect(parseRemote("kein json")).toBeNull();
    expect(parseRemote('{"command":"STIM"}')).toBeNull();
  });
  it("führt den Auftrag nur im gemeinten Fenster aus", () => {
    expect(isForWindow({ id: 1, target: "main" }, "main")).toBe(true);
    expect(isForWindow({ id: 1, target: "makro" }, "main")).toBe(false);
    expect(isForWindow({ id: 1, target: "" }, "main")).toBe(true);
  });
});
