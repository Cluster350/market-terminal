// Weltkarte (WMAP): Länderdaten, Kennzahlen, Farbskalen und Kartenumrisse (world-atlas, 1:110 Mio.).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { feature } from "topojson-client";
import topology from "world-atlas/countries-110m.json";
import { file, IS_STATIC, request } from "./api";

export type WorldGroup = "equity" | "rates" | "macro";

export interface WorldCountry {
  iso3: string;
  name: string;
  index: { ticker: string; name: string; last: number | null; changePct: number | null; chg1w: number | null; chg1m: number | null; chgYtd: number | null } | null;
  bond: { ticker: string; value: number | null; chg1mBp: number | null } | null;
  macro: Record<string, { year: number | null; value: number | null }>;
}

export interface WorldMapData {
  group: WorldGroup;
  countries: WorldCountry[];
  indicators: { key: string; label: string; unit: string }[];
  asOf: string | null;
  note: string | null;
}

export const worldApi = {
  get: (group: WorldGroup) =>
    IS_STATIC ? file<WorldMapData>(`macro/worldmap-${group}.json`) : request<WorldMapData>(`/macro/worldmap?group=${group}`),
};

export const useWorldMap = (group: WorldGroup) =>
  useQuery({
    queryKey: ["worldmap", group],
    queryFn: () => worldApi.get(group),
    refetchInterval: IS_STATIC ? false : group === "equity" ? 60_000 : 900_000,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

// --- Kennzahlen ------------------------------------------------------------------------

/** diverging: rot – grau – grün um 0; inverse: grün – grau – rot (steigende Renditen rot);
 * lowGood: niedrig grün, hoch rot; level: neutrale Blautöne nach Höhe. */
export type Scale = "diverging" | "inverse" | "lowGood" | "level";

export interface Metric {
  key: string;
  group: WorldGroup;
  label: string;
  unit: "%" | "bp";
  digits: number;
  scale: Scale;
  signed: boolean;
  value: (c: WorldCountry) => number | null;
  macroKey?: string; // Konjunktur: Schlüssel für das Jahr der Angabe
  domain?: [number, number]; // feste Farbskala (z. B. Inflation 0–8 %), sonst aus den Daten
}

const macro = (key: string) => ({ macroKey: key, value: (c: WorldCountry) => c.macro[key]?.value ?? null });

export const METRICS: Metric[] = [
  { key: "eq_1d", group: "equity", label: "Heute", unit: "%", digits: 2, scale: "diverging", signed: true, value: (c) => c.index?.changePct ?? null },
  { key: "eq_1w", group: "equity", label: "1 Woche", unit: "%", digits: 1, scale: "diverging", signed: true, value: (c) => c.index?.chg1w ?? null },
  { key: "eq_1m", group: "equity", label: "1 Monat", unit: "%", digits: 1, scale: "diverging", signed: true, value: (c) => c.index?.chg1m ?? null },
  { key: "eq_ytd", group: "equity", label: "seit Jahresbeginn", unit: "%", digits: 1, scale: "diverging", signed: true, value: (c) => c.index?.chgYtd ?? null },
  { key: "y10", group: "rates", label: "Rendite 10 J.", unit: "%", digits: 2, scale: "level", signed: false, value: (c) => c.bond?.value ?? null },
  { key: "y10_1m", group: "rates", label: "Veränderung 1 Monat", unit: "bp", digits: 0, scale: "inverse", signed: true, value: (c) => c.bond?.chg1mBp ?? null },
  { key: "gdp", group: "macro", label: "BIP-Wachstum", unit: "%", digits: 1, scale: "diverging", signed: true, ...macro("gdp_growth_annual") },
  { key: "infl", group: "macro", label: "Inflation", unit: "%", digits: 1, scale: "lowGood", signed: false, domain: [0, 8], ...macro("inflation_consumer_prices_annual") },
  { key: "unemp", group: "macro", label: "Arbeitslosigkeit", unit: "%", digits: 1, scale: "lowGood", signed: false, domain: [3, 12], ...macro("unemployment_total_percent") },
  { key: "debt", group: "macro", label: "Staatsschulden/BIP", unit: "%", digits: 0, scale: "lowGood", signed: false, domain: [30, 130], ...macro("debt_percent_gdp") },
  { key: "real", group: "macro", label: "Realzins", unit: "%", digits: 1, scale: "diverging", signed: true, ...macro("real_interest_rate") },
];

export const METRIC_BY_KEY: Record<string, Metric> = Object.fromEntries(METRICS.map((m) => [m.key, m]));
export const GROUP_LABEL: Record<WorldGroup, string> = { equity: "Aktien", rates: "Zinsen", macro: "Konjunktur" };

const COLORS: Record<Scale, string[]> = {
  diverging: ["#d43c3c", "#5a2a2a", "#2a2a2a", "#1f4d36", "#29d17d"],
  inverse: ["#29d17d", "#1f4d36", "#2a2a2a", "#5a2a2a", "#d43c3c"],
  lowGood: ["#29d17d", "#9bbf3a", "#f2c200", "#ff8a3d", "#d43c3c"],
  level: ["#10263d", "#1d4a75", "#2f74b5", "#66b8ff", "#bfe2ff"],
};

/** Farbskala und Bereich: Abweichungen symmetrisch um 0, sonst vom kleinsten zum größten Wert. */
export function colorRange(values: number[], scale: Scale, domain?: [number, number]): { min: number; max: number; colors: string[] } {
  if (domain) return { min: domain[0], max: domain[1], colors: COLORS[scale] };
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { min: 0, max: 1, colors: COLORS[scale] };
  if (scale === "diverging" || scale === "inverse") {
    // 90-%-Quantil statt Maximum: ein Ausreißer (z. B. Argentinien) soll nicht alles grau machen
    const abs = finite.map(Math.abs).sort((a, b) => a - b);
    const m = Math.max(abs[Math.floor((abs.length - 1) * 0.9)], 0.1);
    return { min: -m, max: m, colors: COLORS[scale] };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const lo = sorted[Math.floor((sorted.length - 1) * 0.05)];
  const hi = sorted[Math.ceil((sorted.length - 1) * 0.95)];
  return { min: lo, max: hi > lo ? hi : lo + 1, colors: COLORS[scale] };
}

// --- Kartenumrisse ---------------------------------------------------------------------

/** ISO-3166 alpha-3 -> numerischer Code (Kennung in world-atlas). */
export const ISO_NUMERIC: Record<string, string> = {
  USA: "840", CAN: "124", MEX: "484", BRA: "076", ARG: "032", CHL: "152", DEU: "276", FRA: "250", GBR: "826", ITA: "380",
  ESP: "724", NLD: "528", BEL: "056", AUT: "040", CHE: "756", SWE: "752", NOR: "578", DNK: "208", FIN: "246", POL: "616",
  PRT: "620", GRC: "300", IRL: "372", TUR: "792", ISR: "376", SAU: "682", ZAF: "710", JPN: "392", CHN: "156", IND: "356",
  KOR: "410", TWN: "158", IDN: "360", AUS: "036", NZL: "554",
};
const NUMERIC_ISO: Record<string, string> = Object.fromEntries(Object.entries(ISO_NUMERIC).map(([k, v]) => [v, k]));

export const MAP_NAME = "welt";

type Ring = [number, number][];

/** Ringe über die Datumsgrenze (Russland, Fidschi) zusammenhängend machen – sonst zieht die
 * Karte einen Streifen quer über die Welt. */
export function fixRing(ring: Ring): Ring {
  const lons = ring.map((p) => p[0]);
  if (Math.max(...lons) - Math.min(...lons) <= 180) return ring;
  return ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]);
}

function fixGeometry(g: unknown): unknown {
  const geo = g as { type: string; coordinates: unknown } | null;
  if (!geo) return geo;
  if (geo.type === "Polygon") return { ...geo, coordinates: (geo.coordinates as Ring[]).map(fixRing) };
  if (geo.type === "MultiPolygon") return { ...geo, coordinates: (geo.coordinates as Ring[][]).map((poly) => poly.map(fixRing)) };
  return geo;
}

/** Kartenumrisse als GeoJSON; Länder mit Daten heißen nach ihrem ISO3-Code, die übrigen englisch. Ohne Antarktis. */
export function worldGeoJson() {
  const fc = feature(topology, (topology as unknown as { objects: { countries: unknown } }).objects.countries);
  return {
    type: "FeatureCollection" as const,
    features: fc.features
      .filter((f) => String(f.id) !== "010")
      .map((f) => ({
        ...f,
        geometry: fixGeometry(f.geometry),
        properties: { name: NUMERIC_ISO[String(f.id)] ?? String(f.properties.name ?? f.id ?? "") },
      })),
  };
}

export interface View {
  label: string;
  center?: [number, number];
  zoom: number;
}

export const VIEWS: Record<string, View> = {
  welt: { label: "Welt", zoom: 1.15 },
  europa: { label: "Europa", center: [14, 53], zoom: 4.6 },
  amerika: { label: "Amerika", center: [-80, 12], zoom: 1.9 },
  asien: { label: "Asien/Pazifik", center: [118, 8], zoom: 2.1 },
};
