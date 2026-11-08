// CSV-Export für jedes Panel: Tabellen und Kennzahlen-Listen werden aus dem Panel gelesen, Diagramme melden
// ihre Rohdaten zusätzlich an (useCsvExport). Format für deutsches Excel: Semikolon, Dezimalkomma, UTF-8 mit BOM.

import { createContext, useContext, useEffect, useRef } from "react";

export type CsvCell = string | number | null | undefined;

export interface CsvDataset {
  title: string;
  columns: string[];
  rows: CsvCell[][];
}

export type CsvProvider = () => CsvDataset[];

// --- Zahlen aus der Anzeige -------------------------------------------------------------

const MAGNITUDE: Record<string, number> = { "Tsd.": 1e3, "Mio.": 1e6, "Mrd.": 1e9, "Bio.": 1e12 };

/**
 * Angezeigten Text in Zahl umwandeln, wenn er eine ist: „1.234,56“, „+5,4 %“, „−3,1 Pp“, „1,05 Bio. USD“,
 * „12 bp“. Gibt Zahl und Einheit zurück, sonst null (Text bleibt Text, z. B. Datum, Name, „neg.“).
 */
export function parseDisplayNumber(raw: string): { value: number; unit: string | null } | null {
  let s = raw.replace(/[   ]/g, " ").replace(/−/g, "-").trim();
  if (!s || s.length > 40) return null;
  let unit: string | null = null;
  let factor = 1;
  // Einheiten am Ende (auch mehrere: „Mrd. USD“)
  for (let guard = 0; guard < 3; guard++) {
    const m = /\s*(Tsd\.|Mio\.|Mrd\.|Bio\.|%|Pp|bp|BP|Pkt\.|USD|EUR|GBP|CHF|JPY|×|x|K)$/.exec(s);
    if (!m) break;
    const u = m[1];
    if (u in MAGNITUDE) factor *= MAGNITUDE[u];
    else unit = unit ? `${u} ${unit}` : u;
    s = s.slice(0, m.index).trim();
  }
  // Pfeile und Vorzeichen-Symbole vorne („▲ 2,3 %“)
  s = s.replace(/^[▲▼↑↓]\s*/, "");
  if (!/^[+-]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(s)) return null;
  const value = Number(s.replace(/\./g, "").replace(",", ".")) * factor;
  if (!Number.isFinite(value)) return null;
  return { value, unit };
}

// --- CSV-Text ------------------------------------------------------------------------------

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    // etwa 10 gültige Stellen, höchstens 6 Nachkommastellen (kein Rauschen wie 1046197699227,0001)
    const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(v) || 1)) + 1);
    const d = Math.max(0, Math.min(6, 10 - intDigits));
    return String(Number(v.toFixed(d))).replace(".", ",");
  }
  let s = String(v).replace(/[\r\n]+/g, " ").trim();
  // Fremdtexte, die mit = + - @ beginnen, würde Excel als Formel ausführen (CSV-Injection)
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function datasetsToCsv(sets: CsvDataset[]): string {
  const blocks = sets
    .filter((d) => d.rows.length || d.columns.length)
    .map((d) => {
      const lines: string[] = [];
      if (sets.length > 1 && d.title) lines.push(cell(d.title));
      if (d.columns.length) lines.push(d.columns.map(cell).join(";"));
      for (const r of d.rows) lines.push(r.map(cell).join(";"));
      return lines.join("\n");
    });
  return blocks.join("\n\n");
}

/** Hat ein Text Inhalt (Buchstaben oder Ziffern)? Pfeile, Kreuze und Balkensymbole zählen nicht. */
const hasContent = (t: string) => /[\p{L}\p{N}]/u.test(t);

/**
 * Spalten aus Anzeigetexten: Zahlen werden Zahlen. Die Einheit wandert in die Spaltenüberschrift, wenn
 * die ganze Spalte sie teilt, sonst an den Zeilennamen (z. B. „Bruttomarge [%]“ in einer Jahrestabelle).
 * Spalten ohne Inhalt (Minicharts, Knöpfe wie ✎✕) fallen weg. ``unitColumn``: Einheit als eigene Spalte
 * (für Kennzahlen-Listen, in denen jede Zeile eine andere Einheit hat).
 */
