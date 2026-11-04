// Minimale Typen für topojson-client (nur feature() wird genutzt).
declare module "topojson-client" {
  export interface GeoFeature {
    type: "Feature";
    id?: string | number;
    properties: Record<string, unknown>;
    geometry: unknown;
  }
  export function feature(topology: unknown, object: unknown): { type: "FeatureCollection"; features: GeoFeature[] };
}
