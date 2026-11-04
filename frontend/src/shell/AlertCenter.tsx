// Meldet ausgelöste Kursalarme: Hinweis unten rechts, Ton und (falls erlaubt) Desktop-Benachrichtigung.
// Welche Auslösungen schon gemeldet wurden, teilen sich alle Terminal-Fenster.

import { useEffect, useState } from "react";
import { beep, readSeen, takeNewEvents, useAlerts, writeSeen, type AlertEvent } from "../lib/alerts";
import { fmtTime } from "../lib/format";
import { useWorkspace } from "../state/workspace";

export const SOUND_KEY = "mt.pref.v1.alerts.sound";

function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "false";
  } catch {
    return true;
  }
}

export function AlertCenter() {
  const q = useAlerts();
  const ws = useWorkspace();
  const [toasts, setToasts] = useState<AlertEvent[]>([]);

  useEffect(() => {
    if (!q.data) return;
    const { fresh, seen } = takeNewEvents(q.data.events, readSeen());
    writeSeen(seen);
    if (!fresh.length) return;
    setToasts((t) => [...fresh, ...t.filter((x) => !fresh.some((f) => f.id === x.id))].slice(0, 5));
    // nach einer Minute ausblenden (bleibt im Protokoll in ALRT und im Zähler der Statusleiste);
    // vorher verdeckten stehengebliebene Hinweise die Tabelle
    const ids = new Set(fresh.map((f) => f.id));
    window.setTimeout(() => setToasts((t) => t.filter((x) => !ids.has(x.id))), 60_000);
    if (soundOn()) beep();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const e of fresh.slice(0, 3)) {
        try {
          new Notification("Kursalarm", { body: e.message, tag: e.id });
        } catch {
          /* manche Browser erlauben Benachrichtigungen nur über einen Service Worker */
        }
      }
    }
  }, [q.data]);

  if (!toasts.length) return null;
  const dismiss = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((e) => (
        <div key={e.id} className="toast" role="alert">
          <span className="toast-bell" aria-hidden="true">🔔</span>
          <div style={{ minWidth: 0 }}>
            <div className="toast-msg">{e.message}</div>
            <div className="xs muted">Kursalarm · {fmtTime(e.at)}</div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              ws.setSecurity(e.ticker, { open: "GP" });
              dismiss(e.id);
            }}
          >
            Chart
          </button>
          <button type="button" className="tool" aria-label="Hinweis schließen" onClick={() => dismiss(e.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
