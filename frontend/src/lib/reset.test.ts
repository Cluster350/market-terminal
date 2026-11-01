import { describe, expect, it } from "vitest";
import { clearSaved } from "./reset";

function store(keys: string[]) {
  const m = new Map(keys.map((k) => [k, "x"]));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    keys: () => Array.from(m.keys()).sort(),
  };
}

describe("Zurücksetzen", () => {
  const all = ["mt.pref.v1.gp.range", "mt.win.v1.main", "mt.workspace.v1", "mt.shared.v1", "mt.screens", "mt.cmd.history", "mt.news.read", "andere.app"];

  it("Ansicht: Layouts und Einstellungen weg, Watchlist und Screens bleiben", () => {
    const s = store(all);
    clearSaved("view", s);
    expect(s.keys()).toEqual(["andere.app", "mt.cmd.history", "mt.news.read", "mt.screens", "mt.shared.v1"]);
  });

  it("Alles: nur fremde Einträge bleiben", () => {
    const s = store(all);
    clearSaved("all", s);
    expect(s.keys()).toEqual(["andere.app"]);
  });
});
