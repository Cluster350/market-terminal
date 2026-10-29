import { useEffect } from "react";
import { useStatus } from "./lib/queries";
import { PanelGrid, StatusBar, TickerTape, TopBar } from "./shell/Shell";
import { FOCUS_EVENT } from "./shell/CommandLine";
import { PAGES, useWorkspace } from "./state/workspace";

export default function App() {
  const ws = useWorkspace();
  const status = useStatus();

  // Standard-Watchlist und Wertpapier passend zum Datenmodus setzen
  useEffect(() => {
    if (status.data) ws.init(status.data.mode, status.data.defaults.watchlist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
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
        if (e.code === "KeyM") {
          e.preventDefault();
          ws.maximize(ws.state.maximized === null ? cur : null);
          return;
        }
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
      } else if (e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) {
        // Fokus noch während keydown setzen: der Browser schreibt das Zeichen dann selbst ins Feld
        window.dispatchEvent(new CustomEvent(FOCUS_EVENT));
      } else if (e.key === "Escape" && ws.state.maximized !== null) {
        ws.maximize(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  return (
    <div className="app">
      <TopBar />
      <TickerTape />
      <PanelGrid />
      <StatusBar />
    </div>
  );
}
