import { describe, expect, it } from "vitest";
import { setTapeVisible, tapeVisible } from "./tape";

describe("Laufband je Fenster", () => {
  it("ist standardmäßig an und wird je Fenster getrennt gemerkt", () => {
    expect(tapeVisible("main")).toBe(true);
    setTapeVisible("makro", false);
    expect(tapeVisible("makro")).toBe(false);
    expect(tapeVisible("main")).toBe(true); // anderes Fenster unberührt
    setTapeVisible("makro", true);
    expect(tapeVisible("makro")).toBe(true);
  });
});
