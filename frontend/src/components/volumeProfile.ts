// Volumenprofil als Zeichen-Erweiterung (Primitive) für Lightweight Charts: waagerechte Balken
// am rechten Rand des Kursbereichs, Value Area kräftiger, POC orange.

import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { Profile } from "../lib/profile";

const WIDTH_SHARE = 0.24; // Anteil der Chartbreite für den längsten Balken

class Renderer implements ISeriesPrimitivePaneRenderer {
  constructor(private profile: Profile | null, private series: ISeriesApi<SeriesType> | null) {}

  draw(target: CanvasRenderingTarget2D) {
    const p = this.profile;
    const s = this.series;
    if (!p || !s) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const maxV = Math.max(...p.levels.map((l) => l.volume));
      if (!(maxV > 0)) return;
      const right = mediaSize.width - 2;
      const full = mediaSize.width * WIDTH_SHARE;
      p.levels.forEach((l, i) => {
        if (!(l.volume > 0)) return;
        const yTop = s.priceToCoordinate(l.price + p.step);
        const yBottom = s.priceToCoordinate(l.price);
        if (yTop === null || yBottom === null) return;
        const top = Math.min(yTop, yBottom);
        const h = Math.max(1, Math.abs(yBottom - yTop) - 1);
        if (top > mediaSize.height || top + h < 0) return;
        const w = (full * l.volume) / maxV;
        const inVa = i >= p.vaLow && i <= p.vaHigh;
        if (i === p.pocIndex) {
          ctx.fillStyle = "rgba(255, 160, 40, 0.78)";
          ctx.fillRect(right - w, top, w, h);
          return;
        }
        const a = inVa ? 0.4 : 0.16;
        const wUp = (w * l.up) / l.volume;
        ctx.fillStyle = `rgba(41, 209, 125, ${a})`;
        ctx.fillRect(right - w, top, wUp, h);
        ctx.fillStyle = `rgba(255, 82, 82, ${a})`;
        ctx.fillRect(right - w + wUp, top, w - wUp, h);
      });
    });
  }
}

class PaneView implements ISeriesPrimitivePaneView {
  constructor(private source: VolumeProfilePrimitive) {}
  zOrder() {
    return "bottom" as const; // hinter den Kerzen
  }
  renderer() {
    return new Renderer(this.source.profile, this.source.series);
  }
}

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  profile: Profile | null = null;
  series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private views = [new PaneView(this)];

  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.views;
  }

  setProfile(p: Profile | null) {
    this.profile = p;
    try {
      this.requestUpdate?.();
    } catch {
      /* Chart wurde inzwischen geschlossen */
    }
  }
}
