// Screener-Logik für den statischen Demo-Build. Gleiche Semantik wie
// Terminal._match / Terminal.screen im Backend.

import type { ScreenFilter, ScreenResult, ScreenRow } from "./types";

/** snake_case-Feld des Backends -> camelCase-Feld der Zeile */
export function rowKey(field: string): keyof ScreenRow {
  const [head, ...rest] = field.split("_");
  // p.charAt statt p[0]: leere Teile ("a__b" aus alten gespeicherten Screens) dürfen nicht abstürzen
  return (head + rest.map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("")) as keyof ScreenRow;
}

export function matches(row: ScreenRow, f: ScreenFilter): boolean {
  const v = row[rowKey(f.field)];
  if (v === null || v === undefined) return false;
  if (f.op === "in") {
    const set = new Set((Array.isArray(f.value) ? f.value : [f.value]).map((x) => String(x).toUpperCase()));
    return set.has(String(v).toUpperCase());
  }
  if (f.op === "contains") return String(v).toLowerCase().includes(String(f.value).toLowerCase());
  if (typeof v === "string") {
    const a = v.toUpperCase();
    const b = String(f.value).toUpperCase();
    if (f.op === "eq") return a === b;
    if (f.op === "neq") return a !== b;
    return false;
  }
  const b = Number(f.value);
  if (!Number.isFinite(b)) return false;
  switch (f.op) {
    case "gt": return v > b;
    case "gte": return v >= b;
    case "lt": return v < b;
    case "lte": return v <= b;
    case "eq": return v === b;
    case "neq": return v !== b;
    default: return false;
  }
}

export function runScreen(
  universe: ScreenRow[],
  filters: ScreenFilter[],
  sort = "market_cap",
  desc = true,
  limit = 100,
): ScreenResult {
  const rows = universe.filter((r) => filters.every((f) => matches(r, f)));
  const key = rowKey(sort);
  const present = rows.filter((r) => r[key] !== null && r[key] !== undefined);
  const missing = rows.filter((r) => r[key] === null || r[key] === undefined);
  present.sort((a, b) => {
    const x = a[key] as number | string;
    const y = b[key] as number | string;
    const c = typeof x === "string" ? x.toLowerCase().localeCompare(String(y).toLowerCase()) : (x as number) - (y as number);
    return desc ? -c : c;
  });
  const all = [...present, ...missing];
  const cap = Math.max(1, Math.min(limit, 500));
  return { rows: all.slice(0, cap), total: all.length, truncated: all.length > cap, notes: ["Quelle: statischer Demo-Datensatz (fiktive Unternehmen)."] };
}
