// Arbeitsbereich: Seiten, Layouts, Panels, aktives Wertpapier, Watchlist.
//
// Mehrere Monitore: Jede Seite oder jede Funktion lässt sich in einem eigenen Browserfenster
// öffnen (#makro, #solo-GP …). Jedes Fenster speichert sein Layout für sich; Wertpapier,
// Watchlist und Verlauf werden über localStorage zwischen allen Fenstern geteilt
// ("storage"-Ereignis). Ein Fenster kann sich vom Wertpapier-Link lösen.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { FN, type FnCode } from "../lib/commands";

export type PageId = "equity" | "macro" | "screener" | "news" | "depot";
export type Layout = "single" | "split" | "rows" | "wide" | "quad";

export const LAYOUT_SLOTS: Record<Layout, number> = { single: 1, split: 2, rows: 2, wide: 3, quad: 4 };
export const LAYOUTS: { value: Layout; label: string; title: string }[] = [
  { value: "single", label: "1", title: "Ein Panel" },
  { value: "split", label: "2│", title: "Zwei Panels nebeneinander" },
  { value: "rows", label: "2─", title: "Zwei Panels untereinander" },
  { value: "wide", label: "3", title: "Ein breites Panel oben, zwei unten" },
  { value: "quad", label: "4", title: "Vier Panels" },
];

export interface PageDef {
  id: PageId;
  label: string;
  key: string;
  hash: string;
  layout: Layout;
  panels: FnCode[];
  /** Reihenfolge, in der weitere Panels aufgefüllt werden, wenn das Layout wächst */
  pool: FnCode[];
}

export const PAGES: PageDef[] = [
  { id: "equity", label: "AKTIE", key: "1", hash: "aktie", layout: "quad", panels: ["GP", "DES", "FA", "CN"], pool: ["GP", "DES", "FA", "CN", "RV", "ERN", "HP", "ANR", "DVD", "TPO", "ALRT"] },
  { id: "macro", label: "MAKRO", key: "2", hash: "makro", layout: "quad", panels: ["WMAP", "WEI", "GC", "ECO"], pool: ["WMAP", "WEI", "GC", "ECO", "FX", "FWD", "SPRD", "CMDT", "ECST"] },
  { id: "screener", label: "SCREENER", key: "3", hash: "screener", layout: "wide", panels: ["EQS", "IMAP", "MOST"], pool: ["EQS", "IMAP", "MOST", "W"] },
  { id: "news", label: "NEWS", key: "4", hash: "news", layout: "wide", panels: ["TOP", "BRIEF", "ASK"], pool: ["TOP", "BRIEF", "ASK", "W", "EVTS", "ECO"] },
  { id: "depot", label: "DEPOT", key: "5", hash: "depot", layout: "rows", panels: ["PORT", "RISK"], pool: ["PORT", "RISK", "ALRT", "GP", "CN", "W"] },
];

const PAGE_BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<PageId, PageDef>;

const PAGE_DEFAULTS = Object.fromEntries(PAGES.map((p) => [p.id, { layout: p.layout, panels: [...p.panels] }])) as Record<
  PageId,
  { layout: Layout; panels: FnCode[] }
>;

/** Seite, auf die eine Funktion fachlich gehört (für Einzelfenster). */
export function pageForFn(fn: FnCode): PageId {
  switch (FN[fn].group) {
    case "Aktie":
      return "equity";
    case "Makro":
      return "macro";
    case "Screener":
      return "screener";
    case "Depot":
      return "depot";
    default:
      return "news";
  }
}

export interface WorkspaceState {
  version: 1;
  window: string;
  mode: string | null;
  page: PageId;
  pages: Record<PageId, { layout: Layout; panels: FnCode[] }>;
  active: Record<PageId, number>;
  maximized: number | null;
  linked: boolean;
  security: string | null;
  watchlist: string[];
  recent: string[];
  /** Fixierte Panels: eigenes Wertpapier je Panel (null = folgt dem Arbeitsbereich) */
  pins: Record<PageId, (string | null)[]>;
  /** Vorherige Funktionen je Panel für "Zurück" (Esc); wird nicht gespeichert */
  back: Record<PageId, FnCode[][]>;
}

