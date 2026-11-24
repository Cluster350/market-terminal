// Fernsteuerung (Stream Deck): Aufträge vom eigenen Rechner (POST /api/remote) kommen über einen Ereignis-Strom an
// und werden im zuletzt benutzten Terminal-Fenster ausgeführt – genau wie ein Befehl in der Befehlszeile.

import { useEffect, useRef } from "react";
import { IS_STATIC, request } from "./api";
import type { PageId } from "../state/workspace";

export interface RemoteEvent {
  id: number;
  target: string;
  command?: string;
  page?: PageId;
  maximize?: boolean;
}

export const PAGE_IDS: PageId[] = ["equity", "macro", "screener", "news", "depot"];

/** Gilt der Auftrag diesem Fenster? Ohne gemeldetes Fenster nimmt ihn das Hauptfenster. */
export const isForWindow = (ev: RemoteEvent, win: string) => (ev.target || "main") === win;

export function parseRemote(raw: string): RemoteEvent | null {
  try {
    const ev = JSON.parse(raw) as RemoteEvent;
    if (typeof ev !== "object" || ev === null || typeof ev.id !== "number") return null;
    if (ev.page !== undefined && !PAGE_IDS.includes(ev.page)) return null;
    if (ev.command !== undefined && (typeof ev.command !== "string" || ev.command.length > 80)) return null;
    return ev;
  } catch {
    return null;
  }
}

export interface RemoteHandlers {
  command: (text: string) => void;
  page: (p: PageId) => void;
  maximize: () => void;
}

export function useRemoteControl(win: string, handlers: RemoteHandlers) {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    if (IS_STATIC || typeof EventSource === "undefined") return;
    // Dieses Fenster als „zuletzt benutzt“ melden, sobald es den Fokus bekommt
    const report = () =>
      void request("/remote/active", { method: "POST", body: JSON.stringify({ window: win }), headers: { "Content-Type": "application/json" } }).catch(() => {});
    if (document.hasFocus()) report();
    window.addEventListener("focus", report);
    const es = new EventSource("/api/remote/events");
    es.addEventListener("hello", () => {
      if (document.hasFocus()) report(); // nach einem Neustart des Servers wieder anmelden
    });
    es.onmessage = (m) => {
      const ev = parseRemote(m.data);
      if (!ev || !isForWindow(ev, win)) return;
      if (ev.command) h.current.command(ev.command);
      else if (ev.page) h.current.page(ev.page);
      else if (ev.maximize !== undefined) h.current.maximize();
    };
    return () => {
      window.removeEventListener("focus", report);
      es.close();
    };
  }, [win]);
}
