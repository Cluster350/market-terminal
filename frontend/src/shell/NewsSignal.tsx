// Signal für wichtige Nachrichten: eigener Ton, Hinweis mit „Lesen“ und – wenn das Terminal im
// Hintergrund liegt und erlaubt – eine Desktop-Benachrichtigung. Einstellungen in TOP.
// Welche Meldungen schon gemeldet wurden, teilen sich alle Terminal-Fenster (nur eines klingelt).

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiAvailable, useAiStatus, useNewsInsights } from "../lib/ai";
import { api, IS_STATIC } from "../lib/api";
import { displayTicker, fmtTime } from "../lib/format";
import { sendIntent } from "../lib/intents";
import { isSignalSettings, readNewsSeen, readSignalSettings, SIGNAL_EVENT, SIGNAL_KEY, sortNews, writeNewsSeen } from "../lib/newsSignal";
import { usePortfolio } from "../lib/portfolio";
import { newsTone } from "../lib/sound";
import { pushToast } from "../lib/toasts";
import type { NewsItem } from "../lib/types";
import { useWorkspace } from "../state/workspace";

export function NewsSignal() {
  const ws = useWorkspace();
  const [settings, setSettings] = useState(readSignalSettings);
  useEffect(() => {
    const fromTop = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      setSettings(isSignalSettings(d) ? d : readSignalSettings());
    };
    const fromOther = (e: StorageEvent) => {
      if (e.key === null || e.key === SIGNAL_KEY) setSettings(readSignalSettings()); // Änderung in einem anderen Fenster
    };
    window.addEventListener(SIGNAL_EVENT, fromTop);
    window.addEventListener("storage", fromOther);
    return () => {
      window.removeEventListener(SIGNAL_EVENT, fromTop);
      window.removeEventListener("storage", fromOther);
    };
  }, []);

  const portfolio = usePortfolio();
  const mine = useMemo(
    () => new Set([...ws.state.watchlist, ...(portfolio.data?.positions ?? []).map((p) => p.ticker)]),
    [ws.state.watchlist, portfolio.data],
  );
  const on = settings.mode !== "off" && !IS_STATIC;
  const tickers = settings.scope === "mine" ? Array.from(mine).slice(0, 30) : undefined;
  const params = { tickers, limit: 40 };
  // eigene Abfrage, die auch im Hintergrund-Tab weiterläuft (sonst käme keine Desktop-Benachrichtigung)
  const q = useQuery({
    queryKey: ["news-signal", params],
    queryFn: () => api.news(params),
    enabled: on && (settings.scope === "all" || mine.size > 0),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const status = useAiStatus();
  const aiOn = aiAvailable(status.data);
  const firstSeen = useRef(new Map<string, number>());
  const [waiting, setWaiting] = useState<NewsItem[]>([]);
  // Einordnung nur für Meldungen, die auf die KI warten (Modus „wichtig“)
  const ins = useNewsInsights(settings.mode === "important" ? waiting : [], "normal", status.data, true);

  useEffect(() => {
    const items = q.data?.items;
    if (!on || !items) return;
    const r = sortNews(items, readNewsSeen(), settings, mine, ins.data?.insights, aiOn, Date.now(), firstSeen.current);
    writeNewsSeen(r.seen);
    const wait = r.wait;
    const signals = r.signals;
    setWaiting((w) => (w.map((x) => x.id).join() === wait.map((x) => x.id).join() ? w : wait));
    if (!signals.length) return;

    const urgent = signals.some((n) => n.urgent);
    if (settings.sound) newsTone(urgent);
    for (const n of signals.slice(0, 3).reverse()) {
      const sym = n.symbols.find((s) => mine.has(s)) ?? n.symbols[0];
      const rel = ins.data?.insights[n.id];
      pushToast(
        {
          id: `news-${n.id}`,
          kind: n.urgent ? "urgent" : "news",
          icon: n.urgent ? "⚡" : "📰",
          message: `${sym ? `${displayTicker(sym)}: ` : ""}${n.title}`,
          meta: `${n.urgent ? "Eilmeldung" : `Kursrelevant laut KI${rel ? ` (${rel.relevance}/3)` : ""}`}${sym && mine.has(sym) ? " · eigener Wert" : ""} · ${fmtTime(n.date)}`,
          action: {
            label: "Lesen",
            run: () => {
              sendIntent("TOP", { newsId: n.id, news: n });
              ws.openFn("TOP");
            },
          },
        },
        90_000,
      );
    }
    if (typeof document !== "undefined" && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const n of signals.slice(0, 2)) {
        try {
          new Notification(n.urgent ? "Eilmeldung" : "Wichtige Meldung", { body: n.title, tag: `news-${n.id}` });
        } catch {
          /* manche Browser erlauben Benachrichtigungen nur über einen Service Worker */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, ins.data, settings, aiOn]);

  return null;
}
