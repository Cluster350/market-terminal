// Signal für wichtige Nachrichten: Welche Meldungen klingeln (Eilmeldungen, kursrelevant laut KI),
// für welche Werte (Watchlist und Depot oder alle) und welche schon gemeldet wurden.

import type { NewsInsight } from "./ai";
import type { NewsItem } from "./types";

export type SignalMode = "off" | "urgent" | "important";
export type SignalScope = "mine" | "all";

export interface SignalSettings {
  mode: SignalMode;
  scope: SignalScope;
  sound: boolean;
}

export const SIGNAL_KEY = "mt.pref.v1.news.signal";
export const DEFAULT_SIGNAL: SignalSettings = { mode: "urgent", scope: "mine", sound: true };
export const SIGNAL_EVENT = "mt-news-signal"; // TOP meldet geänderte Einstellungen im selben Fenster

export const isSignalSettings = (x: unknown): x is SignalSettings =>
  !!x &&
  typeof x === "object" &&
  ["off", "urgent", "important"].includes((x as SignalSettings).mode) &&
  ["mine", "all"].includes((x as SignalSettings).scope) &&
  typeof (x as SignalSettings).sound === "boolean";

/** Einstellungen frisch aus dem Speicher (TOP ändert sie, der Signalgeber liest sie bei jedem Abruf). */
export function readSignalSettings(): SignalSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SIGNAL_KEY) || "null");
    return isSignalSettings(raw) ? raw : DEFAULT_SIGNAL;
  } catch {
    return DEFAULT_SIGNAL;
  }
}

/** Betrifft die Meldung einen eigenen Wert (Watchlist oder Depot)? */
export function concernsMine(n: NewsItem, mine: Set<string>): boolean {
  return n.symbols.some((s) => mine.has(s));
}

export type Verdict = "signal" | "skip" | "wait";

/**
 * Entscheidung je Meldung: Eilmeldungen sofort; im Modus „wichtig“ zusätzlich Meldungen mit
 * KI-Relevanz ab 2 („kursrelevant“). Ohne Einordnung wird bis zu `maxWaitMs` gewartet.
 */
export function judge(
  n: NewsItem,
  s: SignalSettings,
  mine: Set<string>,
  insight: NewsInsight | undefined,
  aiOn: boolean,
  waitedMs: number,
  maxWaitMs = 180_000, // lokale KI braucht bei voller Warteschlange etwas; Hintergrund-Tabs fragen seltener
): Verdict {
  if (s.mode === "off") return "skip";
  if (s.scope === "mine" && !concernsMine(n, mine)) return "skip";
  if (n.urgent) return "signal";
  if (s.mode !== "important" || !aiOn) return "skip";
  if (insight) return insight.relevance >= 2 ? "signal" : "skip";
  return waitedMs < maxWaitMs ? "wait" : "skip";
}

export const FRESH_MS = 30 * 60_000; // ältere Meldungen klingeln nicht (z. B. nach dem Umschalten auf „alle“)

export interface Sorted {
  seen: Set<string>; // neue Liste der erledigten Meldungen
  signals: NewsItem[]; // jetzt melden
  wait: NewsItem[]; // warten auf die KI-Einordnung
}

/**
 * Neue Meldungen eines Abrufs einordnen. Beim allerersten Start (`seen` = null) gilt alles als
 * bekannt – keine Flut alter Hinweise. `firstSeen` merkt sich, seit wann eine Meldung wartet.
 */
export function sortNews(
  items: NewsItem[],
  seen: Set<string> | null,
  s: SignalSettings,
  mine: Set<string>,
  insights: Record<string, NewsInsight> | undefined,
  aiOn: boolean,
  now: number,
  firstSeen: Map<string, number>,
): Sorted {
  if (seen === null) return { seen: new Set(items.map((n) => n.id)), signals: [], wait: [] };
  const next = new Set(seen);
  const signals: NewsItem[] = [];
  const wait: NewsItem[] = [];
  for (const n of items) {
    if (seen.has(n.id)) continue;
    const at = Date.parse(n.date);
    if (!Number.isFinite(at) || now - at > FRESH_MS) {
      next.add(n.id);
      continue;
    }
    const first = firstSeen.get(n.id) ?? now;
    firstSeen.set(n.id, first);
    const v = judge(n, s, mine, insights?.[n.id], aiOn, now - first);
    if (v === "wait") {
      wait.push(n);
      continue;
    }
    next.add(n.id);
    firstSeen.delete(n.id);
    if (v === "signal") signals.push(n);
  }
  return { seen: next, signals, wait };
}

// --- Bereits gemeldete Meldungen (fensterübergreifend, damit nur ein Fenster klingelt) ------------

const SEEN_KEY = "mt.news.seen.v1";
let memSeen: Set<string> | null = null;

export function readNewsSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw !== null) return new Set(JSON.parse(raw) as string[]);
    return memSeen;
  } catch {
    return memSeen;
  }
}

export function writeNewsSeen(ids: Iterable<string>) {
  memSeen = new Set(Array.from(ids).slice(-500));
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(memSeen)));
  } catch {
    /* ohne Speicher gilt die Liste im Speicher */
  }
}
