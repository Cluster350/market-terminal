// RRG – relative Rotation: Wer läuft besser als der Maßstab, und nimmt das zu oder ab?
// Sektoren, Firmen in einem Sektor, Länderindizes und Währungen; Schweife der letzten Wochen, abspielbar.

import { useEffect, useMemo, useState } from "react";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Empty, ErrorState, Loading, Seg } from "../components/ui";
import { IS_STATIC } from "../lib/api";
import { fmt, fmtDate, isNum, sectorDe } from "../lib/format";
import { isOneOf, usePersistentState } from "../lib/persist";
import { useCsvExport } from "../lib/exporter";
import {
  axisSpan,
  clockwiseText,
  headingArrow,
  headingOf,
  QUADRANT_COLOR,
  QUADRANT_LABEL,
  quadrantOf,
  rotationTestText,
  tail,
  useRotation,
  type RotationResult,
  type Universe,
} from "../lib/rotation";
import { useWorkspace } from "../state/workspace";
import type { ScreenProps } from "./types";

const SECTORS = [
  "Technology", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
  "Healthcare", "Industrials", "Basic Materials", "Real Estate", "Utilities",
];
const PALETTE = ["#ffa028", "#66b8ff", "#29d17d", "#c77dff", "#ff5252", "#f2c200", "#4dd0e1", "#ff8ad8", "#a0e060", "#d8d8d8", "#ff7043", "#7986cb", "#80cbc4", "#bcaaa4"];
const pct = (x: number | null | undefined) => (isNum(x) ? `${x >= 0 ? "+" : "−"}${fmt(Math.abs(x * 100), 1)} %` : "–");
const tone = (x: number | null | undefined) => (isNum(x) ? (x > 0.0005 ? "up" : x < -0.0005 ? "down" : "") : "");

const ROW_LABEL: Record<Universe, string> = { sectors: "Sektor", sector: "Firma", countries: "Land", currencies: "Währung", crypto: "Coin", factors: "Faktor" };

