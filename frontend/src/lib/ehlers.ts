// Indikatoren nach John F. Ehlers (digitale Signalverarbeitung für Kurse).
//
// Umgesetzt nach seinen veröffentlichten EasyLanguage-Listings (Bücher „Rocket Science for Traders“ 2001,
// „Cybernetic Analysis for Stocks and Futures“ 2004, „Cycle Analytics for Traders“ 2013 sowie Artikel in
// „Technical Analysis of Stocks & Commodities“). EasyLanguage rechnet Winkel in Grad – hier überall
// ausdrücklich umgerechnet. Reihen laufen vom ältesten zum neuesten Wert; ``null`` = Anlaufphase.

export type Num = number | null;

const RAD = Math.PI / 180;
const cosd = (deg: number) => Math.cos(deg * RAD);
const sind = (deg: number) => Math.sin(deg * RAD);
const atand = (x: number) => Math.atan(x) / RAD;

/** Wert ``k`` Balken zurück (vor dem Anfang: erster Wert). */
const ago = (xs: number[], i: number, k: number) => xs[Math.max(0, i - k)];

/** Anlaufphase ausblenden: die ersten ``n`` Werte werden null. */
function warm(xs: number[], n: number): Num[] {
  return xs.map((v, i) => (i < n || !Number.isFinite(v) ? null : v));
}

/** Koeffizienten des zweipoligen Butterworth-artigen Filters (SuperSmoother, Hochpass, UltimateSmoother). */
function poles(period: number) {
  const a1 = Math.exp((-1.414 * Math.PI) / period);
  const b1 = 2 * a1 * cosd((1.414 * 180) / period);
  return { c2: b1, c3: -a1 * a1 };
}

// --- Glättung (Linien auf dem Kurs) ---------------------------------------------------------------

/** SuperSmoother (Ehlers 2013): Tiefpass mit zwei Polen – glättet stark bei wenig Verzögerung. */
export function superSmootherRaw(x: number[], period: number): number[] {
  const { c2, c3 } = poles(period);
  const c1 = 1 - c2 - c3;
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    out.push(i < 3 ? x[i] : (c1 * (x[i] + x[i - 1])) / 2 + c2 * out[i - 1] + c3 * out[i - 2]);
  }
  return out;
}

export const superSmoother = (x: number[], period = 20): Num[] => warm(superSmootherRaw(x, period), Math.min(period, x.length));

/** Hochpass mit zwei Polen (Ehlers 2016): lässt nur Schwankungen kürzer als ``period`` durch. */
export function highPass2(x: number[], period: number): number[] {
  const { c2, c3 } = poles(period);
  const c1 = (1 + c2 - c3) / 4;
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    out.push(i < 3 ? 0 : c1 * (x[i] - 2 * x[i - 1] + x[i - 2]) + c2 * out[i - 1] + c3 * out[i - 2]);
  }
  return out;
}

/**
 * UltimateSmoother (Ehlers, TASC 4/2024): Kurs minus Hochpass – im Durchlassbereich ohne Verzögerung.
 * US = (1−c1)·P + (2c1−c2)·P[1] − (c1+c3)·P[2] + c2·US[1] + c3·US[2], c1 = (1 + c2 − c3)/4.
 */
export function ultimateSmoother(x: number[], period = 20): Num[] {
  const { c2, c3 } = poles(period);
  const c1 = (1 + c2 - c3) / 4;
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    out.push(
      i < 3 ? x[i] : (1 - c1) * x[i] + (2 * c1 - c2) * x[i - 1] - (c1 + c3) * x[i - 2] + c2 * out[i - 1] + c3 * out[i - 2],
    );
  }
  return warm(out, Math.min(period, x.length));
}

/**
 * Instantaneous Trendline (Ehlers 2004) mit Auslöser: Trend ohne die Zyklen, Auslöser = 2·IT − IT[2].
 * Auslöser über der Trendlinie = Aufwärtstrend.
 */
