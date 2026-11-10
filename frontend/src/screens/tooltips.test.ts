import { describe, expect, it } from "vitest";
import type { RotationResult } from "../lib/rotation";
import type { ValRow } from "../lib/valuation";
import { rrgOption } from "./rotation";
import { valMapTip } from "./valuation";

// ECharts setzt den Rückgabewert eines Tooltip-Formatters als HTML ein. Firmen- und Sektornamen stammen aus der
// Datenquelle und dürfen dort kein Markup (z. B. <img onerror=…>) ausführen.
const EVIL = '<img src=x onerror="window.__xss=1">Northwind';

describe("Tooltips mit Namen aus der Datenquelle (XSS)", () => {
  it("RRG: Reihenname wird escaped", () => {
    const r = {
      universe: "sector", title: "Im Sektor Technologie", benchmark: "Sektorindex", weeks: ["2026-11-06"], freq: "w",
      members: [{ key: "NWND.US", label: EVIL, ticker: "NWND.US", trend: [101], momentum: [99], quadrant: null, heading: null, speed: null, rel4: null, rel13: null, fairGap: null, detail: null }],
      test: {}, state: "ready", note: "", skipped: [],
    } as unknown as RotationResult;
    const tooltip = rrgOption(r, 0, 1, null).tooltip as { formatter: (p: unknown) => string };
    const html = tooltip.formatter({ seriesName: EVIL, data: { value: [101, 99], week: "2026-11-06" } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;Northwind<br/>");
  });

  it("BWT-Landkarte: Gruppenname wird escaped, Zahlen bleiben", () => {
    const row = { key: "Technology", label: EVIL, kind: "sector", region: "all", n: 5, peYears: {}, negativeYears: [], peTtm: 25.4, avg: 20, low: 10, high: 30, position: 0.6, chg12m: null, growthNext: null, rev30: null, rev90: 0.02, up30: 0, down30: 0, dist52: null, median: 21, fairGap: -0.1, state: "nahe" } as ValRow;
    const html = valMapTip(row);
    expect(html).not.toContain("<img");
    expect(html.startsWith("&lt;img")).toBe(true);
    expect(html).toContain("KGV heute 25,4");
  });
});
