// Fächerdiagramm einer Prognose mit Urteil des Rückblick-Tests (gemeinsam für ECST, ECO und OMON).

import { useMemo, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import EChart, { AXIS, TOOLTIP, type EOption } from "./EChart";
import { Empty, ErrorState, Loading } from "./ui";
import { ApiError } from "../lib/api";
import { normalizeTicker } from "../lib/commands";
import { fmt } from "../lib/format";
import { useCsvExport, type CsvDataset } from "../lib/exporter";
import {
  cleanFeatures,
  comparedText,
  digitsFor,
  fanData,
  fcTime,
  fmtVal,
  gainText,
  MAX_FEATURES,
  qualityLine,
  useFeatureOptions,
  useForecastStatus,
  verdictClass,
  verdictLabel,
  type ForecastResult,
} from "../lib/forecast";

const AMBER = "#ffa028";

export function fanOption(r: ForecastResult, maxHist = 36): EOption {
  const d = fanData(r, maxHist);
  const digits = digitsFor(r);
  const unit = r.unit && r.unit !== "USD" ? ` ${r.unit}` : "";
  const hidden = { lineStyle: { opacity: 0 }, symbol: "none", silent: true, tooltip: { show: false } };
  const series: unknown[] = [
    { name: "80-%-Unterkante", type: "line", stack: "b80", data: d.lo80, ...hidden },
    { name: "80-%-Band", type: "line", stack: "b80", data: d.band80, ...hidden, areaStyle: { color: "rgba(255,160,40,0.13)" } },
    { name: "50-%-Unterkante", type: "line", stack: "b50", data: d.lo50, ...hidden },
    { name: "50-%-Band", type: "line", stack: "b50", data: d.band50, ...hidden, areaStyle: { color: "rgba(255,160,40,0.28)" } },
    {
      name: "Ist", type: "line", data: d.hist, symbol: "circle", symbolSize: 3, showSymbol: d.categories.length < 40,
      lineStyle: { color: "#d8d8d8", width: 1.5 }, itemStyle: { color: "#d8d8d8" },
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#5c5c5c", type: "dotted" }, label: { show: false }, data: [{ xAxis: d.splitIndex - 1 }] },
    },
    { name: "Prognose (Median)", type: "line", data: d.median, symbol: "circle", symbolSize: 4, lineStyle: { color: AMBER, width: 1.5, type: "dashed" }, itemStyle: { color: AMBER } },
  ];
  if (d.baseline) {
    series.push({
      name: "ohne Einflussgrößen", type: "line", data: d.baseline, symbol: "none", silent: true,
      lineStyle: { color: "#8f8f8f", width: 1, type: "dotted" }, itemStyle: { color: "#8f8f8f" },
    });
  }
  if (d.consensus) {
    series.push({
      name: "Konsens", type: "line", data: d.consensus, symbol: "diamond", symbolSize: 6, lineStyle: { opacity: 0 },
      itemStyle: { color: "#6fa8ff" }, connectNulls: false,
    });
  }
  return {
    animation: false,
    grid: { left: 52, right: 14, top: 10, bottom: 24 },
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        const lines = [d.categories[i]];
        if (d.hist[i] !== null && d.hist[i] !== undefined) lines.push(`Ist ${fmt(d.hist[i], digits)}${unit}`);
        if (i >= d.splitIndex) {
          const lo80 = d.lo80[i] as number;
          const lo50 = d.lo50[i] as number;
          lines.push(`Prognose ${fmt(d.median[i], digits)}${unit}`);
          lines.push(`50 %: ${fmt(lo50, digits)} – ${fmt(lo50 + (d.band50[i] as number), digits)}`);
          lines.push(`80 %: ${fmt(lo80, digits)} – ${fmt(lo80 + (d.band80[i] as number), digits)}`);
          if (d.baseline && d.baseline[i] !== null && d.baseline[i] !== undefined) lines.push(`ohne Einflussgrößen ${fmt(d.baseline[i], digits)}${unit}`);
        }
        if (d.consensus && d.consensus[i] !== null && d.consensus[i] !== undefined) lines.push(`Konsens ${fmt(d.consensus[i], digits)}${unit}`);
        return lines.join("<br/>");
      },
    },
    xAxis: { type: "category", data: d.categories, boundaryGap: false, ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", scale: true, splitNumber: 3, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, digits >= 2 ? 1 : 0) } },
    series,
  } as EOption;
}

