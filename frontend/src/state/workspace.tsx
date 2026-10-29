// Arbeitsbereich: Seiten, Panels, aktives Wertpapier, Watchlist. Wird lokal gespeichert.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { FN, type FnCode } from "../lib/commands";

export type PageId = "equity" | "macro" | "screener" | "news";
export type Layout = "quad" | "wide" | "split" | "single";

export interface PageDef {
  id: PageId;
  label: string;
  key: string;
  layout: Layout;
  panels: FnCode[];
}

export const PAGES: PageDef[] = [
  { id: "equity", label: "AKTIE", key: "1", layout: "quad", panels: ["GP", "DES", "FA", "CN"] },
  { id: "macro", label: "MAKRO", key: "2", layout: "quad", panels: ["WEI", "GC", "ECO", "FX"] },
  { id: "screener", label: "SCREENER", key: "3", layout: "wide", panels: ["EQS", "IMAP", "MOST"] },
  { id: "news", label: "NEWS", key: "4", layout: "split", panels: ["TOP", "W"] },
];

const PAGE_DEFAULTS = Object.fromEntries(PAGES.map((p) => [p.id, { layout: p.layout, panels: [...p.panels] }])) as Record<
  PageId,
  { layout: Layout; panels: FnCode[] }
>;

export interface WorkspaceState {
  version: 1;
  mode: string | null;
  page: PageId;
  pages: Record<PageId, { layout: Layout; panels: FnCode[] }>;
  active: Record<PageId, number>;
  maximized: number | null;
  security: string | null;
  watchlist: string[];
  recent: string[];
}

type Action =
  | { type: "page"; page: PageId }
  | { type: "security"; ticker: string }
  | { type: "fn"; fn: FnCode; panel?: number }
  | { type: "active"; index: number }
  | { type: "maximize"; index: number | null }
  | { type: "resetPage" }
  | { type: "watchAdd"; ticker: string }
  | { type: "watchRemove"; ticker: string }
  | { type: "watchMove"; ticker: string; delta: number }
  | { type: "init"; mode: string; watchlist: string[] };

const STORAGE_KEY = "mt.workspace.v1";

function initial(): WorkspaceState {
  const base: WorkspaceState = {
    version: 1,
    mode: null,
    page: "equity",
    pages: structuredClone(PAGE_DEFAULTS),
    active: { equity: 0, macro: 0, screener: 0, news: 0 },
    maximized: null,
    security: null,
    watchlist: [],
    recent: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<WorkspaceState>;
    if (saved.version !== 1) return base;
    const pages = { ...base.pages };
    for (const p of PAGES) {
      const sp = saved.pages?.[p.id];
      if (sp && Array.isArray(sp.panels) && sp.panels.every((f) => f in FN) && sp.panels.length === pages[p.id].panels.length) {
        pages[p.id] = { layout: pages[p.id].layout, panels: sp.panels };
      }
    }
    return {
      ...base,
      mode: typeof saved.mode === "string" ? saved.mode : null,
      page: PAGES.some((p) => p.id === saved.page) ? (saved.page as PageId) : "equity",
      pages,
      security: typeof saved.security === "string" ? saved.security : null,
      watchlist: Array.isArray(saved.watchlist) ? saved.watchlist.filter((t) => typeof t === "string").slice(0, 60) : [],
      recent: Array.isArray(saved.recent) ? saved.recent.filter((t) => typeof t === "string").slice(0, 12) : [],
    };
  } catch {
    return base;
  }
}

function reducer(s: WorkspaceState, a: Action): WorkspaceState {
  switch (a.type) {
    case "init": {
      // Neuer Datenmodus (z. B. Demo -> EODHD): Ticker des alten Modus verwerfen
      if (s.mode === a.mode && s.security && s.watchlist.length) return s;
      return { ...s, mode: a.mode, security: a.watchlist[0] ?? null, watchlist: a.watchlist, recent: [] };
    }
    case "page":
      return { ...s, page: a.page, maximized: null };
    case "security": {
      const recent = [a.ticker, ...s.recent.filter((t) => t !== a.ticker)].slice(0, 12);
      return { ...s, security: a.ticker, recent };
    }
    case "fn": {
      const idx = a.panel ?? s.active[s.page];
      const page = s.pages[s.page];
      const panels = page.panels.slice();
      if (idx < 0 || idx >= panels.length) return s;
      panels[idx] = a.fn;
      return { ...s, pages: { ...s.pages, [s.page]: { ...page, panels } }, active: { ...s.active, [s.page]: idx } };
    }
    case "active":
      return { ...s, active: { ...s.active, [s.page]: a.index } };
    case "maximize":
      return { ...s, maximized: a.index };
    case "resetPage":
      return { ...s, pages: { ...s.pages, [s.page]: structuredClone(PAGE_DEFAULTS[s.page]) }, maximized: null };
    case "watchAdd":
      if (s.watchlist.includes(a.ticker)) return s;
      return { ...s, watchlist: [...s.watchlist, a.ticker].slice(0, 60) };
    case "watchRemove":
      return { ...s, watchlist: s.watchlist.filter((t) => t !== a.ticker) };
    case "watchMove": {
      const i = s.watchlist.indexOf(a.ticker);
      const j = i + a.delta;
      if (i < 0 || j < 0 || j >= s.watchlist.length) return s;
      const w = s.watchlist.slice();
      [w[i], w[j]] = [w[j], w[i]];
      return { ...s, watchlist: w };
    }
  }
}

interface WorkspaceApi {
  state: WorkspaceState;
  setPage: (p: PageId) => void;
  setSecurity: (t: string, opts?: { open?: FnCode }) => void;
  runFn: (fn: FnCode, ticker?: string | null) => void;
  setActive: (i: number) => void;
  maximize: (i: number | null) => void;
  resetPage: () => void;
  watchAdd: (t: string) => void;
  watchRemove: (t: string) => void;
  watchMove: (t: string, delta: number) => void;
  init: (mode: string, watchlist: string[]) => void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* Speicher nicht verfügbar: Arbeitsbereich gilt nur für diese Sitzung */
    }
  }, [state]);

  const setSecurity = useCallback(
    (t: string, opts?: { open?: FnCode }) => {
      dispatch({ type: "security", ticker: t });
      const pageHasTickerPanel = state.pages[state.page].panels.some((f) => FN[f].needsTicker);
      if (opts?.open) {
        if (!pageHasTickerPanel && FN[opts.open].needsTicker) dispatch({ type: "page", page: "equity" });
        dispatch({ type: "fn", fn: opts.open });
      } else if (!pageHasTickerPanel) {
        dispatch({ type: "page", page: "equity" });
      }
    },
    [state.page, state.pages],
  );

  const api = useMemo<WorkspaceApi>(
    () => ({
      state,
      setPage: (page) => dispatch({ type: "page", page }),
      setSecurity,
      runFn: (fn, ticker) => {
        if (ticker) dispatch({ type: "security", ticker });
        dispatch({ type: "fn", fn });
      },
      setActive: (index) => dispatch({ type: "active", index }),
      maximize: (index) => dispatch({ type: "maximize", index }),
      resetPage: () => dispatch({ type: "resetPage" }),
      watchAdd: (ticker) => dispatch({ type: "watchAdd", ticker }),
      watchRemove: (ticker) => dispatch({ type: "watchRemove", ticker }),
      watchMove: (ticker, delta) => dispatch({ type: "watchMove", ticker, delta }),
      init: (mode, watchlist) => dispatch({ type: "init", mode, watchlist }),
    }),
    [state, setSecurity],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("WorkspaceProvider fehlt");
  return ctx;
}