interface Shared {
  mode: string | null;
  security: string | null;
  watchlist: string[];
  recent: string[];
}

type Action =
  | { type: "page"; page: PageId }
  | { type: "security"; ticker: string; viaCommand?: boolean }
  | { type: "pin"; panel: number; ticker: string | null }
  | { type: "back" }
  | { type: "fn"; fn: FnCode; panel?: number }
  | { type: "active"; index: number }
  | { type: "maximize"; index: number | null }
  | { type: "layout"; layout: Layout }
  | { type: "resetPage" }
  | { type: "linked"; linked: boolean; security?: string | null }
  | { type: "shared"; shared: Shared }
  | { type: "watchAdd"; ticker: string }
  | { type: "watchRemove"; ticker: string }
  | { type: "watchMove"; ticker: string; delta: number }
  | { type: "init"; mode: string; watchlist: string[] };

const LEGACY_KEY = "mt.workspace.v1";
const SHARED_KEY = "mt.shared.v1";
const winKey = (w: string) => `mt.win.v1.${w}`;

const isFn = (f: unknown): f is FnCode => typeof f === "string" && Object.prototype.hasOwnProperty.call(FN, f);
const isLayout = (l: unknown): l is Layout => typeof l === "string" && Object.prototype.hasOwnProperty.call(LAYOUT_SLOTS, l);
const strings = (x: unknown, max: number): string[] =>
  Array.isArray(x) ? x.filter((t): t is string => typeof t === "string").slice(0, max) : [];

export const isSolo = (window: string): boolean => window.startsWith("solo-");

/** Fenster-Kennung aus dem URL-Fragment: "" → main, "#makro" → makro, "#solo-GP" → solo-GP. */
export function windowFromHash(hash: string): { key: string; page?: PageId; solo?: FnCode } {
  const h = hash.replace(/^#/, "").trim();
  if (!h) return { key: "main" };
  const page = PAGES.find((p) => p.hash === h);
  if (page) return { key: h, page: page.id };
  const m = /^solo-([A-Z]{1,5})$/.exec(h);
  if (m && isFn(m[1])) return { key: h, solo: m[1] };
  return { key: "main" };
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function parseShared(raw: unknown): Shared | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    mode: typeof o.mode === "string" ? o.mode : null,
    security: typeof o.security === "string" ? o.security : null,
    watchlist: strings(o.watchlist, 60),
    recent: strings(o.recent, 12),
  };
}

