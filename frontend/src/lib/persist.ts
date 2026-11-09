// Einstellungen, die einen Seiten- oder Tickerwechsel und das Neuladen überstehen sollen.

import { useEffect, useState } from "react";

const PREFIX = "mt.pref.v1.";

/** Gespeicherten Wert lesen (z. B. um eine ältere Einstellung in eine neue zu übernehmen). */
export function readPersistent<T>(key: string, fallback: T, valid: (x: unknown) => x is T): T {
  return read(key, fallback, valid);
}

function read<T>(key: string, fallback: T, valid: (x: unknown) => x is T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Wie useState, aber in localStorage gespeichert (je Schlüssel, für alle Panels gleich).
 * ``valid`` prüft gespeicherte Werte – ältere oder beschädigte Einträge fallen auf den Standard zurück.
 */
export function usePersistentState<T>(key: string, fallback: T, valid: (x: unknown) => x is T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback, valid));
  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* ohne Speicher gilt die Einstellung nur bis zum Neuladen */
    }
  }, [key, value]);
  return [value, setValue];
}

export const isOneOf =
  <T extends string>(options: readonly T[]) =>
  (x: unknown): x is T =>
    typeof x === "string" && (options as readonly string[]).includes(x);

export const isBool = (x: unknown): x is boolean => typeof x === "boolean";

export const isNumberList =
  (allowed: readonly number[]) =>
  (x: unknown): x is number[] =>
    Array.isArray(x) && x.every((n) => typeof n === "number" && allowed.includes(n));

export const isStringList =
  (allowed: readonly string[], max = 10) =>
  (x: unknown): x is string[] =>
    Array.isArray(x) && x.length <= max && x.every((s) => typeof s === "string" && allowed.includes(s));
