// Gemeinsame Bausteine: Zustände, Zahlenzellen, Sparkline, Tabelle, Segmentschalter.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../lib/api";
import { arrow, displayTicker, fmtPct, fmtSigned, isNum, tone } from "../lib/format";
import { useWorkspace } from "../state/workspace";
import type { FnCode } from "../lib/commands";

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="state" aria-busy="true" aria-label="Lädt">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${55 + ((i * 37) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const hint =
    e?.code === "plan"
      ? "Der gebuchte EODHD-Plan deckt diese Daten nicht ab."
      : e?.code === "budget"
        ? "Das Tageslimit an API-Calls ist erreicht."
        : e?.code === "auth"
          ? "API-Key in der .env-Datei prüfen."
          : null;
  return (
    <div className="state err" role="alert">
      <span className="msg">{e?.message || (error as Error)?.message || "Unbekannter Fehler"}</span>
      {hint && <span className="muted">{hint}</span>}
      {onRetry && e?.status !== 404 && e?.status !== 400 && (
        <button className="btn" onClick={onRetry}>
          Erneut laden
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}

/** Rendert Lade-, Fehler- oder Datenzustand einer Query. */
export function Q<T>({ q, children, rows }: { q: UseQueryResult<T>; children: (data: T) => ReactNode; rows?: number }) {
  if (q.isPending) return <Loading rows={rows} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children(q.data as T)}</>;
}

export function Change({ value, pct = true, digits = 2, arrowSign = false }: { value: number | null | undefined; pct?: boolean; digits?: number; arrowSign?: boolean }) {
  const t = tone(value);
  return (
    <span className={t}>
      {arrowSign && isNum(value) && value !== 0 && <span aria-hidden="true">{arrow(value)} </span>}
      {pct ? fmtPct(value, digits) : fmtSigned(value, digits)}
    </span>
  );
}

/** Zelle, die bei Wertänderung kurz grün/rot aufblinkt. */
export function Flash({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (isNum(prev.current) && isNum(value) && value !== prev.current) {
      setCls(value > prev.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setCls(""), 1300);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return <span className={`${className || ""} ${cls}`}>{children}</span>;
}

export function Spark({ data, width = 80, height = 18, color }: { data: number[]; width?: number; height?: number; color?: string }) {
  const pts = data.filter(isNum);
  if (pts.length < 2) return <span className="dim">–</span>;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`).join("");
  const stroke = color || (pts[pts.length - 1] >= pts[0] ? "var(--up)" : "var(--down)");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block" }}>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.2" />
      <circle cx={width} cy={height - 1 - ((last - min) / span) * (height - 2)} r="1.8" fill={stroke} />
    </svg>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TickerLink({ ticker, open, children }: { ticker: string; open?: FnCode; children?: ReactNode }) {
  const ws = useWorkspace();
  return (
    <button
      type="button"
      className="tk"
      title={`${ticker} öffnen`}
      onClick={(e) => {
        e.stopPropagation();
        ws.setSecurity(ticker, open ? { open } : undefined);
      }}
    >
      {children ?? displayTicker(ticker)}
    </button>
  );
}

export interface Column<R> {
  key: string;
  label: ReactNode;
  num?: boolean;
  render: (r: R) => ReactNode;
  sort?: (r: R) => number | string | null | undefined;
  className?: string;
  title?: string;
}

export function Table<R>({
  rows,
  columns,
  rowKey,
  onRowClick,
  initialSort,
  selected,
  empty = "Keine Einträge.",
  groupBy,
}: {
  rows: R[];
  columns: Column<R>[];
  rowKey: (r: R) => string;
  onRowClick?: (r: R) => void;
  initialSort?: { key: string; desc: boolean };
  selected?: string | null;
  empty?: ReactNode;
  groupBy?: (r: R) => string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    const present = rows.filter((r) => get(r) !== null && get(r) !== undefined);
    const missing = rows.filter((r) => get(r) === null || get(r) === undefined);
    present.sort((a, b) => {
      const x = get(a) as number | string;
      const y = get(b) as number | string;
      const c = typeof x === "string" ? x.localeCompare(String(y), "de") : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
    return [...present, ...missing];
  }, [rows, columns, sort]);

  if (!rows.length) return <Empty>{empty}</Empty>;
  let lastGroup: string | null = null;
  return (
    <table className="t">
      <thead>
        <tr>
          {columns.map((c) => {
            const active = sort?.key === c.key;
            return (
              <th
                key={c.key}
                className={`${c.num ? "num" : ""} ${c.sort ? "sortable" : ""} ${active ? "sorted" : ""}`}
                title={c.title}
                aria-sort={active ? (sort!.desc ? "descending" : "ascending") : undefined}
                onClick={c.sort ? () => setSort(active ? { key: c.key, desc: !sort!.desc } : { key: c.key, desc: !!c.num }) : undefined}
              >
                {c.label}
                {active ? (sort!.desc ? " ▼" : " ▲") : ""}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const k = rowKey(r);
          const g = groupBy && !sort ? groupBy(r) : null;
          const header = g !== null && g !== lastGroup;
          lastGroup = g;
          return (
            <FragmentRow key={k} header={header ? g : null} span={columns.length}>
              <tr
                className={`${onRowClick ? "clickable" : ""} ${selected === k ? "selected" : ""}`}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${c.num ? "num" : ""} ${c.className || ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            </FragmentRow>
          );
        })}
      </tbody>
    </table>
  );
}

function FragmentRow({ header, span, children }: { header: string | null; span: number; children: ReactNode }) {
  return (
    <>
      {header !== null && (
        <tr className="group">
          <td colSpan={span}>{header}</td>
        </tr>
      )}
      {children}
    </>
  );
}

export function Kv({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Aktuelle Uhrzeit, die sich jede Sekunde/Minute aktualisiert. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Misst die Größe eines Elements (für Charts). */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}
