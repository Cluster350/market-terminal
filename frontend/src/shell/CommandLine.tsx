// Befehlszeile mit Autovervollständigung für Funktionen und Wertpapiere.

import { useEffect, useMemo, useRef, useState } from "react";
import { FUNCTIONS, FN, normalizeTicker, parseCommand, resolveFn, type FnCode } from "../lib/commands";
import { displayTicker } from "../lib/format";
import { useSearch } from "../lib/queries";
import { useWorkspace } from "../state/workspace";

type Suggestion =
  | { kind: "fn"; fn: FnCode; ticker: string | null; label: string; desc: string }
  | { kind: "sec"; ticker: string; label: string; desc: string; meta: string; fn: FnCode | null };

export const FOCUS_EVENT = "mt:focus-cmd";

export function CommandLine() {
  const ws = useWorkspace();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];
    const v = value.trim().toUpperCase();
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
        meta: [h.type, h.country].filter(Boolean).join(" · "),
        fn: parts.fn,
      });
    }
    return out;
  }, [value, parts, search.data, ws.state.recent]);

  useEffect(() => setCursor(-1), [value]);

  function close() {
    setValue("");
    setOpen(false);
    setError(null);
    inputRef.current?.blur();
  }

  function runFn(fn: FnCode, ticker: string | null) {
    if (FN[fn].needsTicker && !ticker && !ws.state.security) {
      setError(`${fn} braucht ein Wertpapier, z. B. „${ws.state.watchlist[0] ? displayTicker(ws.state.watchlist[0]) : "NWND US"} ${fn}“.`);
      return;
    }
    ws.runFn(fn, ticker);
    close();
  }

  function choose(s: Suggestion) {
    if (s.kind === "fn") return runFn(s.fn, s.ticker);
    if (s.fn) return runFn(s.fn, s.ticker);
    ws.setSecurity(s.ticker);
    close();
  }

  function submit() {
    if (cursor >= 0 && suggestions[cursor]) return choose(suggestions[cursor]);
    const cmd = parseCommand(value);
    if (!cmd) return;
    if (cmd.kind === "error") {
      // Tippfehler-freundlich: genau ein Suchtreffer -> direkt öffnen. Nur wenn die Treffer zur
      // aktuellen Eingabe gehören – nach schnellem Weitertippen stammen sie noch vom alten Begriff.
      const hits = debounced === value ? search.data ?? [] : [];
      if (hits.length === 1) return choose({ kind: "sec", ticker: hits[0].ticker, label: "", desc: "", meta: "", fn: null });
      setError(cmd.message);
      return;
    }
    if (cmd.kind === "fn") return runFn(cmd.fn, cmd.ticker);
    ws.setSecurity(cmd.ticker);
    close();
  }

  const showMenu = open && (suggestions.length > 0 || !!error);
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
          setOpen(true);
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
            setOpen(true);
            setCursor((c) => Math.min(c + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, -1));
          } else if (e.key === "Tab" && suggestions.length && open) {
            e.preventDefault();
            const s = suggestions[Math.max(cursor, 0)];
            setValue(s.kind === "fn" ? s.label + " " : `${s.label} `);
          }
        }}
      />
      <button type="button" className="go-key" onClick={submit} title="Ausführen (Enter)">
        GO
      </button>
      {showMenu && (
        <div className="cmd-menu" id="cmd-menu" role="listbox">
          {error && <div className="cmd-error">{error}</div>}
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