export function instantaneousTrend(price: number[], alpha = 0.07): { it: Num[]; trigger: Num[] } {
  const it: number[] = [];
  const a = alpha;
  for (let i = 0; i < price.length; i++) {
    if (i < 6) {
      it.push((price[i] + 2 * ago(price, i, 1) + ago(price, i, 2)) / 4);
      continue;
    }
    it.push(
      (a - (a * a) / 4) * price[i] + 0.5 * a * a * price[i - 1] - (a - 0.75 * a * a) * price[i - 2] +
        2 * (1 - a) * it[i - 1] - (1 - a) * (1 - a) * it[i - 2],
    );
  }
  const trigger = it.map((v, i) => 2 * v - ago(it, i, 2));
  const n = Math.min(12, price.length);
  return { it: warm(it, n), trigger: warm(trigger, n) };
}

export interface Mesa {
  mama: Num[];
  fama: Num[];
  /** Dominanter Zyklus in Balken (Homodyne-Diskriminator, geglättet). */
  period: Num[];
}

/**
 * MESA Adaptive Moving Average (MAMA) und Following AMA (FAMA), Ehlers 2001: Die Glättung passt sich der
 * Phasenänderung des Zyklus an (Hilbert-Transformation). MAMA kreuzt FAMA = Trendwechsel. Nebenbei entsteht
 * die gemessene Zykluslänge (Homodyne-Diskriminator).
 */
export function mesa(price: number[], fastLimit = 0.5, slowLimit = 0.05): Mesa {
  const n = price.length;
  const smooth = new Array<number>(n).fill(0);
  const det = new Array<number>(n).fill(0);
  const i1 = new Array<number>(n).fill(0);
  const q1 = new Array<number>(n).fill(0);
  const i2 = new Array<number>(n).fill(0);
  const q2 = new Array<number>(n).fill(0);
  const re = new Array<number>(n).fill(0);
  const im = new Array<number>(n).fill(0);
  const per = new Array<number>(n).fill(0);
  const sper = new Array<number>(n).fill(0);
  const phase = new Array<number>(n).fill(0);
  const mama = new Array<number>(n).fill(0);
  const fama = new Array<number>(n).fill(0);
  const ht = (xs: number[], i: number, k: number) =>
    (0.0962 * xs[i] + 0.5769 * ago(xs, i, 2) - 0.5769 * ago(xs, i, 4) - 0.0962 * ago(xs, i, 6)) * k;
  for (let i = 0; i < n; i++) {
    if (i < 5) {
      mama[i] = fama[i] = price[i];
      continue;
    }
    const k = 0.075 * per[i - 1] + 0.54;
    smooth[i] = (4 * price[i] + 3 * price[i - 1] + 2 * price[i - 2] + price[i - 3]) / 10;
    det[i] = ht(smooth, i, k);
    // In-Phase und Quadratur
    q1[i] = ht(det, i, k);
    i1[i] = det[i - 3];
    // Phase um 90° vorziehen
    const jI = ht(i1, i, k);
    const jQ = ht(q1, i, k);
    // Phasor addieren (3-Balken-Mittel), dann glätten
    i2[i] = 0.2 * (i1[i] - jQ) + 0.8 * i2[i - 1];
    q2[i] = 0.2 * (q1[i] + jI) + 0.8 * q2[i - 1];
    // Homodyne-Diskriminator
    re[i] = 0.2 * (i2[i] * i2[i - 1] + q2[i] * q2[i - 1]) + 0.8 * re[i - 1];
    im[i] = 0.2 * (i2[i] * q2[i - 1] - q2[i] * i2[i - 1]) + 0.8 * im[i - 1];
    let p = per[i - 1];
    if (im[i] !== 0 && re[i] !== 0) p = 360 / atand(im[i] / re[i]);
    if (p > 1.5 * per[i - 1]) p = 1.5 * per[i - 1];
    if (p < 0.67 * per[i - 1]) p = 0.67 * per[i - 1];
    if (p < 6) p = 6;
    if (p > 50) p = 50;
    per[i] = 0.2 * p + 0.8 * per[i - 1];
    sper[i] = 0.33 * per[i] + 0.67 * sper[i - 1];
    phase[i] = i1[i] !== 0 ? atand(q1[i] / i1[i]) : phase[i - 1];
    let delta = phase[i - 1] - phase[i];
    if (delta < 1) delta = 1;
    let alpha = fastLimit / delta;
    if (alpha < slowLimit) alpha = slowLimit;
    mama[i] = alpha * price[i] + (1 - alpha) * mama[i - 1];
    fama[i] = 0.5 * alpha * mama[i] + (1 - 0.5 * alpha) * fama[i - 1];
  }
  const w = Math.min(32, n); // instabile Anlaufphase (wie TA-Lib)
  return { mama: warm(mama, w), fama: warm(fama, w), period: warm(sper, Math.min(50, n)) };
}

