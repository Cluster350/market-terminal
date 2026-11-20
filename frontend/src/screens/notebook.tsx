// NB – Notebook: JupyterLab im Terminal. Notebooks lesen die Terminal-Daten mit dem Modul mt (nur lesend).
// Per Klick in ein eigenes Fenster lösen (z. B. für einen zweiten Bildschirm) und wieder zurückholen.

import { useEffect, useRef, useState } from "react";
import { Empty, ErrorState, Loading } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { notebookUrl, useNotebookActions, useNotebookStatus } from "../lib/notebook";
import { usePersistentState } from "../lib/persist";
import type { ScreenProps } from "./types";

const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const WINDOW_NAME = "mt-notebook";

export function NB(_: ScreenProps) {
  const q = useNotebookStatus();
  const act = useNotebookActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [external, setExternal] = usePersistentState<boolean>("nb.external", false, isBool);
  const [reload, setReload] = useState(0);
  const win = useRef<Window | null>(null);
  const s = q.data;
  const url = s && s.running ? notebookUrl(s) : null;

  // ein gelöstes Fenster, das der Nutzer schließt, holt das Notebook ins Terminal zurück
  useEffect(() => {
    if (!external) return;
    const id = window.setInterval(() => {
      if (win.current && win.current.closed) {
        win.current = null;
        setExternal(false);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [external, setExternal]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function detach() {
    if (!url) return;
    win.current = window.open(url, WINDOW_NAME, "popup,width=1280,height=860");
    if (!win.current) return setErr("Das Fenster wurde vom Browser blockiert – Pop-ups für das Terminal erlauben.");
    setExternal(true);
  }

  function attach() {
    try {
      win.current?.close();
    } catch {
      /* fremdes Fenster */
    }
    win.current = null;
    setExternal(false);
  }

  if (IS_STATIC) return <Empty>Das Notebook gibt es nur im lokal gestarteten Terminal.</Empty>;
  if (q.isPending) return <Loading rows={3} />;
  if (q.isError || !s) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  if (!s.installed) {
    return (
      <div className="nb-info">
        <b>Jupyter ist noch nicht installiert.</b>
        <p>
          Einmal <code>werkzeuge\Notebook installieren.bat</code> doppelklicken (lädt JupyterLab, pandas und Diagramme, etwa 300 MB), danach das
          Terminal beenden und neu starten.
        </p>
        <p className="dim">
          Ohne Installation geht es auch mit einem eigenen Jupyter: die Datei <code>notebook\mt.py</code> neben das Notebook legen und{" "}
          <code>import mt</code> schreiben – das Terminal muss dafür laufen.
        </p>
      </div>
    );
  }

  const starting = s.starting || busy === "start";
  const toolbar = (
    <div className="toolbar nb-bar">
      <span className={`nb-dot ${s.running ? "on" : ""}`} aria-hidden="true" />
      <span className="xs muted">{s.running ? `Jupyter läuft (Port ${s.port})` : starting ? "Jupyter startet …" : "Jupyter ist aus"}</span>
      <span className="spacer" />
      {s.running && !external && (
        <>
          <button type="button" className="btn" title="Notebook neu laden" onClick={() => setReload((n) => n + 1)}>
            ↻ neu laden
          </button>
          <button type="button" className="btn" title="In eigenem Fenster öffnen, z. B. für einen zweiten Bildschirm" onClick={detach}>
            ⧉ in eigenem Fenster
          </button>
        </>
      )}
      {s.running && external && (
        <button type="button" className="btn" title="Fenster schließen und das Notebook wieder hier zeigen" onClick={attach}>
          ↙ zurück ins Terminal
        </button>
      )}
      {s.running && (
        <button type="button" className="btn" title="Jupyter beenden (Notebooks sind gespeichert)" disabled={!!busy} onClick={() => run("stop", async () => { attach(); await act.stop(); })}>
          ■ beenden
        </button>
      )}
    </div>
  );

  return (
    <div className="nb">
      {toolbar}
      {err && <div className="nb-err small down">{err}</div>}
      {!s.running ? (
        <div className="nb-info">
          <b>Notebook im Terminal</b>
          <p>
            Eigene Auswertungen mit Python: Kurse, Makro, Prognosen, Depot und innerer Wert kommen über das Modul <code>mt</code> als Tabellen
            ins Notebook – nur lesend, im Terminal ändert sich nichts. Ein Beispiel-Notebook ist dabei.
          </p>
          {s.message && <p className="down">{s.message}</p>}
          <button type="button" className="btn primary" disabled={starting} onClick={() => run("start", act.start)}>
            {starting ? "startet …" : "▶ Notebook starten"}
          </button>
        </div>
      ) : external ? (
        <div className="nb-info">
          <b>Das Notebook läuft in einem eigenen Fenster.</b>
          <p>Schließt du das Fenster, erscheint es wieder hier.</p>
          <p>
            <button type="button" className="btn" onClick={detach}>
              Fenster nach vorn holen
            </button>{" "}
            <button type="button" className="btn" onClick={attach}>
              zurück ins Terminal
            </button>
          </p>
        </div>
      ) : (
        url && busy !== "stop" && <iframe key={reload} className="nb-frame" src={url} title="Jupyter-Notebook" allow="clipboard-read; clipboard-write" />
      )}
    </div>
  );
}