export function textTable(title: string, header: string[], body: string[][], opts: { unitColumn?: boolean } = {}): CsvDataset {
  const width = Math.max(header.length, ...body.map((r) => r.length));
  type Parsed = { v: CsvCell; unit: string | null; raw: string };
  const parsed: Parsed[][] = body.map((r) =>
    Array.from({ length: width }, (_, j) => {
      const raw = (r[j] ?? "").trim();
      if (raw === "–" || raw === "-" || raw === "—") return { v: null, unit: null, raw: "" };
      const n = parseDisplayNumber(raw);
      return n ? { v: n.value, unit: n.unit, raw } : { v: raw, unit: null, raw };
    }),
  );
  const keep = Array.from({ length: width }, (_, j) => j === 0 || parsed.some((r) => typeof r[j].v === "number" || hasContent(r[j].raw)));
  const isNumCell = (c: Parsed) => typeof c.v === "number";

  if (opts.unitColumn) {
    const rows = parsed.map((r) => [...r.map((c) => c.v), r.find((c) => isNumCell(c) && c.unit)?.unit ?? null]);
    return { title, columns: [...header.slice(0, width), "Einheit"], rows };
  }

  // Einheit je Spalte: nur wenn alle Zahlen der Spalte dieselbe (nicht leere) Einheit haben
  const colUnit = Array.from({ length: width }, (_, j) => {
    const us = new Set(parsed.filter((r) => isNumCell(r[j])).map((r) => r[j].unit));
    return us.size === 1 ? Array.from(us)[0] : null;
  });
  // Übrige Einheiten: je Zeile an den Zeilennamen, wenn eindeutig; sonst in eine Einheiten-Spalte neben der Zahl
  const leftover: (string | null)[][] = parsed.map((r) => r.map(() => null));
  const rows: CsvCell[][] = parsed.map((r, i) => {
    const out = r.map((c) => c.v);
    const count = new Map<string, number>();
    r.forEach((c, j) => isNumCell(c) && c.unit && !colUnit[j] && count.set(c.unit, (count.get(c.unit) ?? 0) + 1));
    if (!count.size) return out;
    const unitless = r.some((c, j) => isNumCell(c) && !colUnit[j] && !c.unit);
    const main = Array.from(count.entries()).sort((a, b) => b[1] - a[1])[0][0];
    // Zeilenname = letzte Textzelle vor der ersten Zahl (z. B. das Ereignis nach Zeit und Land) – nur wenn
    // keine Zahl dieser Zeile ohne Einheit dasteht
    const firstNum = r.findIndex(isNumCell);
    let at = -1;
    for (let j = 0; j < firstNum; j++) if (typeof out[j] === "string" && out[j]) at = j;
    const labelled = !unitless && at >= 0;
    if (labelled) out[at] = `${out[at]} [${main}]`;
    r.forEach((c, j) => isNumCell(c) && c.unit && !colUnit[j] && (!labelled || c.unit !== main) && (leftover[i][j] = c.unit));
    return out;
  });
  const unitCol = Array.from({ length: width }, (_, j) => leftover.some((r) => r[j] !== null));
  const heads = Array.from({ length: width }, (_, j) => {
    const h = (header[j] ?? "").replace(/\s*[▲▼↑↓]$/, "").trim() || (j === 0 ? "" : `Spalte ${j + 1}`);
    const u = colUnit[j];
    return u && !h.includes(u) ? `${h} [${u}]` : h;
  });
  const columns: string[] = [];
  const finalRows: CsvCell[][] = rows.map(() => []);
  for (let j = 0; j < width; j++) {
    if (!keep[j]) continue;
    columns.push(heads[j]);
    rows.forEach((r, i) => finalRows[i].push(r[j]));
    if (unitCol[j]) {
      columns.push(`${heads[j]} Einheit`.trim());
      rows.forEach((_, i) => finalRows[i].push(leftover[i][j]));
    }
  }
  return { title, columns: header.length ? columns : [], rows: finalRows };
}

// --- Rohdaten aus Diagramm-Optionen (ECharts) -------------------------------------------------

type Obj = Record<string, unknown>;
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : x === null || x === undefined ? [] : [x]);
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

function num(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
}

/** Wert eines Datenpunkts: Zahl, {value}, oder bei Paaren [x, y] der y-Wert. */
function pointValue(d: unknown): number | null {
  if (isObj(d)) return pointValue(d.value);
  if (Array.isArray(d)) return num(d[d.length - 1]);
  return num(d);
}

