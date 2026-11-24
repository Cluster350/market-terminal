// Bilanzbild (Reiter in FA): Bilanzsäulen, Kennzahlen-Ampeln, Strukturbilanz über die Jahre, Schulden gegen Kasse und
// Eigenkapital-Brücke – gezeichnet als SVG, Daten aus denselben Finanzberichten wie die Tabellen in FA.

import { useMemo, useState } from "react";
import { Empty, Spark, useSize } from "../components/ui";
import { equityBridge, kpis, money, splitBalance, type BalanceSplit, type Kpi, type Light, type Segment } from "../lib/balance";
import { useCsvExport } from "../lib/exporter";
import { fmt, fmtDate, isNum } from "../lib/format";
import type { Financials } from "../lib/types";
import { PAL } from "../theme/palette";

const LIGHT_COLOR: Record<Light, string> = { ok: "var(--up)", watch: "var(--warn)", alarm: "var(--down)", none: "var(--dim)" };
/** Dunkle Flächen der Palette: Schrift darauf weiß statt schwarz. */
const DARK_TONES = new Set(["bv-ppe", "bv-gw", "bv-other", "bv-ncl"]);
const inClass = (tone: string) => (DARK_TONES.has(tone) ? "bv-in light" : "bv-in");
const LIGHT_WORD: Record<Light, string> = { ok: "im üblichen Rahmen", watch: "genauer hinsehen", alarm: "auffällig", none: "keine Angabe" };

const yearOf = (p: string, period: Financials["period"]) => (period === "annual" ? p.slice(0, 4) : `Q${Math.ceil(Number(p.slice(5, 7)) / 3)}/${p.slice(2, 4)}`);

// --- Bilanzsäulen ------------------------------------------------------------------------------

/** Außenbeschriftungen untereinander verteilen, damit sich kleine Posten nicht überdecken. */
export function spreadLabels(wanted: number[], gap: number, lo: number, hi: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(wanted.length);
  let prev = lo - gap;
  for (const o of order) {
    const y = Math.max(o.y, prev + gap);
    out[o.i] = y;
    prev = y;
  }
  // unten übergelaufen: von unten her zurückschieben
  let next = hi + gap;
  for (const o of order.slice().reverse()) {
    if (out[o.i] > next - gap) out[o.i] = next - gap;
    next = out[o.i];
  }
  return out;
}

function Column({ segs, x, w, top, scale, side, total }: { segs: Segment[]; x: number; w: number; top: number; scale: number; side: "l" | "r"; total: number }) {
  let y = top;
  const boxes = segs.map((s) => {
    const h = s.value * scale;
    const b = { s, y0: y, h, share: (s.value / total) * 100 };
    y += h;
    return b;
  });
  const ly = spreadLabels(boxes.map((b) => b.y0 + b.h / 2 + 4), 13, top + 8, y);
  const lx = side === "l" ? x - 8 : x + w + 8;
  return (
    <g>
      {boxes.map((b, i) => (
        <g key={b.s.key}>
          <rect x={x} y={b.y0} width={w} height={Math.max(0.5, b.h - 1)} className={`bv-seg ${b.s.tone}`}>
            <title>{`${b.s.label}: ${money(b.s.value)} (${fmt(b.share, 1)} %)\n${b.s.hint}`}</title>
          </rect>
          {b.s.key === "gw" && b.h > 6 && <rect x={x + 2} y={b.y0 + 2} width={w - 4} height={Math.max(0, b.h - 5)} className="bv-gw-dash" />}
          {b.h >= 15 && (
            <text x={x + w / 2} y={b.y0 + b.h / 2 + 4} className={inClass(b.s.tone)} textAnchor="middle">{`${fmt(b.share, 0)} %`}</text>
          )}
          {Math.abs(ly[i] - (b.y0 + b.h / 2 + 4)) > 3 && (
            <line x1={side === "l" ? x - 1 : x + w + 1} x2={side === "l" ? lx + 2 : lx - 2} y1={b.y0 + b.h / 2} y2={ly[i] - 4} className="bv-link" />
          )}
          <text x={lx} y={ly[i]} className="bv-out" textAnchor={side === "l" ? "end" : "start"}>
            <tspan className="bv-lbl">{b.s.label}</tspan>
            <tspan dx="5">{money(b.s.value)}</tspan>
          </text>
        </g>
      ))}
    </g>
  );
}

