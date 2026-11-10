// Trend-Scan-Punkte als Zeichen-Erweiterung (Primitive) für Lightweight Charts: ein Punkt je Balken auf dem
// Schlusskurs, Farbe und Größe FLIESSEND nach der Stärke im Vergleich zum Zufall (siehe dotStyle in lib/trendscan).
// Eigene Zeichnung statt Linienreihen mit Punktmarken: die Chart-Bibliothek (4.2) zeichnet wechselnde Punktfarben
// innerhalb einer Reihe nicht vollständig, eine fließende Skala bräuchte sonst Dutzende Reihen.

import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IChartApiBase,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  Logical,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { dotStyle } from "../lib/trendscan";

export interface TrendDot {
  time: Time;
  price: number;
  /** t-Wert; null = noch kein Ergebnis */
  t: number | null;
  /** Zufallsrang 0 … 1; null = noch kein Ergebnis */
  rank: number | null;
}

/** Punkt mit vorab gerechnetem Aussehen; style null = noch kein Ergebnis */
type StyledDot = TrendDot & { style: ReturnType<typeof dotStyle> | null };

/** noch kein Ergebnis: kleiner dunkelgrauer Punkt */
const OPEN = { radius: 1.5, color: "#4a4a4a" };
const BACKGROUND = "#0a0a0a";

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

class Renderer implements ISeriesPrimitivePaneRenderer {
  constructor(private source: TrendDotsPrimitive) {}

  draw(target: CanvasRenderingTarget2D) {
    const { chart, series, dots, hollow } = this.source;
    if (!chart || !series || !dots.length) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const ts = chart.timeScale();
      // Punktgröße folgt dem Zoom: bei vielen Balken (z. B. MAX) kleiner
      const x0 = ts.logicalToCoordinate(0 as Logical);
      const x1 = ts.logicalToCoordinate(1 as Logical);
      const spacing = x0 !== null && x1 !== null ? Math.abs(x1 - x0) : 6;
      const f = Math.max(0.4, Math.min(1, spacing / 6));
      // Reihenfolge: schwache zuerst, starke zuletzt – die starken liegen oben (sortiert in setDots)
      for (const d of dots) {
        const x = ts.timeToCoordinate(d.time);
        if (x === null || x < -12 || x > mediaSize.width + 12) continue;
        const y = series.priceToCoordinate(d.price);
        if (y === null) continue;
        const st = d.style;
        if (st === null) {
          circle(ctx, x, y, OPEN.radius * f, OPEN.color);
          continue;
        }
        const r = st.radius * f;
        if (st.mix > 0.05) circle(ctx, x, y, r + 1.3 * f, BACKGROUND); // dunkler Rand trennt eng liegende Punkte
        circle(ctx, x, y, r, st.color);
        if (hollow) circle(ctx, x, y, Math.max(0.7, r - 1.6 * f), BACKGROUND); // Rückblick: hohl
      }
    });
  }
}

class PaneView implements ISeriesPrimitivePaneView {
  constructor(private source: TrendDotsPrimitive) {}
  zOrder() {
    return "top" as const; // über Durchschnitten und Linien
  }
  renderer() {
    return new Renderer(this.source);
  }
}

export class TrendDotsPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApiBase<Time> | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  dots: StyledDot[] = [];
  hollow = false;
  private requestUpdate: (() => void) | null = null;
  private views = [new PaneView(this)];

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  /** Punkte setzen; hollow = Rückblick (hohle Punkte). */
  setDots(dots: TrendDot[], hollow: boolean) {
    // Farbe und Größe hängen nur an t und Rang: einmal hier rechnen, nicht bei jedem Neuzeichnen (Fadenkreuz, Zoom)
    this.dots = dots
      .map((d) => ({ ...d, style: d.t === null || d.rank === null ? null : dotStyle(d.t, d.rank) }))
      .sort((a, b) => (a.rank ?? -1) - (b.rank ?? -1));
    this.hollow = hollow;
    try {
      this.requestUpdate?.();
    } catch {
      /* Chart wurde inzwischen geschlossen */
    }
  }
}
