// Notebook (Funktion NB): JupyterLab auf dem eigenen Rechner, im Terminal eingebettet oder in eigenem Fenster.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IS_STATIC, request } from "./api";

export interface NotebookStatus {
  installed: boolean;
  running: boolean;
  starting: boolean;
  port: number;
  token: string | null;
  path: string;
  message: string | null;
}

const JSON_POST: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" } };

export const notebookApi = {
  status: () => request<NotebookStatus>("/notebook"),
  start: () => request<NotebookStatus>("/notebook/start", JSON_POST, { timeoutMs: 120_000 }),
  stop: () => request<NotebookStatus>("/notebook/stop", JSON_POST),
};

export const useNotebookStatus = () =>
  useQuery({
    queryKey: ["notebook"],
    queryFn: notebookApi.status,
    enabled: !IS_STATIC,
    refetchInterval: (q) => (q.state.data?.starting ? 1500 : 15_000),
  });

export function useNotebookActions() {
  const qc = useQueryClient();
  const set = (s: NotebookStatus) => qc.setQueryData(["notebook"], s);
  return {
    start: async () => set(await notebookApi.start()),
    stop: async () => set(await notebookApi.stop()),
  };
}

/**
 * Adresse von JupyterLab mit demselben Rechnernamen wie das Terminal (127.0.0.1 oder localhost): sonst gälte die
 * Anmeldung im eingebetteten Fenster als fremde Seite und der Browser verweigerte das Anmelde-Cookie.
 */
export function notebookUrl(s: Pick<NotebookStatus, "port" | "token" | "path">, loc: Pick<Location, "protocol" | "hostname"> = window.location, path?: string): string | null {
  if (!s.token) return null;
  const host = loc.hostname.includes(":") && !loc.hostname.startsWith("[") ? `[${loc.hostname}]` : loc.hostname;
  return `${loc.protocol}//${host}:${s.port}/${(path ?? s.path).replace(/^\//, "")}?token=${encodeURIComponent(s.token)}`;
}

type Win = Pick<Window, "closed" | "focus">;

/**
 * Eigenes Fenster für das Notebook öffnen – oder ein schon offenes nur nach vorn holen: window.open mit Adresse lädt
 * ein vorhandenes Fenster gleichen Namens neu (JupyterLab startete darin von vorn). ``null``, wenn der Browser blockiert.
 */
export function openNotebookWindow<W extends Win>(url: string, current: W | null, open: (url: string) => W | null): W | null {
  if (current && !current.closed) {
    current.focus();
    return current;
  }
  return open(url);
}

/**
 * Rückfrage vor dem Beenden: Jupyter speichert nur alle zwei Minuten von selbst, und das Terminal kann im
 * eingebetteten Fenster nicht speichern – ungespeicherte Änderungen gingen beim Beenden still verloren.
 */
export const STOP_QUESTION = "Jupyter beenden? Nicht gespeicherte Änderungen gehen verloren – vorher in Jupyter speichern (Strg+S).";

export function confirmStop(ask: (text: string) => boolean = (t) => window.confirm(t)): boolean {
  return ask(STOP_QUESTION);
}