/**
 * FRAMA – Fractal Adaptive Moving Average (Ehlers 2005): misst die fraktale Dimension der letzten ``len``
 * Balken; im Trend folgt die Linie schnell, in Seitwärtsphasen bleibt sie ruhig.
 */
export function frama(high: number[], low: number[], price: number[], len = 16): Num[] {
  const n = len % 2 ? len + 1 : len;
  const half = n / 2;
  const out: number[] = [];
  let dimen = 1;
  const range = (from: number, to: number) => {
    let hh = -Infinity;
    let ll = Infinity;
    for (let k = from; k <= to; k++) {
      if (high[k] > hh) hh = high[k];
      if (low[k] < ll) ll = low[k];
    }
    return hh - ll;
  };
  for (let i = 0; i < price.length; i++) {
    if (i < n) {
      out.push(price[i]);
      continue;
    }
    const n1 = range(i - half + 1, i) / half;
    const n2 = range(i - n + 1, i - half) / half;
    const n3 = range(i - n + 1, i) / n;
    if (n1 > 0 && n2 > 0 && n3 > 0) dimen = (Math.log(n1 + n2) - Math.log(n3)) / Math.log(2);
    let alpha = Math.exp(-4.6 * (dimen - 1));
    alpha = Math.min(1, Math.max(0.01, alpha));
    out.push(alpha * price[i] + (1 - alpha) * out[i - 1]);
  }
  return warm(out, Math.min(n, price.length));
}

/**
 * Decycler (Ehlers, TASC 9/2015): Kurs ohne alle Zyklen kürzer als ``hpPeriod`` – eine fast verzögerungsfreie
 * Trendlinie. Decycle = α/2·(P + P[1]) + (1 − α)·Decycle[1].
 */
export function decycler(x: number[], hpPeriod = 60): Num[] {
  const a = (cosd(360 / hpPeriod) + sind(360 / hpPeriod) - 1) / cosd(360 / hpPeriod);
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) {
    out.push(i === 0 ? x[0] : (a / 2) * (x[i] + x[i - 1]) + (1 - a) * out[i - 1]);
  }
  return warm(out, Math.min(Math.round(hpPeriod / 2), x.length));
}

// --- Oszillatoren (Unterfenster) ----------------------------------------------------------------

/**
 * Fisher Transform (Ehlers 2002): macht die Kurslage im Bereich der letzten ``len`` Balken annähernd
 * normalverteilt – Wendepunkte werden deutlich. Auslöser = Fisher des Vortags.
 */
export function fisherTransform(price: number[], len = 10): { fish: Num[]; trigger: Num[] } {
  const fish: number[] = [];
  let v1 = 0;
  for (let i = 0; i < price.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = Math.max(0, i - len + 1); k <= i; k++) {
      if (price[k] > hi) hi = price[k];
      if (price[k] < lo) lo = price[k];
    }
    const pos = hi > lo ? (price[i] - lo) / (hi - lo) - 0.5 : 0;
    v1 = 0.33 * 2 * pos + 0.67 * v1;
    if (v1 > 0.99) v1 = 0.999;
    if (v1 < -0.99) v1 = -0.999;
    fish.push(0.5 * Math.log((1 + v1) / (1 - v1)) + 0.5 * (i ? fish[i - 1] : 0));
  }
  const trigger = fish.map((_, i) => (i ? fish[i - 1] : fish[0]));
  const w = Math.min(len, price.length);
  return { fish: warm(fish, w), trigger: warm(trigger, w) };
}

/**
 * Laguerre-RSI (Ehlers 2004, „Time Warp“): RSI über vier Laguerre-Filterstufen – kurz und glatt, Werte 0 bis 1.
 * Über 0,8 überkauft, unter 0,2 überverkauft.
 */
