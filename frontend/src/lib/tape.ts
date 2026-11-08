// Laufband oben (Indizes und Watchlist) je Fenster ein- oder ausblenden. Gespeichert je Fenster-Kennung
// (Hauptfenster, #makro, #solo-GP …), damit z. B. der zweite Monitor ohne Laufband bleibt.

import { useSyncExternalStore } from "react";

const key = (win: string) => `mt.pref.v1.tape.${win}`;
const mem = new Map<string, boolean>(); // falls der Browser keinen Speicher erlaubt
const subs = new Set<() => void>();

export function tapeVisible(win: string): boolean {
  try {
    const raw = localStorage.getItem(key(win));
    if (raw !== null) return raw !== "false";
  } catch {
    /* ohne Speicher: Wert im Arbeitsspeicher */
  }
  return mem.get(win) ?? true;
}

export function setTapeVisible(win: string, visible: boolean) {
  mem.set(win, visible);
  try {
    localStorage.setItem(key(win), JSON.stringify(visible));
  } catch {
    /* nur für diese Sitzung */
  }
  subs.forEach((f) => f());
}

export function useTapeVisible(win: string): [boolean, (v: boolean) => void] {
  const visible = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => tapeVisible(win),
  );
  return [visible, (v: boolean) => setTapeVisible(win, v)];
}
