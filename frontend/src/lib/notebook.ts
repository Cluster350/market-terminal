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