export function laguerreRsi(x: number[], gamma = 0.5): Num[] {
  const out: number[] = [];
  let l0 = x[0] ?? 0;
  let l1 = l0;
  let l2 = l0;
  let l3 = l0;
  let rsi = 0.5;
  for (let i = 0; i < x.length; i++) {
    const p0 = l0;
    const p1 = l1;
    const p2 = l2;
    l0 = (1 - gamma) * x[i] + gamma * p0;
    l1 = -gamma * l0 + p0 + gamma * p1;
    l2 = -gamma * l1 + p1 + gamma * p2;
    l3 = -gamma * l2 + p2 + gamma * l3;
    let cu = 0;
    let cd = 0;
    if (l0 >= l1) cu = l0 - l1;
    else cd = l1 - l0;
    if (l1 >= l2) cu += l1 - l2;
    else cd += l2 - l1;
    if (l2 >= l3) cu += l2 - l3;
    else cd += l3 - l2;
    if (cu + cd !== 0) rsi = cu / (cu + cd);
    out.push(rsi);
  }
  return warm(out, Math.min(8, x.length));
}

/**
 * Roofing-Filter (Ehlers, TASC 1/2014): Hochpass (Trend länger als ``hpPeriod`` weg) und SuperSmoother
 * (Rauschen kürzer als ``lpPeriod`` weg) – übrig bleibt der handelbare Zyklus, schwingend um null.
 */
export function roofingFilter(x: number[], hpPeriod = 48, lpPeriod = 10): Num[] {
  const ang = (0.707 * 360) / hpPeriod;
  const a = (cosd(ang) + sind(ang) - 1) / cosd(ang);
  const hp: number[] = [];
  for (let i = 0; i < x.length; i++) {
    hp.push(
      i < 2 ? 0 : (1 - a / 2) * (1 - a / 2) * (x[i] - 2 * x[i - 1] + x[i - 2]) + 2 * (1 - a) * hp[i - 1] - (1 - a) * (1 - a) * hp[i - 2],
    );
  }
  return warm(superSmootherRaw(hp, lpPeriod), Math.min(hpPeriod, x.length));
}

/**
 * Even Better Sinewave (Ehlers 2013): Zyklus nach Hochpass (``duration``) und SuperSmoother, auf seine
 * Leistung normiert – Werte zwischen −1 und +1. Nahe +1 = Zyklus oben, nahe −1 = unten; im Trend klebt die
 * Linie an einem Rand.
 */
export function evenBetterSinewave(x: number[], duration = 40): Num[] {
  const a = (1 - sind(360 / duration)) / cosd(360 / duration);
  const hp: number[] = [];
  for (let i = 0; i < x.length; i++) hp.push(i === 0 ? 0 : 0.5 * (1 + a) * (x[i] - x[i - 1]) + a * hp[i - 1]);
  const { c2, c3 } = poles(10);
  const c1 = 1 - c2 - c3;
  const filt: number[] = [];
  for (let i = 0; i < x.length; i++) filt.push(i < 2 ? 0 : (c1 * (hp[i] + hp[i - 1])) / 2 + c2 * filt[i - 1] + c3 * filt[i - 2]);
  const out = filt.map((_, i) => {
    const f0 = filt[i];
    const f1 = ago(filt, i, 1);
    const f2 = ago(filt, i, 2);
    const wave = (f0 + f1 + f2) / 3;
    const pwr = (f0 * f0 + f1 * f1 + f2 * f2) / 3;
    return pwr > 0 ? wave / Math.sqrt(pwr) : 0;
  });
  return warm(out, Math.min(duration, x.length));
}

/**
 * Reflex und Trendflex (Ehlers, TASC 2/2020): nahezu verzögerungsfreie Oszillatoren. Reflex zeigt den Zyklus
 * (Abweichung von der Verbindungslinie), Trendflex den Trend (Abweichung von früheren Werten); beide auf ihre
 * Schwankung normiert, Nulllinie = neutral.
 */
