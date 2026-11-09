// ALRT – Kursalarme und Kursmarken. Der Server prüft im Hintergrund; ausgelöste Alarme meldet
// das Terminal unten rechts (mit Ton und, falls erlaubt, als Desktop-Benachrichtigung).

import { useState } from "react";
import { Empty, ErrorState, Loading, Table, TickerLink, type Column } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { alertStatus, alertsApi, conditionLabel, useAlerts, useAlertsRefresh, type Alert, type AlertInput } from "../lib/alerts";
import { normalizeTicker } from "../lib/commands";
import { displayTicker, fmt, fmtDate, fmtPct, fmtPrice, fmtTime, tone } from "../lib/format";
import { isBool, usePersistentState } from "../lib/persist";
import { parseNumber } from "../lib/portfolio";
import { useExampleTickers, useQuotes, useStatus } from "../lib/queries";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

type FormKind = "above" | "below" | "chgUp" | "chgDown" | "mark";

const KIND_OPTIONS: [FormKind, string][] = [
  ["above", "Kurs steigt über"],
  ["below", "Kurs fällt unter"],
  ["chgUp", "Tagesplus ab %"],
  ["chgDown", "Tagesminus ab %"],
  ["mark", "Kursmarke ohne Alarm"],
];

const STATUS_LABEL = { armed: "scharf", fired: "ausgelöst", off: "aus", mark: "Marke" } as const;

export function toInput(ticker: string, kind: FormKind, level: number, note: string): AlertInput {
  if (kind === "chgUp" || kind === "chgDown") return { ticker, kind: "change", level, direction: kind === "chgUp" ? "above" : "below", note };
  if (kind === "mark") return { ticker, kind: "price", level, direction: null, alarm: false, note };
  return { ticker, kind: "price", level, direction: kind, alarm: true, note };
}

const LEVEL_INPUT = new Intl.NumberFormat("de-DE", { maximumSignificantDigits: 10, useGrouping: false });

/** Wert eines Alarms zum Bearbeiten: alle gültigen Stellen (Shiba Inu 0,00006, EUR/USD 1,16845) – feste vier
 * Nachkommastellen machten daraus „0“ bzw. 0,0001, und ein Speichern nur der Notiz änderte den Wert. */
export function levelText(level: number): string {
  return LEVEL_INPUT.format(level);
}

