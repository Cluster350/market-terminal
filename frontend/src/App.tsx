import { useEffect, useState } from "react";
import { useStatus } from "./lib/queries";
import { PanelGrid, StatusBar, TickerTape, TopBar } from "./shell/Shell";
import { FOCUS_EVENT } from "./shell/CommandLine";
import { LAYOUTS, PAGES, useWorkspace } from "./state/workspace";
import { Boot, shouldBoot } from "./shell/Boot";
import { isTextEntry } from "./lib/keys";
import { AlertCenter } from "./shell/AlertCenter";
import { useLiveQuotesBridge } from "./lib/realtime";

export default function App() {
  const ws = useWorkspace();
  const status = useStatus();
  useLiveQuotesBridge(); // Echtzeit-Kurse in alle Kursanzeigen dieses Fensters
  const [booting, setBooting] = useState(shouldBoot);

  // Standard-Watchlist und Wertpapier passend zum Datenmodus setzen
  useEffect(() => {
    if (status.data) ws.init(status.data.mode, status.data.defaults.watchlist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = isTextEntry(target);
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const page = PAGES.find((p) => p.key === e.key || e.code === `Digit${p.key}`);
        if (page) {
          e.preventDefault();
          ws.setPage(page.id);
          return;
        }
        const count = ws.state.pages[ws.state.page].panels.length;
        const cur = ws.state.active[ws.state.page];
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          ws.setActive((cur + (e.key === "ArrowRight" ? 1 : count - 1)) % count);
          return;
        }
        if (e.code === "KeyL") {
          e.preventDefault();
          const cur = LAYOUTS.findIndex((l) => l.value === ws.state.pages[ws.state.page].layout);
          ws.setLayout(LAYOUTS[(cur + 1) % LAYOUTS.length].value);
          return;
        }
        if (e.code === "KeyM") {
          e.preventDefault();
          ws.maximize(ws.state.maximized === null ? cur : null);
          return;
        }
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      // Auswahlfelder, Checkboxen usw. behalten nach einem Klick den Fokus. Getippte Befehle
      // gehören trotzdem in die Befehlszeile – sonst springt die Tippsuche eines Auswahlfelds
      // auf eine andere Funktion. Pfeiltasten bleiben beim Feld.
      const widget = target !== document.body && target.tagName !== "BUTTON";
      if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
      } else if (e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) {
        if (widget) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: e.key }));
        } else {
          // Fokus noch während keydown setzen: der Browser schreibt das Zeichen dann selbst ins Feld
          window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
        }
      } else if (e.key === "Escape") {
        // Esc: Feld verlassen, Maximieren beenden, sonst im aktiven Panel zurück (z. B. nach HELP)
        if (widget) target.blur();
        if (ws.state.maximized !== null) ws.maximize(null);
        else if (!widget) ws.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  return (
    <div className="app">
      {booting && <Boot onDone={() => setBooting(false)} />}
      <TopBar />
      <TickerTape />
      <PanelGrid />
      <StatusBar />
      <AlertCenter />
    </div>
  );
}
