// Schlanker ECharts-Wrapper (nur die benötigten Module).

import { useEffect, useRef } from "react";
import { chartDatasets, useCsvExport } from "../lib/exporter";
import * as echarts from "echarts/core";
import { BarChart, LineChart, MapChart, ScatterChart, TreemapChart } from "echarts/charts";
import { DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, VisualMapContinuousComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, ScatterChart, TreemapChart, MapChart, GraphicComponent, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, VisualMapContinuousComponent, CanvasRenderer]);

/** Kartenumrisse registrieren (Weltkarte WMAP). */
export const registerMap = echarts.registerMap;

export type EOption = echarts.EChartsCoreOption;

export const AXIS = {
  axisLine: { lineStyle: { color: "#3a3a3a" } },
  axisTick: { lineStyle: { color: "#3a3a3a" } },
  axisLabel: { color: "#8f8f8f", fontFamily: "IBM Plex Mono, monospace", fontSize: 10 },
  splitLine: { lineStyle: { color: "#171717" } },
};

export const TOOLTIP = {
  backgroundColor: "#111",
  borderColor: "#3a3a3a",
  textStyle: { color: "#ececec", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
};

/**
 * ``csv``: Datenreihen dieses Diagramms beim CSV-Knopf des Panels mitliefern (Titel der Tabelle) –
 * ``false``, wenn das Panel die Rohdaten schon selbst und vollständiger anmeldet.
 */
export default function EChart({ option, onClick, style, csv = "Diagramm" }: { option: EOption; onClick?: (p: { data?: unknown; name?: string }) => void; style?: React.CSSProperties; csv?: string | false }) {
  const ref = useRef<HTMLDivElement>(null);
  useCsvExport(() => (csv === false ? [] : chartDatasets(option as Record<string, unknown>, csv)));
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => clickRef.current?.(p as { data?: unknown; name?: string }));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ animation: false, textStyle: { fontFamily: "IBM Plex Mono, monospace" }, ...option }, true);
  }, [option]);

  return <div ref={ref} style={{ width: "100%", height: "100%", minHeight: 120, ...style }} />;
}
