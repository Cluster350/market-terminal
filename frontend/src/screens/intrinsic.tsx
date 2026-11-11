// DCF – innerer Wert je Aktie nach Aswath Damodarans veröffentlichter Methode, mit Story-Hebeln, Bandbreite,
// Rückwärts-DCF und der KI-Persona „Damodaran“. Gerechnet wird im Rechenkern; die KI ordnet ein und schlägt Hebel vor
// (übernommen wird erst per Klick).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import EChart, { AXIS, TOOLTIP, type EOption } from "../components/EChart";
import { Empty, ErrorState, Loading } from "../components/ui";
import { aiErrorText, engineLabel } from "../lib/ai";
import { IS_STATIC } from "../lib/api";
import { useCsvExport } from "../lib/exporter";
import { DASH, displayTicker, fmt, fmtBig, fmtPct, fmtPrice, isNum, tone } from "../lib/format";
import {
  askCoach,
  changedLevers,
  distAxisBounds,
  inputToLever,
  leverToInput,
  leverAlreadySent,
  parseLeverInput,
  useIntrinsic,
  type CoachResult,
  type IntrinsicResult,
  type IvLever,
  type IvRow,
  type Levers,
} from "../lib/intrinsic";
import { AnswerText } from "./ai";
import type { ScreenProps } from "./types";

const pct = (x: number | null | undefined, d = 1) => (isNum(x) ? `${fmt(x * 100, d)} %` : DASH);
const signedPct = (x: number | null | undefined, d = 1) => (isNum(x) ? fmtPct(x * 100, d) : DASH);

function rowValue(r: IvRow): string {
  if (r.unit === "text") return r.text ?? DASH;
  if (r.value === null) return DASH;
  if (r.unit === "pct") return pct(r.value, 2);
  if (r.unit === "x") return `${fmt(r.value, 2)}×`;
  if (r.unit === "num") return Math.abs(r.value) >= 1e5 ? fmtBig(r.value) : fmt(r.value, 2);
  return fmtBig(r.value);
}