export function reflexTrendflex(x: number[], len = 20): { reflex: Num[]; trendflex: Num[] } {
  const filt = superSmootherRaw(x, len / 2);
  const reflex: number[] = [];
  const trendflex: number[] = [];
  let msR = 0;
  let msT = 0;
  for (let i = 0; i < x.length; i++) {
    const slope = (ago(filt, i, len) - filt[i]) / len;
    let sumR = 0;
    let sumT = 0;
    for (let k = 1; k <= len; k++) {
      const fk = ago(filt, i, k);
      sumR += filt[i] + k * slope - fk;
      sumT += filt[i] - fk;
    }
    sumR /= len;
    sumT /= len;
    msR = 0.04 * sumR * sumR + 0.96 * msR;
    msT = 0.04 * sumT * sumT + 0.96 * msT;
    reflex.push(msR > 0 ? sumR / Math.sqrt(msR) : 0);
    trendflex.push(msT > 0 ? sumT / Math.sqrt(msT) : 0);
  }
  const w = Math.min(2 * len, x.length);
  return { reflex: warm(reflex, w), trendflex: warm(trendflex, w) };
}

/**
 * Correlation Trend Indicator (Ehlers, TASC 5/2020): Korrelation der letzten ``len`` Kurse mit einer
 * steigenden Geraden. +1 = sauberer Aufwärtstrend, −1 = sauberer Abwärtstrend, um 0 = kein Trend.
 */
export function correlationTrend(x: number[], len = 20): Num[] {
  return x.map((_, i) => {
    if (i < len - 1) return null;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (let k = 0; k < len; k++) {
      const xv = x[i - k];
      const yv = -k;
      sx += xv;
      sy += yv;
      sxx += xv * xv;
      sxy += xv * yv;
      syy += yv * yv;
    }
    const dx = len * sxx - sx * sx;
    const dy = len * syy - sy * sy;
    return dx > 0 && dy > 0 ? (len * sxy - sx * sy) / Math.sqrt(dx * dy) : 0;
  });
}

// --- Auswahl im Kurschart -----------------------------------------------------------------------

export interface OhlcBar {
  high: number;
  low: number;
  close: number;
}

export interface EhlersLine {
  name: string;
  color: string;
  values: Num[];
  dashed?: boolean;
}

export const OVERLAYS = ["off", "ssf", "ultimate", "itrend", "mama", "frama", "decycler"] as const;
export type Overlay = (typeof OVERLAYS)[number];

/** Aussehen der Linien je Auswahl (für den Chartaufbau, bevor Daten da sind; gleiche Farben wie overlayLines). */
export const OVERLAY_STYLE: Record<Overlay, { color: string; dashed?: boolean }[]> = {
  off: [],
  ssf: [{ color: "#4dd0e1" }],
  ultimate: [{ color: "#4dd0e1" }],
  itrend: [{ color: "#4dd0e1" }, { color: "#f06292", dashed: true }],
  mama: [{ color: "#4dd0e1" }, { color: "#f06292" }],
  frama: [{ color: "#4dd0e1" }],
  decycler: [{ color: "#4dd0e1" }],
};

export const OVERLAY_LABEL: Record<Overlay, string> = {
  off: "aus",
  ssf: "SuperSmoother 20",
  ultimate: "UltimateSmoother 20",
  itrend: "Instantaneous Trendline",
  mama: "MAMA / FAMA",
  frama: "FRAMA 16",
  decycler: "Decycler 60",
};

export const OVERLAY_INFO: Record<Overlay, string> = {
  off: "Ehlers-Linien auf dem Kurs: Glättungen aus der Signalverarbeitung mit deutlich weniger Verzögerung als gleitende Durchschnitte.",
  ssf: "SuperSmoother (Ehlers 2013): glättet wie ein 20-Tage-Durchschnitt, folgt dem Kurs aber schneller. Kurs über der Linie = Aufwärtsphase.",
  ultimate: "UltimateSmoother (Ehlers 2024): Kurs minus Hochpass – im Trend praktisch ohne Verzögerung, kurzes Rauschen wird entfernt.",
  itrend: "Instantaneous Trendline (Ehlers 2004) mit Auslöser (gestrichelt): Auslöser über der Trendlinie = Aufwärtstrend, darunter = Abwärtstrend.",
  mama: "MAMA (türkis) und FAMA (rosa, Ehlers 2001): passen ihre Geschwindigkeit dem gemessenen Marktzyklus an. MAMA kreuzt FAMA nach oben = Kaufsignal, nach unten = Verkaufssignal.",
  frama: "FRAMA (Ehlers 2005): misst, wie „gerade“ der Kurs läuft (fraktale Dimension) – im Trend schnell, in Seitwärtsphasen fast flach.",
  decycler: "Decycler (Ehlers 2015): Kurs ohne alle Schwankungen kürzer als 60 Balken – eine ruhige Trendlinie fast ohne Verzögerung.",
};