function Pillars({ s, currency }: { s: BalanceSplit; currency: string | null }) {
  const negEq = s.equity !== null && s.equity <= 0;
  const liab = s.liabilities.reduce((a, x) => a + x.value, 0);
  const H = 250, top = 34, ax = 190, px = 290, w = 76;
  const scale = H / Math.max(s.total, liab);
  // Finanzschulden: schmaler Streifen am rechten Rand der Verbindlichkeiten, von deren Ende nach oben
  const liabEnd = top + s.liabilities.filter((x) => x.key === "cl" || x.key === "ncl").reduce((a, x) => a + x.value, 0) * scale;
  const debtH = s.debt && s.debt > 0 ? Math.min(s.debt * scale, liabEnd - top) : 0;
  return (
    <svg viewBox="0 0 556 322" className="bv-svg bv-pillars" role="img" aria-label="Bilanzsäulen: Aktiva und Passiva">
      <defs>
        {/* Goodwill: Schraffur statt Fläche – kein greifbares Vermögen, erkennbar an der Form statt nur an der Farbe */}
        <pattern id="bv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#000" />
          <rect width="3" height="6" fill={PAL.bsFixed} />
        </pattern>
      </defs>
      <text x={ax + w / 2} y={13} className="bv-head" textAnchor="middle">AKTIVA</text>
      <text x={ax + w / 2} y={26} className="bv-axis" textAnchor="middle">wofür</text>
      <text x={px + w / 2} y={13} className="bv-head" textAnchor="middle">PASSIVA</text>
      <text x={px + w / 2} y={26} className="bv-axis" textAnchor="middle">woher</text>
      <Column segs={s.assets} x={ax} w={w} top={top} scale={scale} side="l" total={s.total} />
      <Column segs={s.liabilities} x={px} w={w} top={top} scale={scale} side="r" total={s.total} />
      {debtH > 0 && (
        <rect x={px + w - 8} y={liabEnd - debtH} width={6} height={debtH} className="bv-debt">
          <title>{`davon Kredite und Anleihen (Finanzschulden): ${money(s.debt)}`}</title>
        </rect>
      )}
      <text x={(ax + px + w) / 2} y={top + H + 16} className="bv-foot" textAnchor="middle">{`Bilanzsumme ${money(s.total)} ${currency ?? ""}`}</text>
      {debtH > 0 && (
        <g transform={`translate(${ax}, ${top + H + 32})`}>
          <rect width={6} height={9} y={-8} className="bv-debt" />
          <text x={10} className="bv-out">{`davon Kredite & Anleihen ${money(s.debt)}`}</text>
        </g>
      )}
      {negEq && (
        <text x={(ax + px + w) / 2} y={top + H + 32} className="bv-alarm" textAnchor="middle">
          {`Eigenkapital negativ (${money(s.equity)}): Schulden übersteigen das Vermögen`}
        </text>
      )}
    </svg>
  );
}

// --- Ampeln -------------------------------------------------------------------------------------

function KpiRow({ k, labels }: { k: Kpi; labels: string[] }) {
  const v = k.values[0];
  const shown = k.unit === "pct" ? (isNum(v) ? `${fmt(v, 0)} %` : "–") : isNum(v) ? (k.key === "lev" && v === 0 ? "Nettokasse" : `${fmt(v, 1)}${k.key === "lev" ? "×" : ""}`) : "–";
  const series = k.values.slice().reverse();
  const hist = labels
    .slice()
    .reverse()
    .map((l, i) => `${l}: ${isNum(series[i]) ? (k.unit === "pct" ? `${fmt(series[i]!, 0)} %` : fmt(series[i]!, 1)) : "–"}`)
    .join(" · ");
  return (
    <div className="bv-kpi" title={`${k.hint}\n${hist}`}>
      <span className="bv-lamp" style={{ background: LIGHT_COLOR[k.light] }} aria-label={LIGHT_WORD[k.light]} />
      <div className="bv-kpi-main">
        <div className="bv-kpi-label">{k.label}</div>
        <div className="bv-kpi-value" style={{ color: LIGHT_COLOR[k.light] }}>{shown}</div>
        <div className="bv-kpi-text">{k.text}</div>
      </div>
      <Spark data={series.filter(isNum)} width={96} height={30} color={LIGHT_COLOR[k.light]} />
    </div>
  );
}