export function initial(hash = typeof location !== "undefined" ? location.hash : ""): WorkspaceState {
  const win = windowFromHash(hash);
  const base: WorkspaceState = {
    version: 1,
    window: win.key,
    mode: null,
    page: win.page ?? (win.solo ? pageForFn(win.solo) : "equity"),
    pages: structuredClone(PAGE_DEFAULTS),
    active: { equity: 0, macro: 0, screener: 0, news: 0, depot: 0 },
    maximized: null,
    linked: true,
    security: null,
    watchlist: [],
    recent: [],
    pins: emptyPerPanel(PAGE_DEFAULTS, () => null),
    back: emptyPerPanel(PAGE_DEFAULTS, () => []),
  };
  if (win.solo) base.pages[base.page] = { layout: "single", panels: [win.solo] };
  base.pins = emptyPerPanel(base.pages, () => null);
  base.back = emptyPerPanel(base.pages, () => []);

  try {
    const legacy = win.key === "main" ? readJson(LEGACY_KEY) : null;
    const saved = (readJson(winKey(win.key)) ?? legacy) as Partial<WorkspaceState> | null;
    const shared = parseShared(readJson(SHARED_KEY)) ?? parseShared(legacy);
    let state = base;
    if (saved && saved.version === 1) {
      const pages = { ...base.pages };
      for (const p of PAGES) {
        const sp = saved.pages?.[p.id] as { layout?: unknown; panels?: unknown } | undefined;
        const layout = isLayout(sp?.layout) ? sp!.layout : pages[p.id].layout;
        // hasOwnProperty statt "in": "toString" o. Ä. aus manipuliertem Speicher ließe das Panel abstürzen
        if (sp && Array.isArray(sp.panels) && sp.panels.every(isFn) && sp.panels.length === LAYOUT_SLOTS[layout]) {
          pages[p.id] = { layout, panels: sp.panels as FnCode[] };
        }
      }
      // Solo-Fenster sind auf ihre Seite und ein Panel festgelegt (Seite und Layout sind dort
      // gesperrt). Ein älterer gespeicherter Zustand mit anderer Seite oder Viererlayout bliebe
      // sonst dauerhaft hängen, weil er sich im Fenster nicht mehr ändern lässt.
      if (win.solo && pages[base.page].layout !== "single") pages[base.page] = base.pages[base.page];
      const finalPages = win.solo && !readJson(winKey(win.key)) ? state.pages : pages;
      // Fixierte Panels nur übernehmen, wenn sie zum gespeicherten Layout passen
      const pins = emptyPerPanel(finalPages, () => null as string | null);
      for (const p of PAGES) {
        const sp = (saved.pins as Record<string, unknown> | undefined)?.[p.id];
        if (Array.isArray(sp) && sp.length === finalPages[p.id].panels.length) {
          pins[p.id] = sp.map((t) => (typeof t === "string" && t.length <= 40 ? t : null));
        }
      }
      state = {
        ...state,
        pins,
        back: emptyPerPanel(finalPages, () => []),
        mode: typeof saved.mode === "string" ? saved.mode : null,
        page: win.page ?? (win.solo ? base.page : PAGES.some((p) => p.id === saved.page) ? (saved.page as PageId) : state.page),
        pages: finalPages,
        linked: saved.linked !== false,
        security: typeof saved.security === "string" ? saved.security : null,
        watchlist: strings(saved.watchlist, 60),
        recent: strings(saved.recent, 12),
      };
    }
    if (shared && shared.mode) {
      state = {
        ...state,
        mode: shared.mode,
        watchlist: shared.watchlist,
        recent: shared.recent,
        security: state.linked || !state.security ? shared.security ?? state.security : state.security,
      };
    }
    return state;
  } catch {
    return base;
  }
}

function emptyPerPanel<T>(pages: Record<PageId, { panels: FnCode[] }>, make: () => T): Record<PageId, T[]> {
  return Object.fromEntries(PAGES.map((p) => [p.id, pages[p.id].panels.map(make)])) as Record<PageId, T[]>;
}

function fit<T>(xs: T[] | undefined, n: number, fill: () => T): T[] {
  const out = (xs ?? []).slice(0, n);
  while (out.length < n) out.push(fill());
  return out;
}

function resize(panels: FnCode[], layout: Layout, page: PageId): FnCode[] {
  const slots = LAYOUT_SLOTS[layout];
  const next = panels.slice(0, slots);
  for (const f of PAGE_BY_ID[page].pool) {
    if (next.length >= slots) break;
    if (!next.includes(f)) next.push(f);
  }
  while (next.length < slots) next.push("HELP");
  return next;
}

