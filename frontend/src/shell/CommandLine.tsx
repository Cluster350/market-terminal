// Befehlszeile mit Autovervollständigung für Funktionen und Wertpapiere.

import { useEffect, useMemo, useRef, useState } from "react";
import { FUNCTIONS, FN, normalizeTicker, parseCommand, resolveFn, unknownSecurityMessage, type FnCode } from "../lib/commands";
import { countryDe, displayTicker, typeDe } from "../lib/format";
import { api, ApiError } from "../lib/api";
import { useResolve, useSearch } from "../lib/queries";
import { useWorkspace } from "../state/workspace";
import { sendIntent } from "../lib/intents";

type Suggestion =
  | { kind: "fn"; fn: FnCode; ticker: string | null; label: string; desc: string }
  | { kind: "sec"; ticker: string; label: string; desc: string; meta: string; fn: FnCode | null };

export const FOCUS_EVENT = "mt:focus-cmd";

const HISTORY_KEY = "mt.cmd.history";

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 30) : [];
  } catch {
    return [];
  }
}

/**
 * Wertpapierteil einer Eingabe: alles vor der Funktion bzw. vor dem gerade getippten Wort.
 * ``complete``: nur wenn die Eingabe mit Leerzeichen oder einer Funktion endet.
 */
export function secTickerOf(text: string, complete: boolean): string | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const fnLast = !!resolveFn(tokens[tokens.length - 1]);
  const done = fnLast || /\s$/.test(text);
  if (complete && !done) return null;
  const sec = done && !fnLast ? tokens : tokens.slice(0, -1);
  return sec.length ? normalizeTicker(sec.join(" ")) : null;
}

/** Hat die Ticker-Prüfung "nicht gefunden" ergeben (und nicht etwa einen Netzfehler)? */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Eindeutiger Suchtreffer für ein einzelnes Wort: einziger Treffer, gleiches Kürzel oder Namensanfang. */
export function searchPick(word: string, all: { ticker: string; name: string }[], exclude?: string): string | null {
  const w = word.trim().toLowerCase();
  // ``exclude``: der gerade abgelehnte Ticker – er würde sonst ungeprüft geöffnet
  const hits = exclude ? all.filter((h) => h.ticker !== exclude) : all;
  if (!w || /\s/.test(w) || !hits.length) return null;
  if (hits.length === 1) return hits[0].ticker;
  const byCode = hits.filter((h) => h.ticker.toLowerCase().split(".")[0] === w);
  if (byCode.length === 1) return byCode[0].ticker;
  const byName = hits.filter((h) => h.name.toLowerCase().startsWith(w));
  return byName.length === 1 ? byName[0].ticker : null;
}