/** Linien auf dem Kurs für die Auswahl (gleiche Länge wie ``bars``). */
export function overlayLines(kind: Overlay, bars: OhlcBar[]): EhlersLine[] {
  if (kind === "off" || !bars.length) return [];
  const close = bars.map((b) => b.close);
  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  switch (kind) {
    case "ssf":
      return [{ name: "SuperSmoother 20", color: "#4dd0e1", values: superSmoother(close, 20) }];
    case "ultimate":
      return [{ name: "UltimateSmoother 20", color: "#4dd0e1", values: ultimateSmoother(close, 20) }];
    case "itrend": {
      const r = instantaneousTrend(hl2);
      return [
        { name: "Trendlinie", color: "#4dd0e1", values: r.it },
        { name: "Auslöser", color: "#f06292", values: r.trigger, dashed: true },
      ];
    }
    case "mama": {
      const r = mesa(hl2);
      return [
        { name: "MAMA", color: "#4dd0e1", values: r.mama },
        { name: "FAMA", color: "#f06292", values: r.fama },
      ];
    }
    case "frama":
      return [{ name: "FRAMA 16", color: "#4dd0e1", values: frama(bars.map((b) => b.high), bars.map((b) => b.low), hl2, 16) }];
    case "decycler":
      return [{ name: "Decycler 60", color: "#4dd0e1", values: decycler(close, 60) }];
  }
}

export const OSCILLATORS = ["off", "rsi", "fisher", "lrsi", "roof", "ebsw", "reflex", "cti", "cycle"] as const;
export type Oscillator = (typeof OSCILLATORS)[number];

export const OSC_LABEL: Record<Oscillator, string> = {
  off: "aus",
  rsi: "RSI 14",
  fisher: "Fisher Transform 10",
  lrsi: "Laguerre-RSI",
  roof: "Roofing-Filter 48/10",
  ebsw: "Even Better Sinewave 40",
  reflex: "Reflex / Trendflex 20",
  cti: "Correlation Trend 20",
  cycle: "Zykluslänge (MESA)",
};

export const OSC_INFO: Record<Oscillator, string> = {
  off: "Unterfenster unter dem Kurs: RSI oder ein Ehlers-Oszillator.",
  rsi: "RSI 14 (Wilder): über 70 überkauft, unter 30 überverkauft.",
  fisher:
    "Fisher Transform (Ehlers 2002): macht Wendepunkte deutlich. Fisher (lila) kreuzt den Auslöser (orange, Vortag) nach unten = möglicher Hochpunkt, nach oben = möglicher Tiefpunkt; extreme Werte über ±1,5 sind selten.",
  lrsi: "Laguerre-RSI (Ehlers 2004): schneller, glatter RSI zwischen 0 und 1. Über 0,8 überkauft, unter 0,2 überverkauft; Kreuzen von 0,2 nach oben = Kaufsignal.",
  roof: "Roofing-Filter (Ehlers 2014): entfernt den Trend (über 48 Balken) und das Rauschen (unter 10 Balken). Übrig bleibt der Zyklus in Kurseinheiten: über null = obere, unter null = untere Zyklushälfte.",
  ebsw: "Even Better Sinewave (Ehlers 2013): Zyklus zwischen −1 und +1. Wendet die Linie nahe +1 nach unten = Zyklushoch; klebt sie an einem Rand, läuft ein Trend.",
  reflex:
    "Reflex (lila) und Trendflex (orange), Ehlers 2020: fast ohne Verzögerung. Reflex zeigt den Zyklus, Trendflex den Trend; Nulldurchgänge markieren Wendepunkte, Werte sind auf die eigene Schwankung normiert.",
  cti: "Correlation Trend Indicator (Ehlers 2020): wie gerade der Kurs der letzten 20 Balken steigt (+1) oder fällt (−1); um 0 kein Trend.",
  cycle: "Dominanter Zyklus (Ehlers, Homodyne-Diskriminator der MESA-Rechnung): Länge der aktuell vorherrschenden Kursschwingung in Balken (6 bis 50).",
};