/** Fehlermeldungen der Prognose in Worten (ausgeschaltet, zu wenig Daten …). */
function FcError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.code === "forecast_off") return <Empty>Prognose ist ausgeschaltet (FORECAST_MODE=off in der .env).</Empty>;
  return <ErrorState error={error} onRetry={onRetry} />;
}

export function EngineBadge({ r }: { r: ForecastResult }) {
  const status = useForecastStatus();
  const msg = status.data?.message;
  return (
    <span className="fc-engine" title={[comparedText(r.quality, digitsFor(r)), msg].filter(Boolean).join("\n") || undefined}>
      {r.engine === "chronos" ? "Chronos-2" : "Statistik"}
    </span>
  );
}

/** Verlauf, Konsens und Prognose mit 50-/80-%-Band als eine Tabelle für den CSV-Export. */
export function forecastCsv(r: ForecastResult): CsvDataset {
  const unit = r.unit ? ` [${r.unit}]` : "";
  const cons = new Map((r.consensus?.t ?? []).map((t, i) => [t, r.consensus!.v[i]]));
  const base = r.features?.features.length ? r.features.baseline : null; // Vergleich: Prognose ohne Einflussgrößen
  const rows: CsvDataset["rows"] = r.history.t.map((t, i) => [t, "Ist", r.history.v[i], cons.get(t) ?? null, null, null, null, null, ...(base ? [null] : [])]);
  r.forecast.t.forEach((t, i) =>
    rows.push([t, "Prognose", r.forecast.median[i], cons.get(t) ?? null, r.forecast.lo80[i], r.forecast.lo50[i], r.forecast.hi50[i], r.forecast.hi80[i], ...(base ? [base.median[i] ?? null] : [])]),
  );
  const names = r.features?.features.map((f) => f.label).join(", ");
  return {
    title: `${r.label} – Prognose (${r.engineLabel}${names ? `, Einflussgrößen: ${names}` : ""})`,
    columns: ["Zeitpunkt", "Art", `Wert${unit}`, `Konsens${unit}`, "80 % unten", "50 % unten", "50 % oben", "80 % oben", ...(base ? ["ohne Einflussgrößen"] : [])],
    rows,
  };
}

/**
 * Auswahl der Einflussgrößen: Vorschläge (Märkte, Kennzahlen, Termine des Landes) oder ein eigener Ticker.
 * Die gewählten Reihen fließen in die Prognose ein; der Rückblick-Test zeigt, ob sie geholfen hätten.
 */