export function RRG(_: ScreenProps) {
  const ws = useWorkspace();
  const [universe, setUniverse] = usePersistentState<Universe>("rrg.universe", "sectors", isOneOf(["sectors", "sector", "countries", "currencies", "crypto", "factors"] as const));
  const [region, setRegion] = usePersistentState<"us" | "eu" | "all">("rrg.region", "us", isOneOf(["us", "eu", "all"] as const));
  const [sector, setSector] = usePersistentState<string>("rrg.sector", "Technology", (x): x is string => typeof x === "string" && SECTORS.includes(x));
  const [ccy, setCcy] = usePersistentState<"eur" | "local">("rrg.ccy", "eur", isOneOf(["eur", "local"] as const));
  const [bench, setBench] = usePersistentState<"basket" | "eur" | "btc">("rrg.bench", "basket", isOneOf(["basket", "eur", "btc"] as const));
  const [tailLen, setTailLen] = usePersistentState<string>("rrg.tail", "8", isOneOf(["4", "8", "12", "20"] as const));
  const [end, setEnd] = useState<number | null>(null); // Woche, bis zu der gezeigt wird (null = aktuell)
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const q = useRotation({ universe, region, sector: universe === "sector" ? sector : undefined, ccy, bench });
  const r = q.data;
  const last = r ? r.weeks.length - 1 : 0;
  const at = end === null ? last : Math.min(end, last);
  const len = Number(tailLen);

  // CSV: alle Wochenwerte (RS-Trend und RS-Momentum je Mitglied), zusätzlich zur Tabelle im Panel
  useCsvExport(() => {
    if (!r || !r.weeks.length) return [];
    const rows = r.members.flatMap((m) =>
      r.weeks.map((w, i) => {
        const qd = quadrantOf(m.trend[i], m.momentum[i]);
        return [w, m.label, m.ticker ?? m.key, m.trend[i], m.momentum[i], qd ? QUADRANT_LABEL[qd] : null];
      }),
    );
    return [
      {
        title: `Relative Rotation ${r.title} – Wochenwerte gegen ${r.benchmark}`,
        columns: ["Woche", "Name", "Kürzel", "RS-Trend", "RS-Momentum", "Feld"],
        rows,
      },
    ];
  });

  // Abspielen: Woche für Woche über die letzten zwei Jahre
  useEffect(() => {
    if (!playing || !r) return;
    const id = setInterval(() => {
      setEnd((e) => {
        const cur = e === null ? len : e + 1;
        if (cur >= last) {
          setPlaying(false);
          return null;
        }
        return cur;
      });
    }, 350);
    return () => clearInterval(id);
  }, [playing, r, last, len]);

  useEffect(() => {
    setEnd(null);
    setFocus(null);
  }, [universe, region, sector, ccy, bench]);

  if (IS_STATIC) return <Empty>Die Rotation braucht den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;

  const openMember = (key: string) => {
    const m = r?.members.find((x) => x.key === key);
    if (!m) return;
    if (r?.universe === "sectors") {
      setSector(m.key);
      setUniverse("sector");
    } else if (m.ticker) {
      ws.setSecurity(m.ticker, { open: "GP" });
    }
  };

  return (
    <>
      <div className="toolbar">
        <Seg
          label="Bereich"
          value={universe}
          options={[
            { value: "sectors", label: "Sektoren" },
            { value: "sector", label: "Im Sektor" },
            { value: "countries", label: "Länder" },
            { value: "currencies", label: "Währungen" },
            { value: "crypto", label: "Krypto" },
            { value: "factors", label: "Faktoren" },
          ]}
          onChange={setUniverse}
        />
        {(universe === "sectors" || universe === "sector") && (
          <Seg
            label="Region"
            value={region}
            options={[
              { value: "us", label: "USA" },
              { value: "eu", label: "Europa" },
              { value: "all", label: "beide" },
            ]}
            onChange={setRegion}
          />
        )}
        {universe === "sector" && (
          <select className="field" aria-label="Sektor" value={sector} onChange={(e) => setSector(e.target.value)}>
            {SECTORS.map((s) => (
              <option key={s} value={s}>
                {sectorDe(s)}
              </option>
            ))}
          </select>
        )}
        {universe === "countries" && (
          <Seg
            label="Währung"
            value={ccy}
            options={[
              { value: "eur", label: "in Euro" },
              { value: "local", label: "Landeswährung" },
            ]}
            onChange={setCcy}
          />
        )}
        {universe === "currencies" && (
          <Seg
            label="Maßstab"
            value={bench === "btc" ? "basket" : bench}
            options={[
              { value: "basket", label: "gegen Korb" },
              { value: "eur", label: "gegen Euro" },
            ]}
            onChange={setBench}
          />
        )}
        {universe === "crypto" && (
          <Seg
            label="Maßstab"
            value={bench === "eur" ? "basket" : bench}
            options={[
              { value: "basket", label: "gegen Korb" },
              { value: "btc", label: "gegen Bitcoin" },
            ]}
            onChange={setBench}
          />
        )}
        {universe === "factors" && (
          <Seg
            label="Region"
            value={region === "eu" ? "eu" : "us"}
            options={[
              { value: "us", label: "USA" },
              { value: "eu", label: "Europa" },
            ]}
            onChange={setRegion}
          />
        )}
        <label className="small muted" title="Wie viele Wochen der Schweif zurückreicht">
          Schweif{" "}
          <select className="field" value={tailLen} onChange={(e) => setTailLen(e.target.value)}>
            {["4", "8", "12", "20"].map((v) => (
              <option key={v} value={v}>
                {v} Wochen
              </option>
            ))}
          </select>
        </label>
        {r && r.weeks.length > 0 && (
          <span className="rrg-play">
            <button type="button" className="tool" title={playing ? "Anhalten" : "Rotation der letzten zwei Jahre abspielen"} onClick={() => setPlaying((p) => !p)}>
              {playing ? "⏸" : "▶"}
            </button>
            <input
              type="range"
              min={Math.min(len, last)}
              max={last}
              value={at}
              aria-label="Woche"
              onChange={(e) => {
                setPlaying(false);
                const v = Number(e.target.value);
                setEnd(v >= last ? null : v);
              }}
            />
            <span className="small muted">bis {fmtDate(r.weeks[at])}</span>
          </span>
        )}
      </div>
      <div className="panel-body flush">
        {q.isPending ? (
          <Loading rows={8} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !r || r.state === "building" ? (
          <Empty>Sektordaten werden berechnet (Bewertungstrend) … einen Moment.</Empty>
        ) : !r.members.length ? (
          <Empty>Keine Daten für diese Auswahl.</Empty>
        ) : (
          <>
            <div className="rrg-body">
              <div className="rrg-chart">
                <RrgChart r={r} at={at} len={len} focus={focus} onPick={(k) => setFocus((f) => (f === k ? null : k))} />
              </div>
              <RrgTable r={r} at={at} len={len} focus={focus} onFocus={setFocus} onOpen={openMember} />
            </div>
            <div className="notes">
              <div>
                <b>{r.title}</b> gegen {r.benchmark}. {rotationTestText(r.test)}
              </div>
              <div>{clockwiseText(r.test)}</div>
              <div className="dim">
                {r.note}
                {r.skipped.length ? ` Nicht enthalten: ${r.skipped.join(", ")}.` : ""}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function rrgOption(r: RotationResult, at: number, len: number, focus: string | null): EOption {
  const tails = r.members.map((m) => ({ m, pts: tail(m, at, len) }));
  const span = axisSpan(tails.flatMap((x) => x.pts.flatMap((p) => [p.trend, p.mom])));
  const lo = 100 - span;
  const hi = 100 + span;
  const series: unknown[] = [
    {
      type: "line", data: [[100, 100]], silent: true, symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false },
      markArea: {
        silent: true,
        data: [
          [{ coord: [100, 100], itemStyle: { color: "rgba(41,209,125,0.10)" } }, { coord: [hi, hi] }],
          [{ coord: [100, lo], itemStyle: { color: "rgba(242,194,0,0.08)" } }, { coord: [hi, 100] }],
          [{ coord: [lo, lo], itemStyle: { color: "rgba(255,82,82,0.09)" } }, { coord: [100, 100] }],
          [{ coord: [lo, 100], itemStyle: { color: "rgba(102,184,255,0.10)" } }, { coord: [100, hi] }],
        ],
      },
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#3a3a3a" }, label: { show: false }, data: [{ xAxis: 100 }, { yAxis: 100 }] },
    },
  ];
  tails.forEach(({ m, pts }, idx) => {
    if (!pts.length) return;
    const color = PALETTE[idx % PALETTE.length];
    const dim = focus !== null && focus !== m.key;
    const hd = headingOf(pts);
    series.push({
      name: m.label,
      type: "line",
      data: pts.map((p, j) => {
        const head = j === pts.length - 1;
        return {
          value: [p.trend, p.mom],
          week: r.weeks[p.i],
          key: m.key,
          symbol: head ? (hd === null ? "circle" : "arrow") : "circle",
          symbolSize: head ? 13 : 4,
          symbolRotate: head && hd !== null ? hd - 90 : 0,
          label: head ? { show: true, position: "right", formatter: m.label.length > 22 ? `${m.label.slice(0, 20)}…` : m.label, color: dim ? "#5c5c5c" : "#ececec", fontSize: 10 } : undefined,
        };
      }),
      lineStyle: { color, width: focus === m.key ? 2.5 : 1.5, opacity: dim ? 0.18 : 0.9 },
      itemStyle: { color, opacity: dim ? 0.18 : 1 },
      z: focus === m.key ? 10 : 3,
    });
  });
  return {
    animation: false,
    grid: { left: 52, right: 110, top: 22, bottom: 40 },
    tooltip: {
      ...TOOLTIP,
      trigger: "item",
      formatter: (p: { seriesName: string; data: { value: [number, number]; week: string } }) =>
        p.data?.value
          ? `${p.seriesName}<br/>Woche bis ${fmtDate(p.data.week)}<br/>Trend ${fmt(p.data.value[0], 2)} · Schwung ${fmt(p.data.value[1], 2)}<br/>${QUADRANT_LABEL[quadrantOf(p.data.value[0], p.data.value[1])!]}`
          : "",
    },
    xAxis: {
      type: "value", min: lo, max: hi, name: "schwächer als der Maßstab  ←  Trend der relativen Stärke  →  stärker", nameLocation: "middle", nameGap: 24,
      nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 1) },
    },
    yAxis: {
      type: "value", min: lo, max: hi, name: "Schwung (nimmt zu ↑ / ab ↓)", nameLocation: "middle", nameGap: 38,
      nameTextStyle: { color: "#8f8f8f", fontSize: 10 }, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 1) },
    },
    graphic: [
      { type: "text", right: 118, top: 26, style: { text: "FÜHREND", fill: "#29d17d", fontSize: 11, fontWeight: "bold", align: "right" } },
      { type: "text", right: 118, bottom: 48, style: { text: "SCHWÄCHER WERDEND", fill: "#f2c200", fontSize: 11, fontWeight: "bold", align: "right" } },
      { type: "text", left: 60, bottom: 48, style: { text: "NACHZÜGLER", fill: "#ff5252", fontSize: 11, fontWeight: "bold" } },
      { type: "text", left: 60, top: 26, style: { text: "ERHOLEND", fill: "#66b8ff", fontSize: 11, fontWeight: "bold" } },
    ],
    series,
  } as EOption;
}

