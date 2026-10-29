import { afterEach, describe, expect, it, vi } from "vitest";
import { initial, PAGES, reducer, windowFromHash, type WorkspaceState } from "./workspace";

function base(over: Partial<WorkspaceState> = {}): WorkspaceState {
  const s = initial(); // ohne localStorage (Node): Standardzustand
  return { ...s, ...over };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reducer: init", () => {
  it("erster Start übernimmt Standard-Watchlist und Wertpapier", () => {
    const s = reducer(base(), { type: "init", mode: "demo", watchlist: ["NWND.US", "QBIT.US"] });
    expect(s.mode).toBe("demo");
    expect(s.watchlist).toEqual(["NWND.US", "QBIT.US"]);
    expect(s.security).toBe("NWND.US");
  });

  it("gleicher Modus behält eine bewusst geleerte Watchlist und den Verlauf (Regression)", () => {
    const s0 = base({ mode: "demo", watchlist: [], security: "QBIT.US", recent: ["QBIT.US"] });
    const s = reducer(s0, { type: "init", mode: "demo", watchlist: ["NWND.US"] });
    expect(s).toBe(s0);
  });

  it("gleicher Modus ohne Wertpapier ergänzt nur das Wertpapier", () => {
    const s = reducer(base({ mode: "demo", watchlist: ["X.US"], security: null }), { type: "init", mode: "demo", watchlist: ["NWND.US"] });
    expect(s.security).toBe("NWND.US");
    expect(s.watchlist).toEqual(["X.US"]);
  });

  it("Moduswechsel verwirft Ticker des alten Modus", () => {
    const s0 = base({ mode: "demo", watchlist: ["NWND.US"], security: "NWND.US", recent: ["NWND.US"] });
    const s = reducer(s0, { type: "init", mode: "eodhd", watchlist: ["AAPL.US"] });
    expect(s).toMatchObject({ mode: "eodhd", watchlist: ["AAPL.US"], security: "AAPL.US", recent: [] });
  });
});

describe("reducer: Panels und Watchlist", () => {
  it("fn ersetzt das aktive Panel, ungültige Indizes ändern nichts", () => {
    const s0 = base();
    const s = reducer(s0, { type: "fn", fn: "HP" });
    expect(s.pages.equity.panels[0]).toBe("HP");
    expect(reducer(s0, { type: "fn", fn: "HP", panel: 99 })).toBe(s0);
    expect(reducer(s0, { type: "fn", fn: "HP", panel: -1 })).toBe(s0);
  });

  it("Watchlist: keine Duplikate, Verschieben an den Rändern ist ein No-op", () => {
    let s = base({ watchlist: ["A.US", "B.US"] });
    s = reducer(s, { type: "watchAdd", ticker: "A.US" });
    expect(s.watchlist).toEqual(["A.US", "B.US"]);
    expect(reducer(s, { type: "watchMove", ticker: "A.US", delta: -1 })).toBe(s);
    expect(reducer(s, { type: "watchMove", ticker: "A.US", delta: 1 }).watchlist).toEqual(["B.US", "A.US"]);
    expect(reducer(s, { type: "watchRemove", ticker: "A.US" }).watchlist).toEqual(["B.US"]);
  });

  it("security führt den Verlauf ohne Duplikate (max. 12)", () => {
    let s = base();
    for (let i = 0; i < 15; i++) s = reducer(s, { type: "security", ticker: `T${i}.US` });
    s = reducer(s, { type: "security", ticker: "T10.US" });
    expect(s.recent[0]).toBe("T10.US");
    expect(s.recent).toHaveLength(12);
    expect(new Set(s.recent).size).toBe(12);
  });
});

describe("initial: gespeicherter Arbeitsbereich", () => {
  function stubStorage(value: unknown) {
    vi.stubGlobal("localStorage", { getItem: () => (typeof value === "string" ? value : JSON.stringify(value)), setItem: () => {} });
  }

  it("übernimmt gültige Panels und verwirft Prototyp-Namen (Regression: \"toString\" in FN)", () => {
    const panels: Record<string, { panels: string[] }> = Object.fromEntries(PAGES.map((p) => [p.id, { panels: [...p.panels] }]));
    panels.equity = { panels: ["HP", "DES", "FA", "toString"] };
    panels.macro = { panels: ["ECST", "GC", "ECO", "FX"] };
    stubStorage({ version: 1, mode: "demo", page: "macro", pages: panels, watchlist: ["A.US", 5], security: "A.US" });
    const s = initial();
    expect(s.pages.equity.panels).toEqual(PAGES[0].panels); // verworfen
    expect(s.pages.macro.panels).toEqual(["ECST", "GC", "ECO", "FX"]);
    expect(s.page).toBe("macro");
    expect(s.watchlist).toEqual(["A.US"]);
  });

  it("kaputter oder fremder Speicherinhalt ergibt den Standardzustand", () => {
    stubStorage("{kein json");
    expect(initial().page).toBe("equity");
    stubStorage({ version: 2, page: "news" });
    expect(initial().page).toBe("equity");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(initial().watchlist).toEqual([]);
  });
});

describe("Layouts und mehrere Fenster", () => {
  it("Layoutwechsel füllt Panels aus dem Vorrat der Seite auf bzw. kürzt", () => {
    let s = base();
    s = reducer(s, { type: "layout", layout: "single" });
    expect(s.pages.equity).toEqual({ layout: "single", panels: ["GP"] });
    s = reducer(s, { type: "layout", layout: "quad" });
    expect(s.pages.equity.panels).toHaveLength(4);
    expect(new Set(s.pages.equity.panels).size).toBe(4);
    s = reducer({ ...s, active: { ...s.active, equity: 3 } }, { type: "layout", layout: "split" });
    expect(s.pages.equity.panels).toHaveLength(2);
    expect(s.active.equity).toBe(1);
  });

  it("Fensterkennung aus dem URL-Fragment", () => {
    expect(windowFromHash("")).toEqual({ key: "main" });
    expect(windowFromHash("#makro")).toEqual({ key: "makro", page: "macro" });
    expect(windowFromHash("#solo-GP")).toEqual({ key: "solo-GP", solo: "GP" });
    expect(windowFromHash("#solo-toString")).toEqual({ key: "main" });
    expect(windowFromHash("#unsinn")).toEqual({ key: "main" });
  });

  it("Einzelfenster startet mit genau dieser Funktion", () => {
    const s = initial("#solo-ECO");
    expect(s.page).toBe("macro");
    expect(s.pages.macro).toEqual({ layout: "single", panels: ["ECO"] });
  });

  it("verknüpfte Fenster übernehmen das Wertpapier, gelöste nicht", () => {
    const shared = { mode: "demo", security: "QBIT.US", watchlist: ["QBIT.US"], recent: ["QBIT.US"] };
    const linked = reducer(base({ mode: "demo", security: "NWND.US" }), { type: "shared", shared });
    expect(linked.security).toBe("QBIT.US");
    const loose = reducer(base({ mode: "demo", security: "NWND.US", linked: false }), { type: "shared", shared });
    expect(loose.security).toBe("NWND.US");
    expect(loose.watchlist).toEqual(["QBIT.US"]);
  });

  it("Funktionswahl gilt für das angegebene Panel, nicht für das aktive", () => {
    const s = reducer(base(), { type: "fn", fn: "ERN", panel: 2 });
    expect(s.pages.equity.panels).toEqual(["GP", "DES", "ERN", "CN"]);
  });
});
