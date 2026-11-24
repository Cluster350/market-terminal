import { describe, expect, it } from "vitest";
import css from "./terminal.css?raw";
import keys from "../../../streamdeck/src/keys.js?raw";
import { CSS_VARS, PAL, seriesStyle, seriesStyleWithoutRef, SERIES, textOn } from "./palette";

const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));

describe("Palette", () => {
  it("CSS-Variablen in terminal.css stimmen mit palette.ts überein", () => {
    for (const [name, key] of Object.entries(CSS_VARS)) {
      const m = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m, name).not.toBeNull();
      expect(m![1].toLowerCase(), name).toBe(PAL[key]);
    }
  });

  it("Stream-Deck-Plugin nutzt dieselbe Stimmungsskala", () => {
    const hex = (h: string) => `[${[1, 3, 5].map((i) => `0x${h.slice(i, i + 2)}`).join(", ")}]`;
    expect(keys).toContain(`B = ${hex(PAL.scaleLow)}`);
    expect(keys).toContain(`G = ${hex(PAL.scaleMid)}`);
    expect(keys).toContain(`M = ${hex(PAL.scaleHigh)}`);
  });

  it("Reihenfarben: keine Signalfarbe, ab der siebten Reihe gestrichelt", () => {
    for (const c of SERIES) expect([PAL.up, PAL.down, PAL.warn]).not.toContain(c);
    expect(seriesStyle(0)).toEqual({ color: PAL.c1, dashed: false });
    expect(seriesStyle(5)).toEqual({ color: PAL.c6, dashed: false });
    expect(seriesStyle(6)).toEqual({ color: PAL.c1, dashed: true });
    expect(seriesStyle(11)).toEqual({ color: PAL.c6, dashed: true });
    expect(seriesStyleWithoutRef(2).color).toBe(PAL.c4);
  });

  it("Schrift auf Flächen: hell → schwarz, dunkel → weiß", () => {
    expect(textOn(PAL.bsCash)).toBe("#000");
    expect(textOn(PAL.bsEq)).toBe("#000");
    expect(textOn("#000000")).toBe("#fff");
  });
});