/** Linienfarben, Hilfslinien und Nachkommastellen je Unterfenster (für den Chartaufbau). */
export const OSC_STYLE: Record<Oscillator, { colors: string[]; levels: { value: number; color: string }[]; digits: number }> = {
  off: { colors: [], levels: [], digits: 0 },
  rsi: { colors: ["#c77dff"], levels: [{ value: 70, color: "#ff5252" }, { value: 30, color: "#29d17d" }], digits: 0 },
  fisher: { colors: ["#c77dff", "#ffa028"], levels: [{ value: 1.5, color: "#ff5252" }, { value: 0, color: "#555" }, { value: -1.5, color: "#29d17d" }], digits: 2 },
  lrsi: { colors: ["#c77dff"], levels: [{ value: 0.8, color: "#ff5252" }, { value: 0.2, color: "#29d17d" }], digits: 2 },
  roof: { colors: ["#c77dff"], levels: [{ value: 0, color: "#555" }], digits: 2 },
  ebsw: { colors: ["#c77dff"], levels: [{ value: 0.85, color: "#ff5252" }, { value: 0, color: "#555" }, { value: -0.85, color: "#29d17d" }], digits: 2 },
  reflex: { colors: ["#c77dff", "#ffa028"], levels: [{ value: 0, color: "#555" }], digits: 2 },
  cti: { colors: ["#c77dff"], levels: [{ value: 0.5, color: "#555" }, { value: 0, color: "#555" }, { value: -0.5, color: "#555" }], digits: 2 },
  cycle: { colors: ["#c77dff"], levels: [], digits: 1 },
};

export interface OscResult {
  lines: EhlersLine[];
  levels: number[];
  digits: number;
}

/** Oszillator-Linien für das Unterfenster (ohne RSI, der im Kurschart selbst gerechnet wird). */
export function oscillatorLines(kind: Exclude<Oscillator, "off" | "rsi">, bars: OhlcBar[]): OscResult {
  const close = bars.map((b) => b.close);
  const hl2 = bars.map((b) => (b.high + b.low) / 2);
  switch (kind) {
    case "fisher": {
      const r = fisherTransform(hl2, 10);
      return {
        lines: [
          { name: "Fisher", color: "#c77dff", values: r.fish },
          { name: "Auslöser", color: "#ffa028", values: r.trigger },
        ],
        levels: [1.5, 0, -1.5],
        digits: 2,
      };
    }
    case "lrsi":
      return { lines: [{ name: "Laguerre-RSI", color: "#c77dff", values: laguerreRsi(close, 0.5) }], levels: [0.8, 0.2], digits: 2 };
    case "roof":
      return { lines: [{ name: "Roofing-Filter", color: "#c77dff", values: roofingFilter(close) }], levels: [0], digits: close.length && Math.abs(close[close.length - 1]) < 10 ? 4 : 2 };
    case "ebsw":
      return { lines: [{ name: "Sinewave", color: "#c77dff", values: evenBetterSinewave(close, 40) }], levels: [0.85, 0, -0.85], digits: 2 };
    case "reflex": {
      const r = reflexTrendflex(close, 20);
      return {
        lines: [
          { name: "Reflex", color: "#c77dff", values: r.reflex },
          { name: "Trendflex", color: "#ffa028", values: r.trendflex },
        ],
        levels: [0],
        digits: 2,
      };
    }
    case "cti":
      return { lines: [{ name: "Correlation Trend", color: "#c77dff", values: correlationTrend(close, 20) }], levels: [0.5, 0, -0.5], digits: 2 };
    case "cycle":
      return { lines: [{ name: "Zykluslänge", color: "#c77dff", values: mesa(hl2).period }], levels: [], digits: 1 };
  }
}