function RrgChart({ r, at, len, focus, onPick }: { r: RotationResult; at: number; len: number; focus: string | null; onPick: (key: string) => void }) {
  const option = useMemo(() => rrgOption(r, at, len, focus), [r, at, len, focus]);
  return <EChart option={option} csv={false} onClick={(p) => (p.data as { key?: string } | undefined)?.key && onPick((p.data as { key: string }).key)} />;
}

function RrgTable({ r, at, len, focus, onFocus, onOpen }: { r: RotationResult; at: number; len: number; focus: string | null; onFocus: (k: string | null) => void; onOpen: (k: string) => void }) {
  const rows = r.members
    .map((m) => {
      const pts = tail(m, at, len);
      const lastPt = pts[pts.length - 1];
      return { m, pts, trend: lastPt?.trend ?? null, mom: lastPt?.mom ?? null, q: quadrantOf(lastPt?.trend, lastPt?.mom), hd: headingOf(pts) };
    })
    .sort((a, b) => (b.trend ?? -1e9) - (a.trend ?? -1e9));
  const showFair = r.universe === "sectors" || r.universe === "sector";
  const current = at === r.weeks.length - 1;
  return (
    <div className="rrg-table">
      <table className="t" data-export-title="Stand je Mitglied">
        <thead>
          <tr>
            <th>{ROW_LABEL[r.universe]}</th>
            <th>Feld</th>
            <th className="num" title="Trend der relativen Stärke (über 100: besser als der Maßstab)">Trend</th>
            <th className="num" title="Schwung (über 100: der Trend nimmt zu)">Schwung</th>
            <th title="Richtung der letzten Woche; nach rechts oben ist am stärksten">Ri.</th>
            {current && <th className="num" title="Entwicklung gegenüber dem Maßstab in 4 Wochen">4 W</th>}
            {current && <th className="num" title="Entwicklung gegenüber dem Maßstab in 13 Wochen">13 W</th>}
            {showFair && current && <th className="num" title="Abstand zum Fair Value aus dem Bewertungstrend (übliches KGV × Gewinnschätzung)">Bewertung</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, trend, mom, q, hd }) => (
            <tr
              key={m.key}
              className={`clickable ${focus === m.key ? "selected" : ""}`}
              onMouseEnter={() => onFocus(m.key)}
              onMouseLeave={() => onFocus(null)}
              onClick={() => onOpen(m.key)}
              title={r.universe === "sectors" ? "Klick: Firmen dieses Sektors zeigen" : m.ticker ? "Klick: Kurschart öffnen" : undefined}
            >
              <td>
                {m.label}
                {m.detail && r.universe === "sector" ? <span className="muted xs"> {m.detail}</span> : null}
              </td>
              <td>{q ? <span style={{ color: QUADRANT_COLOR[q] }}>{QUADRANT_LABEL[q]}</span> : "–"}</td>
              <td className="num">{fmt(trend, 2)}</td>
              <td className="num">{fmt(mom, 2)}</td>
              <td style={{ color: q ? QUADRANT_COLOR[q] : undefined }}>{headingArrow(hd)}</td>
              {current && <td className={`num ${tone(m.rel4)}`}>{pct(m.rel4)}</td>}
              {current && <td className={`num ${tone(m.rel13)}`}>{pct(m.rel13)}</td>}
              {showFair && current && <td className={`num ${tone(m.fairGap)}`}>{isNum(m.fairGap) ? pct(m.fairGap) : "–"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
