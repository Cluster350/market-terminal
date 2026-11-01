// Zurücksetzen auf den Auslieferungszustand. Alles, was das Terminal speichert, liegt im
// Browser unter Schlüsseln mit "mt."; die Ansicht lässt sich ohne Watchlist zurücksetzen.

export type ResetScope = "view" | "all";

/** Gespeicherte Einstellungen entfernen. "view": Layouts, Panels, Chart- und Filtereinstellungen;
 * "all": zusätzlich Watchlist, gespeicherte Screens, Befehlsverlauf und gelesene Meldungen. */
export function clearSaved(scope: ResetScope, storage: Pick<Storage, "length" | "key" | "removeItem">): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) keys.push(k);
  }
  const view = (k: string) => k.startsWith("mt.pref.") || k.startsWith("mt.win.") || k === "mt.workspace.v1";
  const removed = keys.filter((k) => k.startsWith("mt.") && (scope === "all" || view(k)));
  removed.forEach((k) => storage.removeItem(k));
  return removed;
}

/** Zurücksetzen und neu laden, damit alle Panels mit den Standardwerten starten. */
export function resetAndReload(scope: ResetScope): void {
  try {
    clearSaved(scope, localStorage);
  } catch {
    /* ohne Speicher gibt es nichts zurückzusetzen */
  }
  location.reload();
}
