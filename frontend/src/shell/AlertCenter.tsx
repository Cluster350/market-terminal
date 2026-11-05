// Meldet ausgelöste Kursalarme: Hinweis unten rechts, Ton und (falls erlaubt) Desktop-Benachrichtigung.
// Welche Auslösungen schon gemeldet wurden, teilen sich alle Terminal-Fenster.

import { useEffect } from "react";
import { beep, readSeen, takeNewEvents, useAlerts, writeSeen } from "../lib/alerts";
import { fmtTime } from "../lib/format";
import { pushToast } from "../lib/toasts";
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

  useEffect(() => {
    if (!q.data) return;
    const { fresh, seen } = takeNewEvents(q.data.events, readSeen());
    writeSeen(seen);
    if (!fresh.length) return;
    // nach einer Minute ausblenden (bleibt im Protokoll in ALRT und im Zähler der Statusleiste)
    for (const e of fresh.slice(0, 5).reverse()) {
      pushToast({
        id: `alert-${e.id}`,
        kind: "alert",
        icon: "🔔",
        message: e.message,
        meta: `Kursalarm · ${fmtTime(e.at)}`,
        action: { label: "Chart", run: () => ws.setSecurity(e.ticker, { open: "GP" }) },
      });
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  return null;
}