export function reducer(s: WorkspaceState, a: Action): WorkspaceState {
  switch (a.type) {
    case "init": {
      // Gleicher Datenmodus: Auswahl behalten – auch eine bewusst geleerte Watchlist
      // (früher kamen nach dem Neuladen die Standardwerte zurück und "Zuletzt" war weg)
      if (s.mode === a.mode) return s.security ? s : { ...s, security: a.watchlist[0] ?? null };
      // Neuer Datenmodus (z. B. Demo -> EODHD): Ticker des alten Modus verwerfen
      return { ...s, mode: a.mode, security: a.watchlist[0] ?? null, watchlist: a.watchlist, recent: [] };
    }
    case "shared": {
      const sh = a.shared;
      if (!sh.mode) return s;
      if (sh.mode !== s.mode) return { ...s, mode: sh.mode, security: sh.security, watchlist: sh.watchlist, recent: sh.recent };
      const security = s.linked && sh.security ? sh.security : s.security;
      if (security === s.security && sh.watchlist.join() === s.watchlist.join() && sh.recent.join() === s.recent.join()) return s;
      return { ...s, security, watchlist: sh.watchlist, recent: sh.recent };
    }
    case "page":
      // Einzelfunktions-Fenster (#solo-GP) bleiben bei ihrer Funktion
      if (isSolo(s.window)) return s;
      return { ...s, page: a.page, maximized: null };
    case "security": {
      const recent = [a.ticker, ...s.recent.filter((t) => t !== a.ticker)].slice(0, 12);
      // Befehl für ein fixiertes Panel: nur dieses Panel wechselt das Wertpapier
      const act = s.active[s.page];
      const pins = s.pins[s.page] ?? [];
      // Nur wenn das Panel ein Wertpapier zeigt: Nach einem Wechsel auf z. B. WEI bliebe der
      // (unsichtbare) Pin sonst bestehen, und der Befehl hätte sichtbar gar nichts bewirkt
      const actFn = s.pages[s.page].panels[act];
      if (a.viaCommand && pins[act] && actFn && FN[actFn].needsTicker) {
        const next = pins.slice();
        next[act] = a.ticker;
        return { ...s, recent, pins: { ...s.pins, [s.page]: next } };
      }
      return { ...s, security: a.ticker, recent };
    }
    case "pin": {
      const pins = fit(s.pins[s.page], s.pages[s.page].panels.length, () => null).slice();
      if (a.panel < 0 || a.panel >= pins.length) return s;
      pins[a.panel] = a.ticker;
      return { ...s, pins: { ...s.pins, [s.page]: pins } };
    }
    case "fn": {
      const idx = a.panel ?? s.active[s.page];
      const page = s.pages[s.page];
      const panels = page.panels.slice();
      if (idx < 0 || idx >= panels.length) return s;
      const back = fit(s.back[s.page], panels.length, () => [] as FnCode[]).map((x) => x.slice());
      if (panels[idx] !== a.fn) back[idx] = [...back[idx], panels[idx]].slice(-10);
      panels[idx] = a.fn;
      return {
        ...s,
        pages: { ...s.pages, [s.page]: { ...page, panels } },
        active: { ...s.active, [s.page]: idx },
        back: { ...s.back, [s.page]: back },
      };
    }
    case "back": {
      // Esc: vorherige Funktion des aktiven Panels (z. B. nach HELP oder einem Klick in EVTS)
      const idx = s.active[s.page];
      const stack = s.back[s.page]?.[idx] ?? [];
      if (!stack.length) return s;
      const page = s.pages[s.page];
      const panels = page.panels.slice();
      panels[idx] = stack[stack.length - 1];
      const back = s.back[s.page].map((x, i) => (i === idx ? x.slice(0, -1) : x));
      return { ...s, pages: { ...s.pages, [s.page]: { ...page, panels } }, back: { ...s.back, [s.page]: back } };
    }
    case "active": {
      const n = s.pages[s.page].panels.length;
      if (a.index < 0 || a.index >= n) return s;
      return { ...s, active: { ...s.active, [s.page]: a.index } };
    }
    case "maximize":
      return { ...s, maximized: a.index };
    case "layout": {
      const page = s.pages[s.page];
      if (page.layout === a.layout || isSolo(s.window)) return s;
      const panels = resize(page.panels, a.layout, s.page);
      return {
        ...s,
        pages: { ...s.pages, [s.page]: { layout: a.layout, panels } },
        pins: { ...s.pins, [s.page]: fit(s.pins[s.page], panels.length, () => null) },
        back: { ...s.back, [s.page]: fit(s.back[s.page], panels.length, () => []) },
        active: { ...s.active, [s.page]: Math.min(s.active[s.page], panels.length - 1) },
        maximized: null,
      };
    }
    case "resetPage":
      // Einzelfunktions-Fenster haben keine Seite mit mehreren Panels
      if (isSolo(s.window)) return s;
      return {
        ...s,
        pages: { ...s.pages, [s.page]: structuredClone(PAGE_DEFAULTS[s.page]) },
        pins: { ...s.pins, [s.page]: PAGE_DEFAULTS[s.page].panels.map(() => null) },
        back: { ...s.back, [s.page]: PAGE_DEFAULTS[s.page].panels.map(() => []) },
        active: { ...s.active, [s.page]: 0 },
        maximized: null,
      };
    case "linked":
      // Wieder verknüpfen übernimmt das Wertpapier der anderen Fenster (statt es ihnen aufzudrücken)
      return { ...s, linked: a.linked, security: a.linked && a.security ? a.security : s.security };
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

/** Öffnet eine Seite oder eine einzelne Funktion in einem neuen Fenster (für weitere Monitore). */
export function openWindow(target: { page?: PageId; fn?: FnCode }): boolean {
  const hash = target.fn ? `solo-${target.fn}` : PAGE_BY_ID[target.page ?? "equity"].hash;
  const url = `${location.href.split("#")[0]}#${hash}`;
  try {
    const w = window.open(url, `mt-${hash}-${Date.now()}`, "popup=yes,width=1440,height=900");
    return !!w;
  } catch {
    return false;
  }
}

interface WorkspaceApi {
  state: WorkspaceState;
  setPage: (p: PageId) => void;
  /**
   * ``open``: Funktion zeigen; ``stay``: auf der aktuellen Seite bleiben (Klick in WEI/FX/CMDT);
   * ``viaCommand``: aus der Befehlszeile – ein fixiertes aktives Panel wechselt dann allein.
   */
  setSecurity: (t: string, opts?: { open?: FnCode; stay?: boolean; viaCommand?: boolean }) => void;
  runFn: (fn: FnCode, ticker?: string | null) => void;
  /** Funktion ohne Wertpapier zeigen (Klick in BRIEF/ASK): vorhandenes Panel, sonst die passende Seite; das angeklickte Panel bleibt */
  openFn: (fn: FnCode) => void;
  setPanelFn: (panel: number, fn: FnCode) => void;
  setActive: (i: number) => void;
  maximize: (i: number | null) => void;
  setLayout: (l: Layout) => void;
  resetPage: () => void;
  setLinked: (linked: boolean) => void;
  pinPanel: (panel: number, ticker: string | null) => void;
  back: () => void;
  watchAdd: (t: string) => void;
  watchRemove: (t: string) => void;
  watchMove: (t: string, delta: number) => void;
  init: (mode: string, watchlist: string[]) => void;
}

const Ctx = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initial());

  // Fensterlayout speichern
  useEffect(() => {
    try {
      localStorage.setItem(winKey(state.window), JSON.stringify(state));
    } catch {
      /* Speicher nicht verfügbar: Arbeitsbereich gilt nur für diese Sitzung */
    }
  }, [state]);

  // Geteilten Teil für andere Fenster veröffentlichen
  useEffect(() => {
    if (!state.mode) return;
    try {
      const prev = parseShared(readJson(SHARED_KEY));
      const shared: Shared = {
        mode: state.mode,
        security: state.linked ? state.security : prev?.mode === state.mode ? prev.security : state.security,
        watchlist: state.watchlist,
        recent: state.recent,
      };
      localStorage.setItem(SHARED_KEY, JSON.stringify(shared));
    } catch {
      /* ohne Speicher keine Fenster-Synchronisierung */
    }
  }, [state.mode, state.security, state.linked, state.watchlist, state.recent]);

  // Änderungen aus anderen Fenstern übernehmen
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SHARED_KEY || !e.newValue) return;
      try {
        const shared = parseShared(JSON.parse(e.newValue));
        if (shared) dispatch({ type: "shared", shared });
      } catch {
        /* fremder Inhalt */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const page = PAGE_BY_ID[state.page];
    const solo = state.window.startsWith("solo-") ? state.window.slice(5) : null;
    document.title = solo ? `MT · ${solo}` : state.window === "main" ? "Market Terminal" : `MT · ${page.label}`;
  }, [state.page, state.window]);

  const setSecurity = useCallback(
    (t: string, opts?: { open?: FnCode; stay?: boolean; viaCommand?: boolean }) => {
      dispatch({ type: "security", ticker: t, viaCommand: opts?.viaCommand });
      // Einzelfunktions-Fenster behalten ihre Funktion; verknüpfte Fenster zeigen das Wertpapier
      if (isSolo(state.window)) return;
      const pageHasTickerPanel = state.pages[state.page].panels.some((f) => FN[f].needsTicker);
      if (opts?.open) {
        let page = state.page;
        if (!opts.stay && !pageHasTickerPanel && FN[opts.open].needsTicker) {
          page = "equity";
          dispatch({ type: "page", page });
        }
        const panels = state.pages[page].panels;
        const existing = panels.indexOf(opts.open);
        if (existing >= 0) {
          // Die Funktion ist schon offen: dorthin wechseln statt ein anderes Panel zu überschreiben
          dispatch({ type: "active", index: existing });
        } else {
          // Auf derselben Seite das Nachbarpanel nutzen, nicht die angeklickte Liste selbst
          const act = state.active[page];
          dispatch({ type: "fn", fn: opts.open, panel: opts.stay && panels.length > 1 ? (act + 1) % panels.length : act });
        }
      } else if (!pageHasTickerPanel && state.window === "main" && !opts?.stay) {
        // Im Hauptfenster zur Aktienseite wechseln; Zusatzfenster bleiben, wo sie sind,
        // weil die verknüpften Fenster das Wertpapier ohnehin anzeigen
        dispatch({ type: "page", page: "equity" });
      }
    },
    [state.page, state.pages, state.window, state.active],
  );

  const api = useMemo<WorkspaceApi>(
    () => ({
      state,
      setPage: (page) => dispatch({ type: "page", page }),
      setSecurity,
      runFn: (fn, ticker) => {
        if (ticker) dispatch({ type: "security", ticker, viaCommand: true });
        dispatch({ type: "fn", fn });
      },
      openFn: (fn) => {
        if (isSolo(state.window)) {
          openWindow({ fn });
          return;
        }
        const here = state.pages[state.page].panels.indexOf(fn);
        if (here >= 0) {
          dispatch({ type: "active", index: here });
          return;
        }
        const target = pageForFn(fn);
        const panels = state.pages[target].panels;
        if (target !== state.page) dispatch({ type: "page", page: target });
        const existing = panels.indexOf(fn);
        if (existing >= 0) {
          dispatch({ type: "active", index: existing });
          return;
        }
        // Auf derselben Seite das Nachbarpanel nutzen, nicht das angeklickte Panel selbst
        const act = state.active[target] ?? 0;
        dispatch({ type: "fn", fn, panel: target === state.page && panels.length > 1 ? (act + 1) % panels.length : act });
      },
      setPanelFn: (panel, fn) => dispatch({ type: "fn", fn, panel }),
      setActive: (index) => dispatch({ type: "active", index }),
      maximize: (index) => dispatch({ type: "maximize", index }),
      setLayout: (layout) => dispatch({ type: "layout", layout }),
      resetPage: () => dispatch({ type: "resetPage" }),
      setLinked: (linked) => {
        let security: string | null = null;
        if (linked) {
          try {
            const shared = parseShared(readJson(SHARED_KEY));
            if (shared?.mode === state.mode) security = shared.security;
          } catch {
            /* ohne Speicher: eigenes Wertpapier behalten */
          }
        }
        dispatch({ type: "linked", linked, security });
      },
      pinPanel: (panel, ticker) => dispatch({ type: "pin", panel, ticker }),
      back: () => dispatch({ type: "back" }),
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