// --- Strukturbilanz über die Jahre ---------------------------------------------------------------

function Structure({ splits, labels }: { splits: (BalanceSplit | null)[]; labels: string[] }) {
  const items = splits.map((s, i) => ({ s, l: labels[i] })).filter((x) => x.s).reverse() as { s: BalanceSplit; l: string }[];
  if (items.length < 2) return <div className="bv-empty">Zu wenig Perioden für einen Verlauf.</div>;
  const x0 = 40, H = 190, top = 10, slot = Math.min(64, 340 / items.length), bw = slot * 0.7;
  const parts = (s: BalanceSplit) => {
    const total = s.liabilities.reduce((a, x) => a + x.value, 0);
    return s.liabilities.slice().reverse().map((x) => ({ ...x, share: (x.value / total) * 100 })); // Eigenkapital unten
  };
  return (
    <svg viewBox="0 0 400 235" className="bv-svg" role="img" aria-label="Strukturbilanz über die Perioden">
      {[0, 50, 100].map((p) => (
        <g key={p}>
          <line x1={x0 - 4} x2={x0 + items.length * slot} y1={top + H - (p / 100) * H} y2={top + H - (p / 100) * H} className="bv-grid" />
          <text x={x0 - 8} y={top + H - (p / 100) * H + 4} className="bv-axis" textAnchor="end">{`${p} %`}</text>
        </g>
      ))}
      {items.map(({ s, l }, i) => {
        let y = top + H;
        const x = x0 + i * slot + (slot - bw) / 2;
        return (
          <g key={s.period}>
            {parts(s).map((p) => {
              const h = (p.share / 100) * H;
              y -= h;
              return (
                <g key={p.key}>
                  <rect x={x} y={y} width={bw} height={Math.max(0.5, h - 1)} className={`bv-seg ${p.tone}`}>
                    <title>{`${l} · ${p.label}: ${fmt(p.share, 1)} % (${money(p.value)})`}</title>
                  </rect>
                  {p.key === "eq" && h >= 14 && (
                    <text x={x + bw / 2} y={y + h / 2 + 4} className={inClass(p.tone)} textAnchor="middle">{fmt(p.share, 0)}</text>
                  )}
                </g>
              );
            })}
            {s.equity !== null && s.equity <= 0 && <text x={x + bw / 2} y={top + H - 6} className="bv-alarm" textAnchor="middle">EK&lt;0</text>}
            <text x={x + bw / 2} y={top + H + 15} className="bv-axis" textAnchor="middle">{l}</text>
          </g>
        );
      })}
      <g transform={`translate(${x0}, 230)`}>
        <rect width={8} height={8} y={-8} className="bv-eq" /><text x={12} className="bv-axis">Eigenkapital (Zahl = Quote)</text>
        <rect x={190} width={8} height={8} y={-8} className="bv-ncl" /><text x={202} className="bv-axis">langfristig</text>
        <rect x={280} width={8} height={8} y={-8} className="bv-cl" /><text x={292} className="bv-axis">kurzfristig</text>
      </g>
    </svg>
  );
}

/** Runde Obergrenze für Achsen: 1, 2, 2,5, 5 × 10^n. */
export function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

// --- Schulden gegen Kasse ------------------------------------------------------------------------

