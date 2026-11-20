import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmStop, openNotebookWindow, STOP_QUESTION, type NotebookStatus } from "../lib/notebook";
import { NB } from "./notebook";
import type { ScreenProps } from "./types";

const running: NotebookStatus = { installed: true, running: true, starting: false, port: 8890, token: "abc", path: "lab/tree/Beispiel.ipynb", message: null };

function render(): string {
  const qc = new QueryClient();
  qc.setQueryData(["notebook"], running);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NB {...({} as ScreenProps)} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("NB – Notebook", () => {
  it("zeigt nach dem Neuladen das Notebook im Terminal, auch wenn es vorher in eigenem Fenster lief", () => {
    // alter gespeicherter Zustand „gelöst“ – das Fenster gibt es nach dem Neuladen nicht mehr (kein Griff darauf)
    const store: Record<string, string> = { "mt.pref.v1.nb.external": "true" };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) });
    vi.stubGlobal("window", { location: { protocol: "http:", hostname: "127.0.0.1" } });
    const html = render();
    expect(html).toContain("<iframe");
    expect(html).toContain("http://127.0.0.1:8890/lab/tree/Beispiel.ipynb?token=abc");
    expect(html).not.toContain("läuft in einem eigenen Fenster");
  });
});

describe("Notebook in eigenem Fenster", () => {
  it("holt ein offenes Fenster nur nach vorn, statt JupyterLab darin neu zu laden", () => {
    const open = vi.fn((_: string) => ({ closed: false, focus: vi.fn() }));
    const w = openNotebookWindow("http://127.0.0.1:8890/lab?token=a", null, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(openNotebookWindow("http://127.0.0.1:8890/lab?token=a", w, open)).toBe(w);
    expect(open).toHaveBeenCalledTimes(1);
    expect(w!.focus).toHaveBeenCalledTimes(1);
    // geschlossenes Fenster: neu öffnen; blockiert: null
    expect(openNotebookWindow("u", { closed: true, focus: vi.fn() }, open)).not.toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
    expect(openNotebookWindow("u", null, () => null)).toBeNull();
  });
});

describe("Notebook beenden", () => {
  it("fragt vorher nach, weil ungespeicherte Änderungen sonst verloren gehen", () => {
    const ask = vi.fn(() => false);
    expect(confirmStop(ask)).toBe(false);
    expect(ask).toHaveBeenCalledWith(STOP_QUESTION);
    expect(STOP_QUESTION).toMatch(/speichern/);
    expect(confirmStop(() => true)).toBe(true);
  });
});