function RowTable({ rows, title }: { rows: IvRow[]; title: string }) {
  if (!rows.length) return null;
  return (
    <table className="t dcf-rows" data-export-title={title}>
      <tbody>
        {rows.map((r, i) =>
          r.unit === "text" ? (
            <tr key={i}>
              <td>{r.label}</td>
              <td colSpan={2} className="muted dcf-note">
                {r.text}
              </td>
            </tr>
          ) : (
            <tr key={i} className={r.label.startsWith("=") ? "dcf-sum" : undefined}>
              <td>{r.label}</td>
              <td className="num">{rowValue(r)}</td>
              <td className="muted dcf-note">{r.note || r.text}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function Block({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="dcf-block">
      <div className="section-title" title={hint}>
        {title}
      </div>
      {children}
    </div>
  );
}

function distOption(d: NonNullable<IntrinsicResult["distribution"]>, value: number | null, price: number | null, cur: string): EOption | null {
  if (!d.bins.length) return null;
  const mid = d.bins.map((b) => (b.lo + b.hi) / 2);
  const marks: Record<string, unknown>[] = [];
  if (isNum(price)) marks.push({ xAxis: price, lineStyle: { color: "#ffa028", width: 2 }, label: { formatter: `Kurs ${fmt(price, 2)}`, color: "#ffa028" } });
  if (isNum(value)) marks.push({ xAxis: value, lineStyle: { color: "#ececec", width: 1.5 }, label: { formatter: `Wert ${fmt(value, 2)}`, color: "#ececec" } });
  if (isNum(d.p10)) marks.push({ xAxis: d.p10, lineStyle: { color: "#777", type: "dashed" }, label: { formatter: "P10", color: "#888" } });
  if (isNum(d.p90)) marks.push({ xAxis: d.p90, lineStyle: { color: "#777", type: "dashed" }, label: { formatter: "P90", color: "#888" } });
  const bounds = distAxisBounds(d.bins, [price, value]); // Kurs und Wert immer im sichtbaren Bereich
  return {
    animation: false,
    grid: { left: 36, right: 14, top: 26, bottom: 24 },
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: (ps: unknown) => {
        const p = (ps as { dataIndex: number }[])[0];
        const b = d.bins[p?.dataIndex ?? 0];
        return b ? `${fmt(b.lo, 2)} – ${fmt(b.hi, 2)} ${cur}<br/>${b.n} von ${d.runs} Läufen` : "";
      },
    },
    xAxis: {
      type: "value",
      ...AXIS,
      scale: true,
      min: bounds.min,
      max: bounds.max,
      axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => fmt(v, 0) },
    },
    yAxis: { type: "value", ...AXIS, axisLabel: { show: false }, splitLine: { show: false } },
    series: [
      {
        type: "bar",
        data: mid.map((m, i) => [m, d.bins[i].n]),
        barWidth: "92%",
        itemStyle: { color: "rgba(102,184,255,0.55)" },
        markLine: { silent: true, symbol: "none", data: marks, label: { position: "end", fontSize: 10 } },
      },
    ],
  };
}

function LeverInput({ lv, sent, onCommit }: { lv: IvLever; sent?: number; onCommit: (v: number | null) => void }) {
  const shown = leverToInput(lv, lv.value);
  const [text, setText] = useState(String(shown).replace(".", ","));
  useEffect(() => setText(String(shown).replace(".", ",")), [shown]);
  // Nach eigener Eingabe den Wert zeigen, mit dem gerechnet wurde – auch wenn er gleich bleibt, weil der Rechenkern
  // begrenzt hat (z. B. Endwachstum über dem risikolosen Zins); sonst stünde weiter die verworfene Eingabe im Feld
  const committed = useRef(false);
  useEffect(() => {
    if (!committed.current) return;
    committed.current = false;
    setText(String(shown).replace(".", ","));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lv]);
  const changed = Math.abs(lv.value - lv.default) > 1e-9;
  const commit = () => {
    const v = parseLeverInput(text);
    if (v === null) return setText(String(shown).replace(".", ","));
    if (Math.abs(v - shown) < 1e-9) return;
    const next = inputToLever(lv, v);
    // Dieselbe Eingabe noch einmal (z. B. erneut 999 nach der Begrenzung auf 25): Es kommt keine neue Antwort,
    // also gleich wieder den gerechneten Wert zeigen – sonst bliebe die verworfene Eingabe im Feld stehen
    if (leverAlreadySent(sent, next)) return setText(String(shown).replace(".", ","));
    committed.current = true;
    onCommit(next);
  };
  const unit = lv.unit === "pct" ? "%" : lv.unit === "x" ? "×" : "";
  return (
    <label className={`dcf-lever ${changed ? "changed" : ""}`} title={`${lv.hint}\nStartwert: ${fmt(leverToInput(lv, lv.default), lv.unit === "year" ? 0 : 2)}${unit}`}>
      <span className="dcf-lever-l">{lv.label}</span>
      <span className="dcf-lever-v">
        <input
          className="field"
          inputMode="decimal"
          aria-label={lv.label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <span className="muted">{unit}</span>
        {changed && (
          <button type="button" className="btn-x" title="Auf Startwert zurücksetzen" onClick={() => onCommit(null)}>
            ↺
          </button>
        )}
      </span>
    </label>
  );
}

// --- KI-Persona ---------------------------------------------------------------------------------------------------

type Chat = { role: "user" | "assistant"; text: string; unverified?: string[] };

function Persona({ ticker, data, levers, onApply }: { ticker: string; data: IntrinsicResult; levers: Levers; onApply: (l: Levers) => void }) {
  const [comment, setComment] = useState<CoachResult | null>(null);
  const [story, setStory] = useState("");
  const [sug, setSug] = useState<CoachResult | null>(null);
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<Chat[]>([]);
  const [busy, setBusy] = useState<"" | "kommentar" | "story" | "frage">("");
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<CoachResult | null>(null);
  useEffect(() => {
    setComment(null);
    setSug(null);
    setChat([]);
    setErr("");
  }, [ticker]);

  const run = async (mode: "kommentar" | "story" | "frage") => {
    setBusy(mode);
    setErr("");
    try {
      if (mode === "kommentar") {
        const r = await askCoach(ticker, { mode, levers });
        setComment(r);
        setMeta(r);
      } else if (mode === "story") {
        const r = await askCoach(ticker, { mode, levers, text: story });
        setSug(r);
        setMeta(r);
      } else {
        const q = question.trim();
        if (!q) return;
        const history = chat.slice(-8).map((c) => ({ role: c.role, content: c.text }));
        setChat((c) => [...c, { role: "user", text: q }]);
        setQuestion("");
        const r = await askCoach(ticker, { mode, levers, text: q, history });
        setChat((c) => [...c, { role: "assistant", text: r.answer, unverified: r.unverified }]);
        setMeta(r);
      }
    } catch (e) {
      setErr(aiErrorText(e));
    } finally {
      setBusy("");
    }
  };

  const lv = (k: string) => data.levers.find((x) => x.key === k);
  const s = sug?.suggestion;
  return (
    <div className="dcf-persona">
      <div className="dcf-persona-h">
        <b>Damodaran</b> <span className="muted">(KI-Persona)</span>
        <div className="xs dim">{meta?.disclaimer ?? "KI-Persona nach Aswath Damodarans veröffentlichter Bewertungsmethode – nicht Aswath Damodaran selbst, keine Anlageberatung."}</div>
      </div>
      <div className="dcf-persona-b">
        <button type="button" className="btn" disabled={!!busy} onClick={() => run("kommentar")}>
          {busy === "kommentar" ? "denkt nach …" : comment ? "Neu einordnen" : "Bewertung einordnen"}
        </button>
        {comment && (
          <div className="dcf-comment">
            {comment.sections.map((sec, i) => (
              <div key={i}>
                <div className="section-title">{sec.title}</div>
                <AnswerText text={sec.text} unverified={comment.unverified} />
              </div>
            ))}
          </div>
        )}

        <div className="section-title" title="Erzähl die Geschichte der Firma – die Persona übersetzt sie in Story-Hebel, der Rechenkern rechnet nach. Übernommen wird erst per Klick.">
          Story → Zahlen
        </div>
        <textarea
          className="field dcf-story"
          rows={3}
          placeholder="z. B. „Wird mit KI-Chips Marktführer, die Marge steigt durch Preismacht, braucht aber viel Kapital“"
          value={story}
          onChange={(e) => setStory(e.target.value)}
          aria-label="Story"
        />
        <button type="button" className="btn" disabled={!!busy || !story.trim()} onClick={() => run("story")}>
          {busy === "story" ? "übersetzt …" : "In Zahlen übersetzen"}
        </button>
        {s && (
          <div className="dcf-sug">
            <table className="t" data-csv-skip>
              <tbody>
                {Object.entries(s.levers).map(([k, v]) => {
                  const l = lv(k);
                  if (!l) return null;
                  const unit = l.unit === "pct" ? " %" : l.unit === "x" ? "×" : "";
                  const now = leverToInput(l, l.value);
                  const next = leverToInput(l, v);
                  return (
                    <tr key={k} className={Math.abs(now - next) > 1e-6 ? "dcf-sug-changed" : undefined}>
                      <td className="dcf-sug-l">{l.label}</td>
                      <td className="num">
                        <span className="muted">{fmt(now, l.unit === "year" ? 0 : 1)}</span> → <b>{fmt(next, l.unit === "year" ? 0 : 1)}</b>
                        {unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="small">
              Wert unter dieser Story: <b>{fmtPrice(s.valuePerShare)}</b> {data.currency}{" "}
              <span className={tone(s.valueGap)}>({signedPct(s.valueGap)} zum Kurs)</span>
            </div>
            {s.reasons.story && <AnswerText text={s.reasons.story} unverified={[]} />}
            {s.threeP && (
              <div className="small">
                <b>3 P:</b> {s.threeP}
              </div>
            )}
            <button type="button" className="btn" onClick={() => onApply(s.levers)} title="Vorgeschlagene Hebel übernehmen (danach weiter änderbar)">
              Übernehmen
            </button>
          </div>
        )}

        <div className="section-title">Frage an die Persona</div>
        <div className="dcf-chat">
          {chat.map((c, i) =>
            c.role === "user" ? (
              <div key={i} className="chat-q">{c.text}</div>
            ) : (
              <div key={i} className="chat-a">
                <AnswerText text={c.text} unverified={c.unverified ?? []} />
              </div>
            ),
          )}
        </div>
        <div className="dcf-ask">
          <input
            className="field"
            placeholder="z. B. „Was muss man glauben, damit der Kurs stimmt?“"
            value={question}
            aria-label="Frage an die Persona"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && run("frage")}
          />
          <button type="button" className="btn" disabled={!!busy || !question.trim()} onClick={() => run("frage")}>
            {busy === "frage" ? "…" : "Fragen"}
          </button>
        </div>
        {err && <div className="down small">{err}</div>}
        {meta && (
          <div className="xs dim">
            {engineLabel(meta.engine, meta.model)}
            {meta.engine === "lmstudio" ? ` · ${fmt(meta.seconds, 1)} s` : ""}
            {meta.unverified.length > 0 && <span className="warn"> · {meta.unverified.length} Zahl(en) ohne Beleg markiert</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Bildschirm -------------------------------------------------------------------------------------------------

export function DCF({ ticker }: ScreenProps) {
  const [levers, setLevers] = useState<Levers>({});
  useEffect(() => setLevers({}), [ticker]);
  const q = useIntrinsic(ticker, levers);
  const d = q.data && q.data.ticker === ticker ? q.data : undefined;
  const cur = d?.currency ?? "";

  const setLever = (key: string, v: number | null) =>
    setLevers((prev) => {
      const next = { ...prev };
      if (v === null) delete next[key];
      else next[key] = v;
      return d ? changedLevers(next, d.levers) : next;
    });

  const opt = useMemo(() => (d?.distribution ? distOption(d.distribution, d.valuePerShare, d.price, cur) : null), [d, cur]);

  useCsvExport(() => {
    if (!d || d.state !== "ok") return [];
    return [
      {
        title: `DCF ${d.name} – 10 Jahre (${cur})`,
        columns: ["Jahr", "Wachstum [%]", "Umsatz", "Marge [%]", "EBIT", "Steuersatz [%]", "EBIT nach Steuern", "Reinvestition", "Freier Cashflow", "Kapitalkosten [%]", "Abzinsung", "Barwert", "Eingesetztes Kapital", "Kapitalrendite [%]"],
        rows: d.years.map((y) => [y.year, y.growth * 100, y.revenue, y.margin * 100, y.ebit, y.taxRate * 100, y.ebitAfterTax, y.reinvestment, y.fcff, y.wacc * 100, y.discount, y.pv, y.investedCapital, isNum(y.roic) ? y.roic * 100 : null]),
      },
      {
        title: `DCF ${d.name} – Story-Hebel`,
        columns: ["Hebel", "Wert", "Startwert", "Einheit"],
        rows: d.levers.map((l) => [l.label, leverToInput(l, l.value), leverToInput(l, l.default), l.unit === "pct" ? "%" : l.unit === "x" ? "x" : "Jahr"]),
      },
    ];
  });

  if (IS_STATIC) return <Empty>Die Bewertung (DCF) braucht den Terminal-Server (in der statischen Demo nicht verfügbar).</Empty>;
  if (!ticker) return <Empty>Wertpapier wählen, z. B. „QBIT US DCF“.</Empty>;
  if (q.isPending) return <Loading rows={10} />;
  if (q.isError && !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d) return null;
  if (d.state === "not_applicable" || d.state === "no_data") {
    return (
      <div className="panel-body">
        <Empty>{d.message}</Empty>
      </div>
    );
  }

  const dist = d.distribution;
  const rv = d.reverse;
  const ql = d.quality;
  const anyChanged = Object.keys(levers).length > 0;
  return (
    <div className="panel-body flush dcf">
      <div className="toolbar">
        <span className="small">
          <b>{d.name}</b> <span className="muted">· innerer Wert nach Damodarans Methode · {d.basePeriod} · gerechnet in {cur}</span>
        </span>
        {anyChanged && (
          <button type="button" className="btn" onClick={() => setLevers({})} title="Alle Story-Hebel auf ihre Startwerte">
            ↺ Startwerte
          </button>
        )}
        {q.isFetching && <span className="small dim">rechnet …</span>}
        <span className="small dim" title={`Risikoprämie, Länder- und Branchenwerte: ${d.paramsSource}${d.paramsLoadedAt ? ` (geladen ${d.paramsLoadedAt.slice(0, 10)})` : ""}`}>
          Parameter: {d.paramsLoadedAt ? "Damodaran-Daten geladen" : "Richtwerte"}
        </span>
      </div>
      {d.state === "invalid" && <div className="down small" style={{ padding: "4px 10px" }}>{d.message}</div>}
      <div className="kpis">
        <div className="kpi">
          <div className="kpi-l">Wert je Aktie</div>
          <div className="kpi-v">{fmtPrice(d.valuePerShare)} <span className="small muted">{cur}</span></div>
          <div className="kpi-s">Kurs {fmtPrice(d.price)} {cur}{d.fxNote ? " (umgerechnet)" : ""}</div>
        </div>
        <div className="kpi" title="Wert ÷ Kurs − 1: positiv = Wert über dem Kurs. Die Lücke ist die These, nicht ihr Beweis.">
          <div className="kpi-l">Wert gegen Kurs</div>
          <div className={`kpi-v ${tone(d.valueGap)}`}>{signedPct(d.valueGap)}</div>
          <div className="kpi-s">{dist && isNum(dist.shareAbovePrice) ? `in ${fmt(dist.shareAbovePrice * 100, 0)} % der Läufe über dem Kurs` : ""}</div>
        </div>
        <div className="kpi" title="Bandbreite aus 1.500 Läufen mit gestreuten Story-Hebeln (fester Startwert): 80 % der Werte liegen zwischen P10 und P90.">
          <div className="kpi-l">Bandbreite P10 – P90</div>
          <div className="kpi-v">{dist ? `${fmtPrice(dist.p10)} – ${fmtPrice(dist.p90)}` : DASH}</div>
          <div className="kpi-s">Median {fmtPrice(dist?.p50)}</div>
        </div>
        <div className="kpi" title={d.lifecycle?.text}>
          <div className="kpi-l">Lebenszyklus</div>
          <div className="kpi-v">{d.lifecycle?.label ?? DASH}</div>
          <div className="kpi-s">{d.industryUsed}</div>
        </div>
        <div className="kpi" title={ql?.verdict}>
          <div className="kpi-l">Rendite neues Kapital / Kapitalkosten</div>
          <div className={`kpi-v ${ql && isNum(ql.roicMarginal) && isNum(ql.wacc) ? (ql.roicMarginal > ql.wacc ? "up" : "down") : ""}`}>
            {pct(ql?.roicMarginal)} / {pct(ql?.wacc)}
          </div>
          <div className="kpi-s">{ql?.verdict.split(":")[0]}</div>
        </div>
      </div>
      <div className="dcf-body">
        <div className="dcf-levers">
          <div className="section-title" title="Die Story in Zahlen. Startwerte aus Historie und Branche; ändern und mit Enter bestätigen.">Story-Hebel</div>
          {d.levers.map((lv) => (
            <LeverInput key={lv.key} lv={lv} sent={levers[lv.key]} onCommit={(v) => setLever(lv.key, v)} />
          ))}
          <div className="xs dim" style={{ marginTop: 6 }}>Geänderte Hebel sind orange markiert; ↺ setzt zurück.</div>
        </div>
        <div className="dcf-main">
          {opt && (
            <Block title="Wert als Bandbreite" hint="Verteilung des Werts je Aktie über 1.500 Läufe mit gestreuten Hebeln – Damodaran: lieber ungefähr richtig als genau falsch.">
              <EChart option={opt} style={{ height: 170 }} csv="Wertverteilung" />
            </Block>
          )}
          <Block title="Was muss man glauben? (Rückwärts-DCF)" hint="Welche Annahme den heutigen Kurs rechtfertigt, wenn alles andere gleich bleibt.">
            <div className="small dcf-text">
              {!rv ? (
                isNum(d.price) ? DASH : "Ohne Kurs in der Berichtswährung ist kein Rückwärts-DCF möglich."
              ) : (
                <>
                  {isNum(rv.growth) ? (
                    <>
                      Der Kurs unterstellt <b>{pct(rv.growth)}</b> Umsatzwachstum pro Jahr in den Jahren 1–5 (Umsatz in Jahr 10 rund{" "}
                      <b>{fmt(rv.revenueMultiple10y, 1)}×</b> so hoch wie heute)
                    </>
                  ) : (
                    "Kein Wachstum im geprüften Bereich (−30 % bis +100 % p. a.) erklärt den Kurs"
                  )}
                  {/* die Zielmarge gilt auch, wenn kein Wachstum den Kurs erklärt (Rechenkern liefert beide getrennt) */}
                  {isNum(rv.margin) ? (
                    <>
                      {" "}– {isNum(rv.growth) ? "oder " : ""}bei den gewählten Wachstumsraten eine Zielmarge von <b>{pct(rv.margin)}</b>
                    </>
                  ) : null}
                  {isNum(rv.growth) || isNum(rv.margin) ? ". Ist das möglich, plausibel, wahrscheinlich?" : "."}
                </>
              )}
            </div>
          </Block>
          <div className="dcf-grid">
            <Block title="Wertbrücke">
              <RowTable rows={d.bridge} title={`DCF ${d.name} – Wertbrücke`} />
            </Block>
            <Block title="Kapitalkosten" hint="Risiko landet in den Kapitalkosten – Damodarans „Schweizer Taschenmesser“.">
              <RowTable rows={d.costOfCapital} title={`DCF ${d.name} – Kapitalkosten`} />
            </Block>
            <Block title="Bereinigung (Buchhaltung ist Rohstoff)">
              <RowTable rows={d.adjustments} title={`DCF ${d.name} – Bereinigung`} />
            </Block>
            <Block title="Endwert (ab Jahr 11)">
              <RowTable rows={d.terminal} title={`DCF ${d.name} – Endwert`} />
            </Block>
          </div>
          <Block title="Die nächsten 10 Jahre">
            <div className="dcf-years">
              <table className="t" data-csv-skip="" /* CSV: vollständige Werte über useCsvExport (sonst doppelt) */>
                <thead>
                  <tr>
                    <th>Jahr</th>
                    <th className="num">Wachstum</th>
                    <th className="num">Umsatz</th>
                    <th className="num">Marge</th>
                    <th className="num">Steuer</th>
                    <th className="num">EBIT n. St.</th>
                    <th className="num">Reinvestition</th>
                    <th className="num">Freier CF</th>
                    <th className="num">Kap.-Kosten</th>
                    <th className="num">Barwert</th>
                    <th className="num">Kap.-Rendite</th>
                  </tr>
                </thead>
                <tbody>
                  {d.years.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td className="num">{pct(y.growth)}</td>
                      <td className="num">{fmtBig(y.revenue)}</td>
                      <td className="num">{pct(y.margin)}</td>
                      <td className="num">{pct(y.taxRate)}</td>
                      <td className="num">{fmtBig(y.ebitAfterTax)}</td>
                      <td className="num">{fmtBig(y.reinvestment)}</td>
                      <td className={`num ${y.fcff < 0 ? "down" : ""}`}>{fmtBig(y.fcff)}</td>
                      <td className="num">{pct(y.wacc, 2)}</td>
                      <td className="num">{fmtBig(y.pv)}</td>
                      <td className="num">{pct(y.roic)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>
          <div className="dcf-grid">
            <Block title="Bisher (Geschäftsjahre)">
              <RowTable rows={d.history} title={`DCF ${d.name} – Historie`} />
            </Block>
            <Block title="Gegenprobe: Pricing" hint="Multiplikatoren sind Preis, nicht Wert – zur Einordnung, nicht als Maßstab.">
              <RowTable rows={d.multiples} title={`DCF ${d.name} – Multiplikatoren`} />
            </Block>
          </div>
          {(d.warnings.length > 0 || d.fxNote) && (
            <Block title="Hinweise">
              <ul className="small dcf-warn">
                {d.fxNote && <li>{d.fxNote}</li>}
                {d.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                <li className="muted">
                  Vergleichsbranche {d.industryUsed}: {d.industrySource}. Banken und Versicherungen werden nicht bewertet. Keine Anlageberatung.
                </li>
              </ul>
            </Block>
          )}
        </div>
        {d.state === "ok" && ticker && <Persona ticker={ticker} data={d} levers={levers} onApply={(l) => setLevers((prev) => changedLevers({ ...prev, ...l }, d.levers))} />}
      </div>
      <div className="xs dim" style={{ padding: "4px 10px" }}>
        {displayTicker(d.ticker)} · Methode nach Aswath Damodaran (FCFF-DCF, F&E aktiviert, Kapitalkosten aus Branchenbeta) – Rechnung im Terminal, keine Anlageberatung.
      </div>
    </div>
  );
}