export function ALRT(_: ScreenProps) {
  const ws = useWorkspace();
  const q = useAlerts();
  const refresh = useAlertsRefresh();
  const [sound, setSound] = usePersistentState("alerts.sound", true, isBool);
  const [perm, setPerm] = useState<string>(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [tickerText, setTickerText] = useState(ws.state.security ? displayTicker(ws.state.security) : "");
  const [kind, setKind] = useState<FormKind>("above");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; level: string; note: string } | null>(null);
  const examples = useExampleTickers();
  const status = useStatus();
  const formTicker = normalizeTicker(tickerText);
  const quote = useQuotes(formTicker ? [formTicker] : []).data?.[0];

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ text: ok, err: false });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), err: true });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function submit() {
    if (!formTicker) return setMsg({ text: `Ticker nicht erkannt (z. B. ${examples[0]}, ${examples[1]}, DAX Index).`, err: true });
    const level = parseNumber(value);
    if (level === null || level <= 0) return setMsg({ text: "Bitte einen Wert größer 0 eingeben.", err: true });
    // „Kurs fällt unter 60“ bei einem Kurs von 58 löste sofort aus – meist ein Versehen
    const last = quote?.last;
    if (last != null && ((kind === "above" && last >= level) || (kind === "below" && last <= level))) {
      const where = kind === "above" ? "über" : "unter";
      const ok = window.confirm(`${displayTicker(formTicker)} steht schon ${where} ${fmtPrice(level, formTicker)} (Kurs ${fmtPrice(last, formTicker)}). Der Alarm löst sofort aus. Trotzdem anlegen?`);
      if (!ok) return;
    }
    await act(async () => {
      await alertsApi.create(toInput(formTicker, kind, level, note.trim()));
      setValue("");
      setNote("");
    }, `${displayTicker(formTicker)}: ${kind === "mark" ? "Kursmarke" : "Alarm"} angelegt.`);
  }

  if (q.isPending) return <Loading rows={6} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  const columns: Column<Alert>[] = [
    {
      key: "s", label: "Status", sort: (a) => ["armed", "fired", "off", "mark"].indexOf(alertStatus(a)),
      render: (a) => {
        const st = alertStatus(a);
        const waiting = st === "armed" && a.waitCross;
        return (
          <span className="nowrap" title={waiting ? "Die Bedingung war beim Scharfschalten schon erfüllt – der Alarm meldet sich, wenn der Kurs die Marke neu erreicht." : undefined}>
            <span className={`st-dot st-${st}`} />
            {waiting ? "scharf (wartet)" : STATUS_LABEL[st]}
          </span>
        );
      },
    },
    { key: "t", label: "Wertpapier", sort: (a) => a.ticker, render: (a) => <TickerLink ticker={a.ticker} open="GP" /> },
    {
      key: "c", label: "Bedingung", sort: (a) => a.level,
      render: (a) =>
        edit?.id === a.id ? (
          <form
            className="alrt-edit"
            onSubmit={(e) => {
              e.preventDefault();
              const level = parseNumber(edit.level);
              if (level === null || level <= 0) return setMsg({ text: "Bitte einen Wert größer 0 eingeben.", err: true });
              const e2 = edit;
              setEdit(null);
              void act(() => alertsApi.update(a.id, { level, note: e2.note.trim() }), "Geändert.");
            }}
          >
            <input className="field" autoFocus value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} style={{ width: "9ch" }} aria-label="Neuer Wert" />
            <input className="field" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} maxLength={200} placeholder="Notiz" style={{ width: "14ch" }} aria-label="Notiz" />
            <button type="submit" className="tool" title="Übernehmen">✓</button>
            <button type="button" className="tool" title="Abbrechen" onClick={() => setEdit(null)}>✕</button>
          </form>
        ) : (
          <span>
            {conditionLabel(a)}
            {a.note ? <span className="muted"> · {a.note}</span> : null}
          </span>
        ),
    },
    {
      key: "p", label: "Kurs / Tag", num: true, sort: (a) => a.price ?? null, title: "Kursalarme: aktueller Kurs; Tagesalarme: Veränderung heute",
      render: (a) => (a.kind === "change" ? <span className={tone(a.changePct, 2)}>{fmtPct(a.changePct)}</span> : fmtPrice(a.price, a.ticker)),
    },
    {
      key: "d", label: "Abstand", num: true, sort: (a) => (a.distancePct === null || a.distancePct === undefined ? null : Math.abs(a.distancePct)),
      title: "Wie weit die Marke vom aktuellen Kurs entfernt ist",
      render: (a) => {
        if (a.kind === "price") return fmtPct(a.distancePct, 1);
        if (a.changePct == null) return "–";
        // Tagesalarme: wie viele Prozentpunkte noch bis zur Schwelle
        const gap = a.direction === "above" ? a.level - a.changePct : a.changePct + a.level;
        return gap > 0 ? `noch ${fmt(gap, 1)} Pkt.` : "erreicht";
      },
    },
    {
      key: "f", label: "Ausgelöst", className: "col-opt2", sort: (a) => a.triggeredAt ?? "",
      render: (a) => (a.triggeredAt ? `${fmtDate(a.triggeredAt).slice(0, 6)} ${fmtTime(a.triggeredAt)} · ${fmtPrice(a.triggeredPrice, a.ticker)}` : ""),
    },
    {
      key: "x", label: "", render: (a) => {
        if (IS_STATIC) return null;
        if (confirmDel === a.id) {
          return (
            <button className="tool danger-tool" autoFocus onBlur={() => setConfirmDel(null)} onClick={() => { setConfirmDel(null); void act(() => alertsApi.remove(a.id)); }}>
              löschen?
            </button>
          );
        }
        const st = alertStatus(a);
        return (
          <span className="nowrap">
            <button className="tool" title="Wert und Notiz ändern" onClick={() => setEdit({ id: a.id, level: levelText(a.level), note: a.note })}>
              ✎
            </button>
            {(st === "fired" || st === "off") && (
              <button
                className="tool"
                title={a.kind === "price" && a.autoDir !== false ? "Wieder scharf schalten (Richtung vom heutigen Kurs aus)" : "Wieder scharf schalten – meldet sich, wenn die Bedingung neu erreicht wird"}
                onClick={() => act(() => alertsApi.update(a.id, { active: true }))}
              >
                ↻
              </button>
            )}
            {a.kind === "price" && (
              <button
                className="tool"
                title={a.alarm ? "Alarm aus – nur Kursmarke behalten" : "Alarm einschalten"}
                onClick={() => act(() => alertsApi.update(a.id, { alarm: !a.alarm }))}
              >
                {a.alarm ? "🔔" : "🔕"}
              </button>
            )}
            {st === "armed" && a.kind === "change" && (
              <button className="tool" title="Alarm ausschalten" onClick={() => act(() => alertsApi.update(a.id, { active: false }))}>
                ❚❚
              </button>
            )}
            <button className="tool" title="Löschen" onClick={() => setConfirmDel(a.id)}>
              ✕
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className="toolbar">
        <span className="lbl">ALARME</span>
        {!IS_STATIC && (
          <span className="small muted">
            prüft alle {d.interval} s{d.checkedAt ? ` · zuletzt ${fmtTime(d.checkedAt)}` : ""}
          </span>
        )}
        {!IS_STATIC && (
          <button className="btn" disabled={busy} onClick={() => act(async () => {
            const fired = await alertsApi.check();
            setMsg({ text: fired.length ? `${fired.length} Alarm(e) ausgelöst.` : "Geprüft – nichts ausgelöst.", err: false });
          })}>
            Jetzt prüfen
          </button>
        )}
        <label className="check" title="Signalton bei ausgelösten Alarmen">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
          Ton
        </label>
        {perm === "default" && (
          <button className="btn" title="Auch eine Benachrichtigung von Windows/macOS zeigen, wenn das Terminal im Hintergrund ist"
            onClick={async () => setPerm(await Notification.requestPermission())}>
            Desktop-Hinweise erlauben
          </button>
        )}
        {perm === "granted" && <span className="small up">Desktop-Hinweise an</span>}
        {perm === "denied" && <span className="small muted" title="In den Website-Einstellungen des Browsers für 127.0.0.1 freigeben">Desktop-Hinweise blockiert</span>}
      </div>
      <div className="panel-body" style={{ overflow: "auto" }}>
        {IS_STATIC ? (
          <div className="depot-banner">In der statischen Demo gibt es keine Alarme. Lokal gestartet prüft das Terminal sie im Hintergrund.</div>
        ) : (
          <form
            className="alrt-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label>
              Wertpapier
              <input className="field" value={tickerText} onChange={(e) => setTickerText(e.target.value)} placeholder={`z. B. ${examples[0]}`} style={{ width: "14ch" }} aria-label="Wertpapier für den Alarm" />
            </label>
            <label>
              Art
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value as FormKind)}>
                {KIND_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              {kind === "chgUp" || kind === "chgDown" ? "Prozent" : "Kurs"}
              <input
                className="field"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                style={{ width: "11ch" }}
                placeholder={kind === "chgUp" || kind === "chgDown" ? "z. B. 5" : quote?.last ? fmtPrice(quote.last, formTicker) : ""}
                aria-label="Wert"
              />
            </label>
            <label style={{ flex: 1, minWidth: "14ch" }}>
              Notiz
              <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} style={{ width: "100%" }} placeholder="z. B. Stopp, Nachkauf" />
            </label>
            <button type="submit" className="btn primary" disabled={busy}>
              Anlegen
            </button>
            {quote?.last != null && (
              <span className="small muted" style={{ alignSelf: "center" }}>
                aktuell {fmtPrice(quote.last, formTicker)} ({fmtPct(quote.changePct)})
              </span>
            )}
          </form>
        )}
        {msg && <div className={`depot-banner ${msg.err ? "err" : ""}`}>{msg.text}</div>}
        {d.alerts.length ? (
          <Table rows={d.alerts} columns={columns} rowKey={(a) => a.id} initialSort={{ key: "s", desc: false }} />
        ) : (
          <Empty>
            <span>
              Noch keine Alarme. Oben anlegen – oder im Kurschart (GP) mit <b className="lbl">＋ Marke</b> direkt in den Chart klicken.
            </span>
          </Empty>
        )}
        <div style={{ padding: "0 10px" }}>
          <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Ausgelöst
            {d.events.length > 0 && !IS_STATIC && (
              <button className="tool" style={{ marginLeft: "auto" }} onClick={() => act(() => alertsApi.clearEvents())}>
                Liste leeren
              </button>
            )}
          </div>
          {d.events.length ? (
            <ul className="alrt-log">
              {d.events.map((e) => (
                <li key={e.id}>
                  <span className="muted">{fmtDate(e.at).slice(0, 6)} {fmtTime(e.at)}</span> {e.message}
                </li>
              ))}
            </ul>
          ) : (
            <div className="small muted" style={{ padding: "4px 0 8px" }}>Noch nichts ausgelöst.</div>
          )}
        </div>
        <div className="notes">
          Ein Alarm meldet sich einmal und steht dann auf „ausgelöst“; ↻ schaltet ihn wieder scharf, ✎ ändert Wert und Notiz. Geprüft wird im
          Hintergrund, solange das Terminal läuft (das Startfenster offen ist) – auch ohne Browser. Außerhalb der Handelszeit einer Börse bewegt sich
          der Kurs nicht, Alarme lösen dann erst zur nächsten Eröffnung aus. {status.data?.mode === "demo" ? "Demo-Kurse ändern sich im 5-Minuten-Takt." : "Kurse von EODHD sind meist 15–20 Minuten verzögert."}
        </div>
      </div>
    </>
  );
}