export function FeaturePicker({ kind, country, value, onChange }: { kind: "macro" | "event"; country: string | null; value: string[]; onChange: (x: string[]) => void }) {
  const opts = useFeatureOptions(kind, country).data ?? [];
  const [ticker, setTicker] = useState("");
  const full = value.length >= MAX_FEATURES;
  const add = (k: string) => onChange(cleanFeatures([...value, k]));
  const groups = useMemo(() => {
    const m = new Map<string, typeof opts>();
    for (const o of opts) if (!value.includes(o.key)) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return Array.from(m.entries());
  }, [opts, value]);
  const labelOf = (k: string) => opts.find((o) => o.key === k)?.label ?? k.replace(/^[me]:[A-Za-z]+:/, "");
  return (
    <div className="fc-x" data-csv-skip="">
      <span className="xs muted" title="Zusätzliche Reihen, die das Modell mit einbezieht (z. B. Ölpreis, Gold, Zinsen bei der Inflation). Der Rückblick-Test prüft, ob sie die Prognose früher verbessert hätten.">
        Einflussgrößen:
      </span>
      {value.map((k) => (
        <span key={k} className="fc-x-chip">
          {labelOf(k)}
          <button type="button" aria-label={`${labelOf(k)} entfernen`} onClick={() => onChange(value.filter((v) => v !== k))}>
            ×
          </button>
        </span>
      ))}
      <select className="field" aria-label="Einflussgröße hinzufügen" value="" disabled={full || !country} onChange={(e) => e.target.value && add(e.target.value)}>
        <option value="">{full ? `höchstens ${MAX_FEATURES}` : "＋ hinzufügen …"}</option>
        {groups.map(([g, list]) => (
          <optgroup key={g} label={g}>
            {list.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ticker.trim() && !full) add(normalizeTicker(ticker) || ticker.trim().toUpperCase()); // gleiche Schreibweise wie die Vorschläge
          setTicker("");
        }}
      >
        <input className="field" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="oder Ticker, z. B. SPY US" aria-label="Ticker als Einflussgröße" disabled={full || !country} maxLength={40} style={{ width: "19ch" }} />
      </form>
      {value.length > 0 && (
        <button type="button" className="tool" title="Alle Einflussgrößen entfernen" onClick={() => onChange([])}>
          leeren
        </button>
      )}
    </div>
  );
}

/** Ergebnis des Vergleichs mit/ohne Einflussgrößen: Urteil in Worten, Nutzen je Reihe, Hinweise. */
function FeatureEffect({ r }: { r: ForecastResult }) {
  const f = r.features;
  if (!f) return null;
  const digits = digitsFor(r);
  const detail = [
    f.text,
    f.maeBase !== null && f.maeWith !== null ? `Rückblick-Fehler ohne ${fmt(f.maeBase, digits)} · mit ${fmt(f.maeWith, digits)} (${f.points} gemeinsame Zeitpunkte)` : "",
    ...f.features.map((x) => `${x.label}: allein ${gainText(x.gain)}`),
    ...f.notes,
  ].filter(Boolean);
  return (
    <div className="fc-x-effect xs" title={detail.join("\n")}>
      <span className={f.helps === true ? "up" : f.helps === false ? "down" : "muted"}>{f.text}</span>
      {f.features.length > 1 && (
        <span className="dim">
          {" "}Allein: {f.features.map((x) => `${x.label.replace(/ \((Veränderung %|Rendite)\)$/, "")} ${gainText(x.gain)}`).join(" · ")}
        </span>
      )}
      {f.notes.length > 0 && <span className="down"> {f.notes.join(" ")}</span>}
    </div>
  );
}

export function ForecastPanel({ q, children, maxHist, height }: { q: UseQueryResult<ForecastResult>; children?: (r: ForecastResult) => ReactNode; maxHist?: number; height?: number }) {
  const r = q.data;
  const option = useMemo(() => (r ? fanOption(r, maxHist) : null), [r, maxHist]);
  useCsvExport(() => (r ? [forecastCsv(r)] : []));
  if (q.isPending) return <Loading rows={4} />;
  if (q.isError) return <FcError error={q.error} onRetry={() => q.refetch()} />;
  if (!r || !option) return null;
  const digits = digitsFor(r);
  const last = r.forecast.t.length - 1;
  const quality = qualityLine(r.quality, digits) + (r.quality.bandScale > 1.15 ? ` · Bänder nach dem Rückblick-Test ×${fmt(r.quality.bandScale, 1)} verbreitert` : "");
  return (
    <div className="fc">
      <div className="fc-head">
        <b>{r.label}</b>
        <EngineBadge r={r} />
        <span className={`fc-verdict ${verdictClass(r.verdict)}`} title={r.verdictText}>
          {verdictLabel(r.verdict)}
        </span>
        <span className="xs muted fc-next">
          {fcTime(r.forecast.t[0], r.freq)}: <b className="lbl">{fmtVal(r.forecast.median[0], r)}</b> (80 %: {fmt(r.forecast.lo80[0], digits)} – {fmt(r.forecast.hi80[0], digits)})
          {last > 0 && (
            <>
              {" "}· {fcTime(r.forecast.t[last], r.freq)}: {fmtVal(r.forecast.median[last], r)}
            </>
          )}
        </span>
      </div>
      <div className="fc-chart" style={height ? { height } : undefined}>
        <EChart option={option} csv={false} style={{ minHeight: 60 }} />
      </div>
      {children?.(r)}
      <FeatureEffect r={r} />
      <div className="fc-foot xs">
        <span title={`${r.verdictText}\n${quality}`}>
          <span className={verdictClass(r.verdict) === "down" ? "down" : "muted"}>{r.verdictText}</span> <span className="dim">{quality}</span>
        </span>
        <span className="dim" title={r.note ?? undefined}>
          Modellprognose aus dem bisherigen Verlauf – keine Empfehlung.{r.note ? ` ${r.note}` : ""}
        </span>
      </div>
    </div>
  );
}
