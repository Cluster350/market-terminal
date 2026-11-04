import { describe, expect, it } from "vitest";
import { formatMetric, toneOf } from "../screens/worldmap";
import { PAGES } from "../state/workspace";
import { resolveFn } from "./commands";
import { colorRange, fixRing, ISO_NUMERIC, METRIC_BY_KEY, METRICS, worldGeoJson } from "./worldmap";

describe("Weltkarte", () => {
  it("baut die Umrisse ohne Antarktis und mit ISO-Namen", () => {
    const geo = worldGeoJson();
    const names = geo.features.map((f) => f.properties.name);
    expect(names).toContain("DEU");
    expect(names).toContain("USA");
    expect(names).not.toContain("Antarctica");
    // Alle Länder mit Daten haben Umrisse (Singapur/Hongkong sind auf dieser Karte zu klein)
    for (const iso of Object.keys(ISO_NUMERIC)) expect(names).toContain(iso);
  });

  it("schließt Ringe über die Datumsgrenze", () => {
    expect(fixRing([[170, 60], [-175, 62], [-170, 65]])).toEqual([[170, 60], [185, 62], [190, 65]]);
    expect(fixRing([[10, 50], [20, 51]])).toEqual([[10, 50], [20, 51]]);
    const russia = worldGeoJson().features.find((f) => f.properties.name === "Russia")!;
    const rings = (russia.geometry as { coordinates: [number, number][][][] }).coordinates.flat();
    for (const r of rings) {
      const lons = r.map((p) => p[0]);
      expect(Math.max(...lons) - Math.min(...lons)).toBeLessThanOrEqual(180);
    }
  });

  it("wählt Farbskalen passend zur Kennzahl", () => {
    const d = colorRange([-3, -1, 0, 1, 2, 2.5, 2.6, 2.7, 2.8, 50], "diverging");
    expect(d.min).toBe(-d.max); // symmetrisch um 0
    expect(d.max).toBeLessThan(50); // Ausreißer bestimmt nicht die Skala
    expect(colorRange([1, 2, 40], "lowGood", [0, 8])).toMatchObject({ min: 0, max: 8 });
    const lvl = colorRange([1, 2, 3, 4], "level");
    expect(lvl.min).toBeLessThan(lvl.max);
    expect(colorRange([], "level")).toMatchObject({ min: 0, max: 1 });
  });

  it("formatiert Werte und Farben je Kennzahl", () => {
    expect(formatMetric(METRIC_BY_KEY.eq_1d, 1.234)).toBe("+1,23 %");
    expect(formatMetric(METRIC_BY_KEY.y10_1m, -12)).toBe("−12 bp".replace("−", "-"));
    expect(formatMetric(METRIC_BY_KEY.infl, null)).toBe("–");
    expect(toneOf(METRIC_BY_KEY.eq_1d, 1)).toBe("up");
    expect(toneOf(METRIC_BY_KEY.y10_1m, 10)).toBe("down"); // steigende Renditen rot
    expect(toneOf(METRIC_BY_KEY.infl, 10)).toBe(""); // Niveau ohne Wertung per Farbe
    expect(new Set(METRICS.map((m) => m.group))).toEqual(new Set(["equity", "rates", "macro"]));
  });

  it("steht auf der MAKRO-Seite und kennt deutsche Befehle", () => {
    expect(PAGES.find((p) => p.id === "macro")!.panels[0]).toBe("WMAP");
    expect(PAGES.find((p) => p.id === "macro")!.pool).toContain("FX");
    expect(resolveFn("weltkarte")).toBe("WMAP");
    expect(resolveFn("KARTE")).toBe("WMAP");
  });
});
