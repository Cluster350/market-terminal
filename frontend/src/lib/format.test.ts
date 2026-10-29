import { describe, expect, it } from "vitest";
import {
  DASH,
  displayTicker,
  escapeHtml,
  fmt,
  fmtAge,
  fmtBig,
  fmtBp,
  fmtDate,
  fmtInt,
  fmtPct,
  fmtPrice,
  fmtRatio,
  fmtShortDate,
  fmtSigned,
  isNum,
  safeUrl,
  shiftMonths,
  tone,
} from "./format";

describe("Zahlenformate (de-DE)", () => {
  it("formatiert mit deutschem Dezimal- und Tausendertrennzeichen", () => {
    expect(fmt(1234567.891, 2)).toBe("1.234.567,89");
    expect(fmtPrice(1.23456)).toBe("1,2346");
    expect(fmtPrice(18250.5)).toBe("18.250,50");
    expect(fmtInt(1234.4)).toBe("1.234");
  });

  it("zeigt für null, undefined, NaN und Infinity einen Strich", () => {
    for (const x of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(fmt(x as number)).toBe(DASH);
      expect(fmtPrice(x as number)).toBe(DASH);
      expect(fmtPct(x as number)).toBe(DASH);
      expect(fmtBig(x as number)).toBe(DASH);
      expect(fmtBp(x as number)).toBe(DASH);
    }
    expect(isNum(NaN)).toBe(false);
    expect(isNum(0)).toBe(true);
  });

  it("zeigt keine negative Null", () => {
    expect(fmt(-0.0001, 2)).toBe("0,00");
    expect(fmt(-0, 2)).toBe("0,00");
    expect(fmtPct(-0.001, 2, false)).toBe("0,00 %");
    expect(fmtRatio(-0.00001)).toBe("0,0 %");
    expect(fmtInt(-0.2)).toBe("0");
    expect(fmt(-0.006, 2)).toBe("-0,01");
  });

  it("Vorzeichen, Prozent, Anteile und Basispunkte", () => {
    expect(fmtSigned(1.5)).toBe("+1,50");
    expect(fmtSigned(0)).toBe("0,00");
    expect(fmtPct(2.345)).toBe("+2,35 %");
    expect(fmtPct(-1.2, 1)).toBe("-1,2 %");
    expect(fmtRatio(0.015)).toBe("1,5 %");
    expect(fmtBp(0.05)).toBe("+5 bp");
    expect(fmtBp(-0.004)).toBe("0 bp");
  });

  it("große Beträge kompakt", () => {
    expect(fmtBig(1.234e12)).toBe("1,23 Bio.");
    expect(fmtBig(-4.5e9)).toBe("-4,50 Mrd.");
    expect(fmtBig(7.8e6)).toBe("7,8 Mio.");
    expect(fmtBig(12345)).toBe("12,3 Tsd.");
    expect(fmtBig(999)).toBe("999");
  });

  it("tone ordnet Vorzeichen Farben zu", () => {
    expect(tone(1)).toBe("up");
    expect(tone(-1)).toBe("down");
    expect(tone(0)).toBe("flat");
    expect(tone(null)).toBe("flat");
  });
});

describe("Datumsformate", () => {
  it("reines Datum wird als lokales Datum gelesen (kein Vortag durch UTC)", () => {
    expect(fmtDate("2026-10-28")).toBe("28.10.2026");
    expect(fmtShortDate("2026-01-02")).toBe("02.01.");
  });

  it("ungültige Eingaben ergeben einen Strich", () => {
    expect(fmtDate(null)).toBe(DASH);
    expect(fmtDate("")).toBe(DASH);
    expect(fmtDate("kein Datum")).toBe(DASH);
    expect(fmtAge(undefined)).toBe(DASH);
    expect(fmtAge("unsinn")).toBe(DASH);
  });

  it("shiftMonths begrenzt auf das Monatsende (Regression: 31.03. − 1M = 03.03.)", () => {
    expect(shiftMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2024-02-29", 12)).toBe("2023-02-28");
    expect(shiftMonths("2026-05-31", 3)).toBe("2026-02-28");
    expect(shiftMonths("2026-01-15", 1)).toBe("2025-12-15");
    expect(shiftMonths("2026-10-28", 60)).toBe("2021-10-28");
    expect(shiftMonths("2026-12-31", 6)).toBe("2026-06-30");
  });

  it("fmtAge: gerade / Minuten / Zukunft", () => {
    const now = Date.UTC(2026, 9, 28, 15, 0, 0);
    expect(fmtAge(new Date(now - 20_000).toISOString(), now)).toBe("gerade");
    expect(fmtAge(new Date(now - 5 * 60_000).toISOString(), now)).toBe("vor 5 Min.");
    expect(fmtAge(new Date(now + 60_000).toISOString(), now)).toBe("gerade");
  });
});

describe("Ticker und Fremddaten", () => {
  it("displayTicker trennt am letzten Punkt", () => {
    expect(displayTicker("NWND.US")).toBe("NWND US");
    expect(displayTicker("BTC-USD.CC")).toBe("BTC-USD CC");
    expect(displayTicker("OHNEBOERSE")).toBe("OHNEBOERSE");
  });

  it("safeUrl lässt nur http(s) zu und ergänzt nackte Domains", () => {
    expect(safeUrl("https://www.sap.com")).toBe("https://www.sap.com");
    expect(safeUrl("HTTP://example.com/a?b=1")).toBe("HTTP://example.com/a?b=1");
    expect(safeUrl("www.apple.com")).toBe("https://www.apple.com");
    expect(safeUrl("apple.com/investor")).toBe("https://apple.com/investor");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("//evil.example")).toBeNull();
    expect(safeUrl("/relative/pfad")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it("escapeHtml neutralisiert Markup", () => {
    expect(escapeHtml('<img src=x onerror="a">')).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
    expect(escapeHtml("AT&T Inc")).toBe("AT&amp;T Inc");
    expect(escapeHtml(null)).toBe("");
  });
});