function label(x: unknown): CsvCell {
  if (isObj(x)) return label(x.value ?? x.name);
  if (typeof x === "number" || typeof x === "string") return x;
  return null;
}

/**
 * Datenreihen eines Diagramms als Tabellen: Linien/Balken über Kategorien oder Zeit (eine Spalte je Reihe),
 * Punktwolken als Liste, Treemap/Karte als Name–Wert-Liste. Hilfslinien (markLine/markArea) bleiben weg.
 */
export function chartDatasets(option: Obj, title = "Diagramm"): CsvDataset[] {
  const out: CsvDataset[] = [];
  const t = list(option.title).find(isObj);
  const name = (typeof t?.text === "string" && t.text) || title;
  const series = list(option.series).filter(isObj);
  const axes = [...list(option.xAxis), ...list(option.yAxis)].filter(isObj);
  const cat = axes.find((a) => a.type === "category" && Array.isArray(a.data));
  const lines = series.filter((s) => (s.type === "line" || s.type === "bar") && Array.isArray(s.data) && (s.data as unknown[]).length);
  const sname = (s: Obj, i: number) => (typeof s.name === "string" && s.name) || (lines.length === 1 ? "Wert" : `Reihe ${i + 1}`);
  const valueAxis = axes.find((a) => a.type === "time" || a.type === "value");
  const axisTitle = (a: Obj | undefined, fallback: string) => (a && typeof a.name === "string" && a.name) || fallback;

  if (lines.length && cat) {
    const cats = cat.data as unknown[];
    out.push({
      title: name,
      columns: [axisTitle(cat, (cat.data as unknown[]).every((c) => /^\d{4}-\d{2}/.test(String(label(c))) ) ? "Datum" : "Kategorie"), ...lines.map(sname)],
      rows: cats.map((c, i) => [label(c), ...lines.map((s) => pointValue((s.data as unknown[])[i]))]),
    });
  } else if (lines.length) {
    // Zeit- oder Werteachse: Punkte [x, y], nach x zusammengeführt
    const rows = new Map<string, CsvCell[]>();
    lines.forEach((s, k) => {
      for (const d of s.data as unknown[]) {
        const pair = isObj(d) ? d.value : d;
        if (!Array.isArray(pair) || pair.length < 2) continue;
        const x = label(pair[0]);
        if (x === null) continue;
        const key = String(x);
        if (!rows.has(key)) rows.set(key, [x, ...Array(lines.length).fill(null)]);
        rows.get(key)![k + 1] = num(pair[1]);
      }
    });
    if (rows.size)
      out.push({
        title: name,
        columns: [axisTitle(valueAxis, valueAxis?.type === "time" ? "Datum" : "x"), ...lines.map(sname)],
        rows: Array.from(rows.values()).sort((a, b) => (typeof a[0] === "number" && typeof b[0] === "number" ? a[0] - b[0] : String(a[0]) < String(b[0]) ? -1 : 1)),
      });
  }

  const scatters = series.filter((s) => s.type === "scatter" && Array.isArray(s.data) && (s.data as unknown[]).length);
  if (scatters.length) {
    const rows: CsvCell[][] = [];
    scatters.forEach((s, i) => {
      for (const d of s.data as unknown[]) {
        const pair = isObj(d) ? d.value : d;
        const pname = isObj(d) && typeof d.name === "string" ? d.name : null;
        if (Array.isArray(pair)) rows.push([sname(s, i), pname, num(pair[0]), num(pair[1])]);
      }
    });
    if (rows.length) out.push({ title: `${name} (Punkte)`, columns: ["Reihe", "Name", "x", "y"], rows });
  }

  for (const s of series.filter((x) => x.type === "treemap" || x.type === "map" || x.type === "pie")) {
    const rows: CsvCell[][] = [];
    const walk = (items: unknown[], parent: string | null) => {
      for (const d of items) {
        if (!isObj(d)) continue;
        const n = typeof d.name === "string" ? d.name : null;
        if (Array.isArray(d.children) && d.children.length) walk(d.children, n);
        else rows.push([parent, n, pointValue(d.value)]);
      }
    };
    walk(list(s.data), null);
    const hasParent = rows.some((r) => r[0] !== null);
    if (rows.length) out.push({ title: name, columns: hasParent ? ["Gruppe", "Name", "Wert"] : ["Name", "Wert"], rows: hasParent ? rows : rows.map((r) => r.slice(1)) });
  }
  return out;
}