export function CommandLine() {
  const ws = useWorkspace();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [histIdx, setHistIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  // Tippen irgendwo im Terminal landet in der Befehlszeile
  useEffect(() => {
    const onFocus = (e: Event) => {
      const ch = (e as CustomEvent<string | undefined>).detail;
      inputRef.current?.focus();
      if (ch) {
        setValue((v) => v + ch);
        setOpen(true);
      }
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), 180);
    return () => clearTimeout(id);
  }, [value]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Eingabe zerlegen: "NWND US GP" -> Wertpapierteil "NWND US", Funktion GP
  const parts = useMemo(() => {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    const last = tokens[tokens.length - 1] ?? "";
    const fn = tokens.length ? resolveFn(last) : null;
    const secPart = fn ? tokens.slice(0, -1).join(" ") : tokens.join(" ");
    return { tokens, last, fn, secPart };
  }, [value]);

  const searchTerm = useMemo(() => {
    const tokens = debounced.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return "";
    const last = tokens[tokens.length - 1];
    const sec = resolveFn(last) ? tokens.slice(0, -1) : tokens;
    return sec.join(" ").replace(/\./g, " ").split(" ")[0] ?? "";
  }, [debounced]);
  const search = useSearch(searchTerm);

  // Ticker vor der Funktion ("XYZQ US …") vorab prüfen, damit keine Funktion für ein
  // unbekanntes Wertpapier vorgeschlagen wird
  const probeTicker = useMemo(() => secTickerOf(debounced, false), [debounced]);
  const probe = useResolve(probeTicker);
  // Nur "nicht gefunden" heißt unbekannt; bei Netz- oder Serverfehlern (502, Budget 429) würde
  // sonst jedes Wertpapier als unbekannt markiert und alle Funktionsvorschläge verschwänden
  const probeUnknown = isNotFound(probe.error);
  const isUnknown = (t: string | null) => !!t && t === probeTicker && probeUnknown;

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    const v = value.trim().toUpperCase();
    // Nach Ticker + Leerzeichen (z. B. per Tab): passende Funktionen für dieses Wertpapier anbieten
    if (v && /\s$/.test(value) && !parts.fn) {
      const t = normalizeTicker(v);
      if (t && isUnknown(t)) return out;
      if (t) {
        for (const f of FUNCTIONS.filter((f) => f.needsTicker)) {
          out.push({ kind: "fn", fn: f.code, ticker: t, label: `${displayTicker(t)} ${f.code}`, desc: `${f.title} – ${f.desc}` });
        }
        return out;
      }
    }
    if (!v) {
      for (const t of ws.state.recent.slice(0, 6)) {
        out.push({ kind: "sec", ticker: t, label: displayTicker(t), desc: "Zuletzt verwendet", meta: "", fn: null });
      }
      for (const f of FUNCTIONS.filter((f) => !f.needsTicker)) {
        out.push({ kind: "fn", fn: f.code, ticker: null, label: f.code, desc: `${f.title} – ${f.desc}` });
      }
      return out;
    }
    const tickerFromInput = parts.fn && parts.secPart ? normalizeTicker(parts.secPart) : null;
    // Funktionen, die zum letzten Wort passen
    const lastUp = parts.last.toUpperCase();
    const fnMatches = FUNCTIONS.filter(
      (f) => f.code.startsWith(lastUp) || (lastUp.length >= 3 && f.title.toUpperCase().includes(lastUp)),
    );
    const secPrefix = parts.tokens.length > 1 && !parts.fn ? parts.tokens.slice(0, -1).join(" ") : parts.fn ? parts.secPart : "";
    const secTicker = secPrefix ? normalizeTicker(secPrefix) : null;
    for (const f of fnMatches.slice(0, 8)) {
      const t = f.needsTicker ? secTicker ?? tickerFromInput : null;
      if (isUnknown(t)) continue;
      out.push({
        kind: "fn",
        fn: f.code,
        ticker: t,
        label: t ? `${displayTicker(t)} ${f.code}` : f.code,
        desc: `${f.title} – ${f.desc}`,
      });
    }
    for (const h of search.data ?? []) {
      out.push({
        kind: "sec",
        ticker: h.ticker,
        label: displayTicker(h.ticker),
        desc: h.name,
        meta: [typeDe(h.type), h.country ? countryDe(h.country) : ""].filter(Boolean).join(" · "),
        fn: parts.fn,
      });
    }
    return out;
  }, [value, parts, search.data, ws.state.recent, probeTicker, probeUnknown]);

  // Hinweis nur bei abgeschlossener Eingabe ("XYZQ US " oder "XYZQ US GP"), nicht mitten im Wort
  const unknownHint =
    probeTicker && probeUnknown && secTickerOf(value, true) === probeTicker ? `Unbekanntes Wertpapier ${displayTicker(probeTicker)}` : null;

  useEffect(() => setCursor(-1), [value]);

  function close() {
    requestId.current++; // Esc bricht eine laufende Prüfung ab
    setChecking(false);
    setValue("");
    setOpen(false);
    setError(null);
    setHistIdx(-1);
    inputRef.current?.blur();
  }

  function remember(cmd: string) {
    const c = cmd.trim().toUpperCase();
    if (!c) return;
    const next = [c, ...history.filter((h) => h !== c)].slice(0, 30);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* Verlauf nur für diese Sitzung */
    }
  }

  /**
   * Wertpapier vor dem Umschalten prüfen: Ein Tippfehler darf nicht alle Panels auf einen
   * unbekannten Ticker setzen. Vorschläge aus der Suche sind bereits geprüft.
   */
  async function activate(ticker: string, fn: FnCode | null, verified: boolean) {
    let t = ticker;
    if (!verified) {
      // Nur die jüngste Prüfung zählt: Kommt eine ältere Antwort später an (zweimal Enter,
      // inzwischen weitergetippt), darf sie weder umschalten noch die neue Eingabe löschen
      const id = ++requestId.current;
      setChecking(true);
      try {
        t = (await api.resolve(ticker)).ticker;
      } catch (e) {
        if (id !== requestId.current) return;
        setChecking(false);
        // Firmenname oder Kürzel ohne Börse ("northwind", "elbt"): passenden Suchtreffer nehmen
        // Nie den gerade abgelehnten Ticker selbst: er würde sonst ungeprüft (verified) geöffnet
        const pick = e instanceof ApiError && e.status === 404 ? searchPick(parts.secPart, debounced === value ? search.data ?? [] : [], ticker) : null;
        if (pick) return void activate(pick, fn, true);
        setOpen(true);
        setError(
          e instanceof ApiError && e.status === 404
            ? unknownSecurityMessage(value, ticker, e.message)
            : e instanceof ApiError
              ? e.message
              : "Ticker konnte nicht geprüft werden.",
        );
        return;
      }
      if (id !== requestId.current) return;
      setChecking(false);
    }
    remember(value);
    if (fn) ws.runFn(fn, t);
    else ws.setSecurity(t, { viaCommand: true });
    close();
  }

  function runFn(fn: FnCode, ticker: string | null, verified = false) {
    if (FN[fn].needsTicker && !ticker && !ws.state.security) {
      setError(`${fn} braucht ein Wertpapier, z. B. „${ws.state.watchlist[0] ? displayTicker(ws.state.watchlist[0]) : "NWND US"} ${fn}“.`);
      return;
    }
    if (ticker) return void activate(ticker, fn, verified);
    remember(value);
    ws.runFn(fn, null);
    close();
  }

  function choose(s: Suggestion) {
    if (s.kind === "fn") return runFn(s.fn, s.ticker, false);
    return void activate(s.ticker, s.fn, true);
  }

  function submit() {
    if (checking) return; // Prüfung läuft noch (GO ist gesperrt, Enter ebenso)
    if (cursor >= 0 && suggestions[cursor]) return choose(suggestions[cursor]);
    const cmd = parseCommand(value);
    if (!cmd) return;
    if (cmd.kind === "error") {
      // Tippfehler-freundlich: genau ein Suchtreffer -> direkt öffnen. Nur wenn die Treffer zur
      // aktuellen Eingabe gehören – nach schnellem Weitertippen stammen sie noch vom alten Begriff.
      // Nur bei einem einzelnen Wort – "RHNC GR WACC" (unbekannte Funktion) darf nicht still RHNC öffnen
      const hits = debounced === value ? search.data ?? [] : [];
      if (hits.length === 1 && parts.tokens.length === 1) return choose({ kind: "sec", ticker: hits[0].ticker, label: "", desc: "", meta: "", fn: null });
      setError(cmd.message);
      return;
    }
    if (cmd.kind === "fn" && cmd.country) {
      // „IT GC“: Land an das Panel übergeben; steht die Funktion schon auf der Seite, dorthin wechseln
      sendIntent(cmd.fn, { country: cmd.country });
      remember(value);
      const here = ws.state.pages[ws.state.page].panels.indexOf(cmd.fn);
      if (here >= 0) ws.setActive(here);
      else ws.runFn(cmd.fn, null);
      close();
      return;
    }
    if (cmd.kind === "fn") return runFn(cmd.fn, cmd.ticker);
    void activate(cmd.ticker, null, false);
  }

  const showMenu = open && (suggestions.length > 0 || !!error || !!unknownHint);
  let lastKind: string | null = null;

  return (
    <div className="cmd" ref={boxRef}>
      <span className="cmd-prompt" aria-hidden="true">›</span>
      <input
        ref={inputRef}
        value={value}
        aria-label="Befehl oder Ticker eingeben"
        aria-expanded={showMenu}
        aria-controls="cmd-menu"
        role="combobox"
        aria-autocomplete="list"
        spellCheck={false}
        autoComplete="off"
        placeholder="Ticker oder Funktion, z. B. NWND US GP · ECO · TOP   ( / )"
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
          setHistIdx(-1);
          setOpen(true);
          // Weitertippen verwirft eine noch laufende Prüfung des vorherigen Befehls
          if (checking) {
            requestId.current++;
            setChecking(false);
          }
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (histIdx >= 0) {
              const i = histIdx - 1;
              setHistIdx(i);
              setValue(i >= 0 ? history[i] : "");
              return;
            }
            setOpen(true);
            setCursor((c) => Math.min(c + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            // Ohne markierten Vorschlag: frühere Befehle zurückholen
            if (cursor <= -1 && history.length && (!value.trim() || histIdx >= 0)) {
              const i = Math.min(histIdx + 1, history.length - 1);
              setHistIdx(i);
              setValue(history[i]);
              return;
            }
            setCursor((c) => Math.max(c - 1, -1));
          } else if (e.key === "Tab" && suggestions.length && open) {
            e.preventDefault();
            const s = suggestions[Math.max(cursor, 0)];
            setValue(s.kind === "fn" ? s.label + " " : `${s.label} `);
          }
        }}
      />
      <button type="button" className="go-key" onClick={submit} title="Ausführen (Enter)" disabled={checking}>
        {checking ? "…" : "GO"}
      </button>
      {showMenu && (
        <div className="cmd-menu" id="cmd-menu" role="listbox">
          {error ? <div className="cmd-error">{error}</div> : unknownHint && <div className="cmd-error">{unknownHint}</div>}
          {suggestions.map((s, i) => {
            const header = s.kind !== lastKind;
            lastKind = s.kind;
            return (
              <div key={`${s.kind}-${s.label}-${i}`}>
                {header && <div className="cmd-group">{s.kind === "fn" ? "Funktionen" : "Wertpapiere"}</div>}
                <div
                  className="cmd-item"
                  role="option"
                  aria-selected={i === cursor}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  onMouseEnter={() => setCursor(i)}
                >
                  <span className="code">{s.label}</span>
                  <span className="desc">{s.desc}</span>
                  <span className="meta">{s.kind === "sec" ? s.meta : FN[s.fn].group}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
