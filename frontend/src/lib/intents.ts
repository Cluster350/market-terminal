// Aufträge an andere Panels: „zeige Land X“ (z. B. aus der Weltkarte oder aus dem Befehl „IT GC“).
// Ein Panel, das gerade nicht offen ist, übernimmt den jüngsten Auftrag beim Öffnen (bis 10 s alt).

import { useEffect, useRef } from "react";
import type { FnCode } from "./commands";

export interface Intent {
  /** Land: Kürzel der Zinskurven (US, DE, UK, FR, IT, JP), des Kalenders (EU, GB …) oder ISO3 (DEU) */
  country?: string;
  /** Kennzahl, z. B. inflation_consumer_prices_annual (ECST) */
  indicator?: string;
}

type Entry = { id: number; at: number; value: Intent };
const last = new Map<string, Entry>();
const listeners = new Map<string, Set<(e: Entry) => void>>();
let seq = 0;

export function sendIntent(fn: FnCode, value: Intent) {
  const e: Entry = { id: ++seq, at: Date.now(), value };
  last.set(fn, e);
  for (const l of listeners.get(fn) ?? []) l(e);
}

/** Aufträge für eine Funktion empfangen (jeder Auftrag wird je Panel einmal angewendet). */
export function useIntent(fn: FnCode, handler: (v: Intent) => void) {
  const applied = useRef(0);
  const h = useRef(handler);
  h.current = handler;
  useEffect(() => {
    const apply = (e: Entry) => {
      if (e.id <= applied.current) return;
      applied.current = e.id;
      h.current(e.value);
    };
    const pending = last.get(fn);
    if (pending && Date.now() - pending.at < 10_000) apply(pending);
    const set = listeners.get(fn) ?? new Set();
    set.add(apply);
    listeners.set(fn, set);
    return () => {
      set.delete(apply);
    };
  }, [fn]);
}

// --- Länderkürzel ---------------------------------------------------------------------------

/** Kürzel der Zinskurven (GC, FWD) */
export const CURVE_COUNTRIES = ["US", "DE", "UK", "FR", "IT", "JP"] as const;

const ALIASES: Record<string, string> = {
  US: "US", USA: "US", AMERIKA: "US", DE: "DE", GER: "DE", DEU: "DE", DEUTSCHLAND: "DE", BUND: "DE",
  UK: "UK", GB: "UK", GBR: "UK", ENGLAND: "UK", FR: "FR", FRA: "FR", FRANKREICH: "FR", IT: "IT", ITA: "IT",
  ITALIEN: "IT", JP: "JP", JPN: "JP", JAPAN: "JP", ES: "ES", ESP: "ES", SPANIEN: "ES", CH: "CH", CHE: "CH",
  SCHWEIZ: "CH", EU: "EU", EZ: "EU", EURO: "EU", CN: "CN", CHN: "CN", CHINA: "CN",
};

/** Länderargument eines Befehls (IT, ITA, Italien …) -> Kürzel, sonst null */
export function countryCode(token: string): string | null {
  return ALIASES[token.trim().toUpperCase()] ?? null;
}

/** Kürzel -> ISO3 (Weltkarte, ECST) */
export const ISO3: Record<string, string> = { US: "USA", DE: "DEU", UK: "GBR", FR: "FRA", IT: "ITA", JP: "JPN", ES: "ESP", CH: "CHE", CN: "CHN" };