// --- Lesen aus dem Panel (Browser) -----------------------------------------------------------

/** Text einer Zelle: ``data-csv`` hat Vorrang; bei CSS-Großschreibung der Originaltext statt der Anzeige. */
function text(el: Element): string {
  const h = el as HTMLElement;
  const own = h.getAttribute("data-csv");
  if (own !== null) return own;
  const tt = typeof getComputedStyle === "function" ? getComputedStyle(h).textTransform : "none";
  const raw = tt && tt !== "none" ? h.textContent : h.innerText ?? h.textContent;
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

const HEADING = ".section-title, h2, h3, h4";

/** Überschrift zu einer Tabelle: data-export-title, caption oder die nächste Überschrift davor (bis zum Panel). */
function titleFor(el: Element, root: Element): string | null {
  const own = el.closest("[data-export-title]")?.getAttribute("data-export-title");
  if (own) return own;
  const cap = el.querySelector(":scope > caption");
  if (cap) return text(cap);
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  for (let cur: Element | null = el; cur && cur !== root; cur = cur.parentElement) {
    for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches(HEADING)) return text(sib) || null;
      if (sib.matches("table, dl.kv")) break; // Überschrift gehört zu einer anderen Tabelle
    }
  }
  return null;
}

/** Alle sichtbaren Tabellen und Kennzahlen-Listen (dl.kv) eines Panels. */
export function datasetsFromDom(root: HTMLElement): CsvDataset[] {
  const out: CsvDataset[] = [];
  const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || (el as HTMLElement).getClientRects().length > 0;
  let n = 0;
  root.querySelectorAll("table").forEach((table) => {
    if (!visible(table) || table.closest("[data-csv-skip]")) return;
    const headRows = table.querySelectorAll("thead tr");
    // data-csv darf mehrere Spalten mit Tabulator liefern (z. B. G/V in Euro und in Prozent)
    const cellsOf = (tr: Element) => Array.from(tr.querySelectorAll("th,td")).flatMap((c) => text(c).split("\t"));
    const header = headRows.length ? cellsOf(headRows[headRows.length - 1]) : [];
    const body: string[][] = [];
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const cells = cellsOf(tr);
      if (cells.some((c) => c)) body.push(cells);
    });
    if (body.length) out.push(textTable(titleFor(table, root) ?? `Tabelle ${++n}`, header, body));
  });
  let k = 0;
  root.querySelectorAll("dl.kv").forEach((dl) => {
    if (!visible(dl) || dl.closest("[data-csv-skip]")) return;
    const keys = Array.from(dl.querySelectorAll("dt")).map(text);
    const vals = Array.from(dl.querySelectorAll("dd")).map(text);
    if (keys.length) out.push(textTable(titleFor(dl, root) ?? `Kennzahlen ${++k}`, ["Kennzahl", "Wert"], keys.map((key, j) => [key, vals[j] ?? ""]), { unitColumn: true }));
  });
  return out;
}

/** Datei speichern (BOM, damit Excel UTF-8 erkennt). */
export function downloadCsv(name: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function fileName(fn: string, ticker: string | null): string {
  const day = new Date().toISOString().slice(0, 10);
  const t = ticker ? `-${ticker.replace(/[^A-Za-z0-9.-]+/g, "_")}` : "";
  return `${fn}${t}-${day}.csv`;
}

// --- Anmeldung von Rohdaten (Diagramme) ------------------------------------------------------

export interface ExportRegistry {
  set: (id: number, provider: CsvProvider | null) => void;
}

export const ExportContext = createContext<ExportRegistry | null>(null);
let seq = 0;

/** Diagramm-Rohdaten für den CSV-Knopf des Panels anmelden (zusätzlich zu den Tabellen). */
export function useCsvExport(provider: CsvProvider) {
  const reg = useContext(ExportContext);
  const ref = useRef(provider);
  ref.current = provider;
  const id = useRef(0);
  if (!id.current) id.current = ++seq;
  useEffect(() => {
    if (!reg) return;
    const myId = id.current;
    reg.set(myId, () => ref.current());
    return () => reg.set(myId, null);
  }, [reg]);
}