function DebtCash({ f, labels, lev }: { f: Financials; labels: string[]; lev: Kpi }) {
  const n = f.periods.length;
  const debt = f.balance.find((r) => r.key === "shortLongTermDebtTotal")?.values ?? [];
  const cash = f.balance.find((r) => r.key === "cash")?.values ?? [];
  const idx = Array.from({ length: n }, (_, i) => n - 1 - i).filter((i) => isNum(debt[i]) || isNum(cash[i]));
  if (idx.length < 2) return <div className="bv-empty">Keine Angaben zu Schulden und Kasse.</div>;
  const max = niceCeil(Math.max(1, ...idx.flatMap((i) => [debt[i] ?? 0, cash[i] ?? 0])));
  const x0 = 64, H = 170, top = 28, slot = Math.min(60, 340 / idx.length), bw = Math.min(18, slot * 0.36);
  return (
    <svg viewBox="0 0 400 235" className="bv-svg" role="img" aria-label="Finanzschulden gegen liquide Mittel">
      <text x={x0} y={12} className="bv-axis">Zahl oben: Nettoschulden ÷ EBITDA (Jahre zum Tilgen)</text>
      {[0, 0.5, 1].map((p) => (
        <g key={p}>
          <line x1={x0 - 4} x2={x0 + idx.length * slot} y1={top + H - p * H} y2={top + H - p * H} className="bv-grid" />
          <text x={x0 - 8} y={top + H - p * H + 4} className="bv-axis" textAnchor="end">{money(max * p)}</text>
        </g>
      ))}
      {idx.map((i, k) => {
        const x = x0 + k * slot + (slot - 2 * bw - 3) / 2;
        const hd = ((debt[i] ?? 0) / max) * H, hc = ((cash[i] ?? 0) / max) * H;
        const r = lev.values[i];
        return (
          <g key={f.periods[i]}>
            <rect x={x} y={top + H - hd} width={bw} height={hd} className="bv-ncl"><title>{`${labels[i]} · Finanzschulden ${money(debt[i])}`}</title></rect>
            <rect x={x + bw + 3} y={top + H - hc} width={bw} height={hc} className="bv-cash"><title>{`${labels[i]} · Liquide Mittel ${money(cash[i])}`}</title></rect>
            <text x={x + bw + 1} y={top + H - Math.max(hd, hc) - 5} className="bv-ratio" textAnchor="middle" style={{ fill: isNum(r) && r > 3.5 ? "var(--down)" : isNum(r) && r > 2 ? "var(--warn)" : undefined }}>
              {isNum(r) ? (r === 0 ? "Kasse" : `${fmt(r, 1)}×`) : ""}
            </text>
            <text x={x + bw + 1} y={top + H + 15} className="bv-axis" textAnchor="middle">{labels[i]}</text>
          </g>
        );
      })}
      <g transform={`translate(${x0}, 230)`}>
        <rect width={8} height={8} y={-8} className="bv-ncl" /><text x={12} className="bv-axis">Finanzschulden</text>
        <rect x={120} width={8} height={8} y={-8} className="bv-cash" /><text x={132} className="bv-axis">Liquide Mittel</text>
      </g>
    </svg>
  );
}

// --- Eigenkapital-Brücke --------------------------------------------------------------------------

