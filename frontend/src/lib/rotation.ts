// Relative Rotation (RRG): Sektoren, Firmen im Sektor, Länderindizes, Währungen, Kryptowährungen und Faktoren
// (Stil-ETFs) gegen einen Maßstab.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";
import { fmt } from "./format";

export type Universe = "sectors" | "sector" | "countries" | "currencies" | "crypto" | "factors";
export type Quadrant = "fuehrend" | "schwaecher" | "nachzuegler" | "erholend";

export interface RotMember {
  key: string;
  label: string;
  ticker: string | null;
  trend: (number | null)[];
  momentum: (number | null)[];
  quadrant: Quadrant | null;
  heading: number | null;
  speed: number | null;
  rel4: number | null;
  rel13: number | null;
  fairGap: number | null;
  detail: string | null;
}

interface QuadrantStats {
  n: number;
  avg: number | null;
  up: number | null;
}

export interface RotationResult {
  universe: Universe;
  title: string;
  benchmark: string;
  weeks: string[];
  members: RotMember[];
  test: {
    quadrants?: Record<Quadrant, { h4: QuadrantStats; h13: QuadrantStats }>;
    clockwise?: number;
    counter?: number;
    clockwiseShare?: number | null;
  };
  state: "ready" | "building";
  note: string;
  skipped: string[];
}

export interface RotationParams {
  universe: Universe;
  region: "us" | "eu" | "all";
  sector?: string;
  ccy: "eur" | "local";
  bench: "basket" | "eur" | "btc";
}

export const useRotation = (p: RotationParams) =>
  useQuery({
    queryKey: ["rotation", p],
    queryFn: () => request<RotationResult>(`/rotation${qs({ ...p })}`, undefined, { timeoutMs: 90_000 }),
    enabled: !IS_STATIC && (p.universe !== "sector" || !!p.sector),
    staleTime: 600_000,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.state === "building" ? 3000 : false),
  });

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  fuehrend: "führend",
  schwaecher: "schwächer werdend",
  nachzuegler: "Nachzügler",
  erholend: "erholend",
};

export const QUADRANT_COLOR: Record<Quadrant, string> = {
  fuehrend: "#29d17d",
  schwaecher: "#f2c200",
  nachzuegler: "#ff5252",
  erholend: "#66b8ff",
};

export const QUADRANT_ORDER: Quadrant[] = ["fuehrend", "schwaecher", "nachzuegler", "erholend"];

export function quadrantOf(trend: number | null | undefined, mom: number | null | undefined): Quadrant | null {
  if (trend === null || trend === undefined || mom === null || mom === undefined) return null;
  if (trend >= 100) return mom >= 100 ? "fuehrend" : "schwaecher";
  return mom >= 100 ? "erholend" : "nachzuegler";
}

/** Punkte des Schweifs bis einschließlich Woche ``end`` (Index in weeks), höchstens ``len`` Wochen. */
export function tail(m: RotMember, end: number, len: number): { i: number; trend: number; mom: number }[] {
  const out: { i: number; trend: number; mom: number }[] = [];
  for (let i = Math.max(0, end - len + 1); i <= end; i++) {
    const t = m.trend[i];
    const v = m.momentum[i];
    if (t !== null && t !== undefined && v !== null && v !== undefined) out.push({ i, trend: t, mom: v });
  }
  return out;
}

/** Richtung des letzten Schritts in Grad (0 = rechts, 90 = oben) */
export function headingOf(pts: { trend: number; mom: number }[]): number | null {
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const deg = (Math.atan2(b.mom - a.mom, b.trend - a.trend) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function headingArrow(deg: number | null): string {
  if (deg === null) return "·";
  const arrows = ["→", "↗", "↑", "↖", "←", "↙", "↓", "↘"];
  return arrows[Math.round(deg / 45) % 8];
}

/** Symmetrische Achse um 100, die alle sichtbaren Punkte zeigt (mindestens ±1,5). */
export function axisSpan(points: number[]): number {
  const d = Math.max(1.5, ...points.map((p) => Math.abs(p - 100)));
  return Math.ceil((d + 0.3) * 2) / 2;
}

/** Rückblick in Worten: relative Entwicklung in 13 Wochen nach einem Stand im jeweiligen Feld. */
export function rotationTestText(test: RotationResult["test"]): string {
  const q = test.quadrants;
  if (!q) return "";
  const parts = QUADRANT_ORDER.map((k) => {
    const s = q[k]?.h13;
    if (!s || !s.n || s.avg === null) return `${QUADRANT_LABEL[k]}: –`;
    return `${QUADRANT_LABEL[k]} ${s.avg >= 0 ? "+" : "−"}${fmt(Math.abs(s.avg * 100), 1)} %`;
  });
  return `Rückblick, relative Entwicklung 13 Wochen nach einem Stand im Feld: ${parts.join(" · ")}`;
}

export function clockwiseText(test: RotationResult["test"]): string {
  if (test.clockwiseShare === null || test.clockwiseShare === undefined) return "";
  return `Wechsel im Uhrzeigersinn: ${fmt(test.clockwiseShare * 100, 0)} % (${test.clockwise} von ${(test.clockwise ?? 0) + (test.counter ?? 0)}). Auch Zufallskurse drehen überwiegend im Uhrzeigersinn – aussagekräftig ist nur, ob die Felder danach unterschiedlich liefen.`;
}
