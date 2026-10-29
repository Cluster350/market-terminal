// IMAP – Markt-Heatmap (eigenes Modul, damit ECharts erst bei Bedarf geladen wird).

import { useMemo, useState } from "react";
import EChart, { TOOLTIP, type EOption } from "../components/EChart";
import { Empty, Q, Seg } from "../components/ui";
import { displayTicker, escapeHtml, fmtBig, fmtPct, isNum } from "../lib/format";
import { useHeatmap, useStatus } from "../lib/queries";
import type { ScreenRow } from "../lib/types";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

// --- IMAP -----------------------------------------------------------------------------

function heatColor(chg: number | null): string {
  if (!isNum(chg)) return "#2a2a2a";
  const c = Math.max(-3, Math.min(3, chg)) / 3;
  if (c >= 0) {
    const g = Math.round(60 + 120 * c);
    return `rgb(${Math.round(30 - 10 * c)}, ${g}, ${Math.round(50 + 30 * c)})`;
  }
  const r = Math.round(70 + 150 * -c);
  return `rgb(${r}, ${Math.round(40 - 10 * -c)}, ${Math.round(45 - 10 * -c)})`;
}

export default function IMAP(_: ScreenProps) {
  const ws = useWorkspace();
  const status = useStatus();
  const exchanges = ["ALL", ...(status.data?.defaults.screenerExchanges ?? [])];
  const [exchange, setExchange] = useState<string | undefined>(undefined);
  const [metric, setMetric] = useState<"chg1d" | "chg5d">("chg1d");
  const q = useHeatmap(exchange);

  const option = useMemo<EOption | null>(() => {
    if (!q.data) return null;
    const bySector = new Map<string, ScreenRow[]>();
    for (const r of q.data.rows) {
      if (!isNum(r.marketCap)) continue;
      const s = r.sector || "Sonstige";
      bySector.set(s, [...(bySector.get(s) ?? []), r]);
    }
    const data = Array.from(bySector.entries()).map(([sector, rows]) => ({
      name: sector,
      value: rows.reduce((s, r) => s + (r.marketCap ?? 0), 0),
      children: rows.map((r) => ({
        name: r.ticker,
        value: r.marketCap,
        chg: r[metric],
        label: { formatter: `{b|${r.ticker.split(".")[0]}}\n${fmtPct(r[metric])}` },
        itemStyle: { color: heatColor(r[metric]) },
        full: r.name,
      })),
    }));
    if (!data.length) return null; // leere Treemap vermeiden, stattdessen "Keine Daten."
    return {
      tooltip: {
        ...TOOLTIP,
        formatter: (p: { data?: { name: string; value: number; chg?: number; full?: string } }) => {
          const x = p.data;
          if (!x) return "";
          // Tooltip ist HTML: Namen aus der Datenquelle escapen
          if (x.chg === undefined) return `<b>${escapeHtml(x.name)}</b><br/>Marktkap. ${fmtBig(x.value)}`;
          return `<b>${escapeHtml(displayTicker(x.name))}</b> ${escapeHtml(x.full)}<br/>Marktkap. ${fmtBig(x.value)}<br/>Veränderung ${fmtPct(x.chg)}`;
        },
      },
      series: [
        {
          type: "treemap",
          data,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: "100%",
          height: "100%",
          top: 0,
          left: 0,
          upperLabel: { show: true, height: 16, color: "#ffa028", fontSize: 10, backgroundColor: "#111" },
          label: { show: true, color: "#fff", fontSize: 10, lineHeight: 13, rich: { b: { fontWeight: "bold", fontSize: 11 } } },
          itemStyle: { borderColor: "#000", borderWidth: 1, gapWidth: 1 },
          levels: [
            { itemStyle: { borderColor: "#000", borderWidth: 2, gapWidth: 2 }, upperLabel: { show: true } },
            { itemStyle: { borderColor: "#000", borderWidth: 1, gapWidth: 1 } },
          ],
        },
      ],
    };
  }, [q.data, metric]);

  return (
    <>
      <div className="toolbar">
        <select className="field" aria-label="Börse" value={exchange ?? status.data?.defaults.heatmapExchange ?? "ALL"} onChange={(e) => setExchange(e.target.value)}>
          {Array.from(new Set(exchanges)).map((x) => (
            <option key={x} value={x}>
              {x === "ALL" ? "Alle Börsen" : x}
            </option>
          ))}
        </select>
        <Seg label="Zeitraum" value={metric} options={[{ value: "chg1d", label: "1 Tag" }, { value: "chg5d", label: "5 Tage" }]} onChange={setMetric} />
        <span className="small" style={{ display: "inline-flex", gap: 2, alignItems: "center", marginLeft: "auto" }}>
          {[-3, -2, -1, 0, 1, 2, 3].map((v) => (
            <span key={v} style={{ background: heatColor(v), padding: "0 4px", color: "#fff" }}>
              {v > 0 ? `+${v}` : v}
            </span>
          ))}
          <span className="muted">&nbsp;%</span>
        </span>
      </div>
      <div className="panel-body flush">
        <Q q={q}>
          {() =>
            option ? (
              <div style={{ flex: 1, minHeight: 200 }}>
                <EChart
                  option={option}
                  onClick={(p) => {
                    const data = p.data as { chg?: number; name?: string } | undefined;
                    if (data?.chg !== undefined && data.name) ws.setSecurity(data.name);
                  }}
                />
              </div>
            ) : (
              <Empty>Keine Daten.</Empty>
            )
          }
        </Q>
      </div>
    </>
  );
}