function Bridge({ f }: { f: Financials }) {
  const steps = equityBridge(f);
  if (!steps) return <div className="bv-empty">Die Eigenkapital-Brücke gibt es nur in der jährlichen Ansicht.</div>;
  let run = 0;
  const bars = steps.map((s) => {
    let a: number, b: number;
    if (s.kind === "total") { a = 0; b = s.value; run = s.value; } else { a = run; b = run + s.value; run = b; }
    return { ...s, a, b };
  });
  const lo = Math.min(0, ...bars.map((x) => Math.min(x.a, x.b))), hi = Math.max(...bars.map((x) => Math.max(x.a, x.b)));
  const H = 170, top = 18, x0 = 10, slot = 540 / bars.length, bw = Math.min(70, slot * 0.62);
  const y = (v: number) => top + H - ((v - lo) / (hi - lo || 1)) * H;
  return (
    <svg viewBox="0 0 560 225" className="bv-svg bv-bridge" role="img" aria-label="Eigenkapital-Brücke">
      <line x1={x0} x2={550} y1={y(0)} y2={y(0)} className="bv-grid" />
      {bars.map((s, i) => {
        const x = x0 + i * slot + (slot - bw) / 2;
        const cls = s.kind === "total" ? "bv-total" : s.kind === "up" ? "bv-up" : "bv-down";
        return (
          <g key={s.label}>
            <rect x={x} y={y(Math.max(s.a, s.b))} width={bw} height={Math.max(1, Math.abs(y(s.a) - y(s.b)))} className={cls}>
              <title>{`${s.label}: ${money(s.value)}`}</title>
            </rect>
            {i < bars.length - 1 && <line x1={x + bw} x2={x + slot} y1={y(s.b)} y2={y(s.b)} className="bv-link" />}
            <text x={x + bw / 2} y={y(Math.max(s.a, s.b)) - 5} className="bv-ratio" textAnchor="middle">
              {s.kind === "total" ? money(s.value) : `${s.value > 0 ? "+" : ""}${money(s.value)}`}
            </text>
            <text x={x + bw / 2} y={top + H + 16} className="bv-axis" textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// --- Gesamtansicht ---------------------------------------------------------------------------------

export function BalancePicture({ f }: { f: Financials }) {
  const [sel, setSel] = useState(0);
  const [ref, size] = useSize<HTMLDivElement>();
  const wide = size.w >= 900;
  const labels = useMemo(() => f.periods.map((p) => yearOf(p, f.period)), [f]);
  const splits = useMemo(() => f.periods.map((_, i) => splitBalance(f, i)), [f]);
  const ks = useMemo(() => kpis(f), [f]);
  const i = Math.min(sel, f.periods.length - 1);
  const s = splits[i];

  useCsvExport(() => [
    {
      title: `Bilanzbild ${f.ticker} – Kennzahlen`,
      columns: ["Kennzahl", ...labels.slice().reverse()],
      rows: ks.map((k) => [k.label, ...k.values.slice().reverse().map((v) => (isNum(v) ? Number(v.toFixed(3)) : null))]),
    },
    ...(s ? [{
      title: `Bilanzbild ${f.ticker} – Aufteilung ${labels[i]} (${f.currency ?? ""})`,
      columns: ["Seite", "Posten", "Betrag", "Anteil %"],
      rows: [...s.assets.map((x) => ["Aktiva", x.label, x.value, Number(((x.value / s.total) * 100).toFixed(2))]),
        ...s.liabilities.map((x) => ["Passiva", x.label, x.value, Number(((x.value / s.total) * 100).toFixed(2))])],
    }] : []),
  ]);

  if (!splits.some(Boolean)) return <Empty>Für diesen Wert liefert die Datenquelle keine Bilanz.</Empty>;
  return (
    <div className="bv" ref={ref}>
      <div className={`bv-grid2${wide ? " wide" : ""}`}>
        <section>
          <div className="section-title bv-title">
            <span>Bilanz {labels[i]}</span>
            <span className="bv-chips" role="group" aria-label="Periode">
              {labels.slice().reverse().map((l, k) => {
                const idx = labels.length - 1 - k;
                return (
                  <button key={l} type="button" aria-pressed={idx === i} disabled={!splits[idx]} onClick={() => setSel(idx)}>{l}</button>
                );
              })}
            </span>
          </div>
          {s ? <Pillars s={s} currency={f.currency} /> : <div className="bv-empty">Für {labels[i]} fehlt die Bilanz.</div>}
          <div className="bv-note">Stichtag {fmtDate(f.periods[i])}. Höhe = Anteil an der Bilanzsumme. Goodwill gestrichelt: Firmenwert aus Zukäufen, kein greifbares Vermögen.</div>
        </section>
        <section>
          <div className="section-title">Kennzahlen · Ampel und Verlauf</div>
          <div className="bv-kpis">{ks.map((k) => <KpiRow key={k.key} k={k} labels={labels} />)}</div>
          <div className="bv-note">Grün = im üblichen Rahmen, Gelb = genauer hinsehen, Rot = auffällig. Die Schwellen sind Faustregeln für Industrie- und Handelsfirmen; Banken, Versicherer und Immobilienfirmen sind anders gebaut.</div>
        </section>
        <section>
          <div className="section-title">Wer finanziert die Firma? · Passiva in % über die Zeit</div>
          <Structure splits={splits} labels={labels} />
        </section>
        <section>
          <div className="section-title">Schulden gegen Kasse</div>
          <DebtCash f={f} labels={labels} lev={ks.find((k) => k.key === "lev")!} />
        </section>
        <section className={wide ? "bv-span" : undefined}>
          <div className="section-title">Eigenkapital-Brücke · was aus dem Gewinn wurde</div>
          <Bridge f={f} />
          <div className="bv-note">Sonstiges: Währungseffekte, Bewertungen, Aktienvergütung u. a. – der Rest bis zum neuen Eigenkapital.</div>
        </section>
      </div>
    </div>
  );
}
