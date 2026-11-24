// Bilanzbild (FA): Bilanz in Teile zerlegen, Kennzahlen mit Ampel, Eigenkapital-Brücke. Reine Funktionen ohne Darstellung.

import type { Financials, StatementRow } from "./types";

export type Light = "ok" | "watch" | "alarm" | "none";

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: string; // CSS-Klasse der Farbe
  hint: string;
}

export interface BalanceSplit {
  period: string;
  total: number; // Bilanzsumme
  assets: Segment[];
  liabilities: Segment[]; // inkl. Eigenkapital (positiv) – bei negativem Eigenkapital ohne
  equity: number | null;
  debt: number | null; // Finanzschulden (Teil der Verbindlichkeiten)
  goodwill: number; // Goodwill + immaterielle Werte
}

const row = (rows: StatementRow[], key: string) => rows.find((r) => r.key === key)?.values ?? [];
const at = (rows: StatementRow[], key: string, i: number): number | null => {
  const v = row(rows, key)[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const pos = (v: number | null) => (v !== null && v > 0 ? v : 0);

/** Anlagevermögen: gemeldet, sonst Bilanzsumme minus Umlaufvermögen. */
const nonCurrentOf = (b: StatementRow[], i: number): number | null => {
  const total = at(b, "totalAssets", i), curr = at(b, "totalCurrentAssets", i);
  return at(b, "nonCurrentAssetsTotal", i) ?? (total !== null && curr !== null ? total - curr : null);
};

/** Bilanz einer Periode (Index in f.periods, 0 = neueste) in Teile zerlegen. Restposten schließen die Lücke zur Summe. */
export function splitBalance(f: Financials, i = 0): BalanceSplit | null {
  const b = f.balance;
  const total = at(b, "totalAssets", i);
  if (!total || total <= 0) return null;
  let cash = pos(at(b, "cash", i));
  let recv = pos(at(b, "netReceivables", i));
  let inv = pos(at(b, "inventory", i));
  const curr = at(b, "totalCurrentAssets", i);
  const nonCurr = nonCurrentOf(b, i);
  // Ohne Umlaufvermögen-Summe (z. B. Banken) dürfen Kasse, Forderungen und Vorräte nicht mehr sein als der Platz
  // neben dem Anlagevermögen – sonst ragte die Säule über die Bilanzsumme hinaus.
  if (curr === null && nonCurr !== null) {
    const room = Math.max(0, total - nonCurr), sumC = cash + recv + inv;
    if (sumC > room) {
      const k = sumC > 0 ? room / sumC : 0;
      cash *= k; recv *= k; inv *= k;
    }
  }
  const ppe = pos(at(b, "propertyPlantEquipment", i));
  const gw = goodwillTotal(b, i, nonCurr);
  const otherCurr = curr !== null ? Math.max(0, curr - cash - recv - inv) : 0;
  const otherFixed = nonCurr !== null ? Math.max(0, nonCurr - ppe - gw) : Math.max(0, total - cash - recv - inv - otherCurr - ppe - gw);
  const assets: Segment[] = [
    { key: "cash", label: "Liquide Mittel", value: cash, tone: "bv-cash", hint: "Bargeld und kurzfristige Anlagen" },
    { key: "recv", label: "Forderungen", value: recv, tone: "bv-recv", hint: "Geld, das Kunden noch schulden" },
    { key: "inv", label: "Vorräte", value: inv, tone: "bv-inv", hint: "Rohstoffe, Halb- und Fertigwaren" },
    { key: "ocurr", label: "Sonst. kurzfristig", value: otherCurr, tone: "bv-other", hint: "übriges Umlaufvermögen" },
    { key: "ppe", label: "Sachanlagen", value: ppe, tone: "bv-ppe", hint: "Gebäude, Maschinen, Anlagen" },
    { key: "gw", label: "Goodwill & Immat.", value: gw, tone: "bv-gw", hint: "Firmenwert aus Zukäufen, Marken, Patente – nicht greifbar" },
    { key: "ofix", label: "Sonst. langfristig", value: otherFixed, tone: "bv-other", hint: "Beteiligungen, latente Steuern u. a." },
  ].filter((s) => s.value > total * 0.002);
  // Rundungen/fehlende Posten: Aktiva auf die Bilanzsumme bringen
  const sumA = assets.reduce((s, x) => s + x.value, 0);
  // widersprüchliche Teilposten (Summe größer als die Bilanz): alles maßstäblich auf die Bilanzsumme kürzen
  if (sumA > total * 1.005) for (const a of assets) a.value *= total / sumA;
  else if (sumA < total * 0.995) assets.push({ key: "rest", label: "Nicht aufgeschlüsselt", value: total - sumA, tone: "bv-other", hint: "von der Datenquelle nicht einzeln gemeldet" });

  const equity = at(b, "totalStockholderEquity", i);
  const currLiab = pos(at(b, "totalCurrentLiabilities", i));
  const totalLiab = at(b, "totalLiab", i);
  const nclReported = at(b, "nonCurrentLiabilitiesTotal", i) ?? (totalLiab !== null ? totalLiab - currLiab : null);
  const nonCurrLiab = pos(nclReported);
  const liabilities: Segment[] = [
    { key: "cl", label: "Kurzfr. Verbindl.", value: currLiab, tone: "bv-cl", hint: "fällig innerhalb eines Jahres (Lieferanten, kurzfristige Kredite …)" },
    { key: "ncl", label: "Langfr. Verbindl.", value: nonCurrLiab, tone: "bv-ncl", hint: "Anleihen, langfristige Kredite, Pensionen …" },
  ];
  if (equity !== null && equity > 0) liabilities.push({ key: "eq", label: "Eigenkapital", value: equity, tone: "bv-eq", hint: "gehört den Aktionären" });
  const sumP = liabilities.reduce((s, x) => s + x.value, 0);
  // Minderheiten und Rundungen: Rest zur Bilanzsumme (nur wenn positiv und nennenswert)
  // Fehlen langfristige und gesamte Verbindlichkeiten, ist der Rest vor allem Fremdkapital – dann neutral benennen.
  if (equity !== null && equity > 0 && total - sumP > total * 0.005)
    liabilities.push(nclReported !== null
      ? { key: "min", label: "Minderheiten u. a.", value: total - sumP, tone: "bv-other", hint: "Anteile anderer Gesellschafter, nicht zuordenbar" }
      : { key: "rest", label: "Nicht aufgeschlüsselt", value: total - sumP, tone: "bv-other", hint: "langfristige Verbindlichkeiten u. a. – von der Datenquelle nicht einzeln gemeldet" });
  return {
    period: f.periods[i],
    total,
    assets,
    liabilities: liabilities.filter((s) => s.value > 0),
    equity,
    debt: at(b, "shortLongTermDebtTotal", i),
    goodwill: gw,
  };
}

/** Goodwill + immaterielle Werte. Laut EODHD-Glossar können „intangibleAssets“ den Goodwill schon enthalten: Passt die
 * Summe nicht ins Anlagevermögen, ist er doppelt gezählt – dann den größeren der beiden Werte nehmen. */
export function goodwillTotal(b: StatementRow[], i: number, nonCurr: number | null = at(b, "nonCurrentAssetsTotal", i)): number {
  const gw = pos(at(b, "goodWill", i)), ia = pos(at(b, "intangibleAssets", i));
  const ppe = pos(at(b, "propertyPlantEquipment", i));
  if (nonCurr !== null && gw > 0 && ia > 0 && ppe + gw + ia > nonCurr * 1.001) return Math.max(gw, ia);
  return gw + ia;
}

export interface Kpi {
  key: string;
  label: string;
  unit: "pct" | "x";
  values: (number | null)[]; // neueste zuerst, wie f.periods
  light: Light;
  hint: string;
  text: string; // Bewertung in Worten für den neuesten Wert
}

/** EBITDA der Periode i; im Quartal die Summe der letzten vier Quartale (sonst wäre die Schuldenquote 4× zu hoch). */
export function ebitdaAt(f: Financials, i: number): number | null {
  if (f.period === "annual") return at(f.income, "ebitda", i);
  // nur vier aufeinanderfolgende Quartale (fehlt eines, umfasste die Summe sonst mehr als ein Jahr)
  const a = Date.parse(f.periods[i] ?? ""), z = Date.parse(f.periods[i + 3] ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(z) || (a - z) / 86_400_000 > 300) return null;
  const vals = [0, 1, 2, 3].map((k) => at(f.income, "ebitda", i + k));
  return vals.every((v) => v !== null) ? (vals as number[]).reduce((a, b) => a + b, 0) : null;
}


export function kpis(f: Financials): Kpi[] {
  const n = f.periods.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const b = f.balance;
  const eq = idx.map((i) => at(b, "totalStockholderEquity", i));
  const ta = idx.map((i) => at(b, "totalAssets", i));
  const eqRatio = idx.map((i) => (eq[i] !== null && ta[i] ? (eq[i]! / ta[i]!) * 100 : null));
  const quick = idx.map((i) => {
    const c = at(b, "cash", i), r = at(b, "netReceivables", i), cl = at(b, "totalCurrentLiabilities", i);
    return c !== null && cl ? (c + (r ?? 0)) / cl : null;
  });
  const gwEq = idx.map((i) => {
    const gw = goodwillTotal(b, i, nonCurrentOf(b, i));
    const hasGw = at(b, "goodWill", i) !== null || at(b, "intangibleAssets", i) !== null;
    if (!hasGw || eq[i] === null) return null;
    return eq[i]! > 0 ? (gw / eq[i]!) * 100 : Infinity; // negatives Eigenkapital: unbegrenzt
  });
  const netDebt = idx.map((i) => {
    const d = at(b, "shortLongTermDebtTotal", i), c = at(b, "cash", i);
    return d !== null && c !== null ? d - c : at(b, "netDebt", i);
  });
  const lev = idx.map((i) => {
    const e = ebitdaAt(f, i);
    if (netDebt[i] === null || e === null) return null;
    if (netDebt[i]! <= 0) return 0; // mehr Kasse als Schulden
    return e > 0 ? netDebt[i]! / e : Infinity;
  });
  const last = <T,>(xs: T[]) => xs[0];
  const lightOf = (v: number | null, ok: (x: number) => boolean, watch: (x: number) => boolean): Light =>
    v === null ? "none" : ok(v) ? "ok" : watch(v) ? "watch" : "alarm";
  return [
    {
      key: "eqRatio", label: "Eigenkapitalquote", unit: "pct", values: eqRatio,
      light: lightOf(last(eqRatio), (x) => x >= 30, (x) => x >= 15),
      hint: "Eigenkapital ÷ Bilanzsumme. Ab 30 % solide, unter 15 % dünn. Banken und Versicherer liegen naturgemäß niedriger.",
      text: last(eqRatio) === null ? "keine Angabe" : last(eqRatio)! < 0 ? "Eigenkapital negativ" : last(eqRatio)! >= 30 ? "solide" : last(eqRatio)! >= 15 ? "eher dünn" : "sehr dünn",
    },
    {
      key: "quick", label: "Liquidität 2. Grades", unit: "x", values: quick,
      light: lightOf(last(quick), (x) => x >= 1, (x) => x >= 0.7),
      hint: "(Liquide Mittel + Forderungen) ÷ kurzfristige Verbindlichkeiten. Ab 1 sind die kurzfristigen Schulden ohne Verkauf von Vorräten gedeckt.",
      text: last(quick) === null ? "keine Angabe" : last(quick)! >= 1 ? "kurzfristig gedeckt" : last(quick)! >= 0.7 ? "knapp" : "eng",
    },
    {
      key: "gwEq", label: "Goodwill ÷ Eigenkapital", unit: "pct", values: gwEq.map((v) => (v === Infinity ? null : v)),
      light: last(gwEq) === Infinity ? "alarm" : lightOf(last(gwEq), (x) => x < 50, (x) => x < 100),
      hint: "Goodwill und immaterielle Werte im Verhältnis zum Eigenkapital. Hoch heißt: viel Eigenkapital steckt in Zukäufen – eine Abschreibung träfe es direkt.",
      text: last(gwEq) === null ? "keine Angabe" : last(gwEq) === Infinity ? "Eigenkapital negativ" : last(gwEq)! < 50 ? "gering" : last(gwEq)! < 100 ? "beachtlich" : "übersteigt das Eigenkapital",
    },
    {
      key: "lev", label: "Nettoschulden ÷ EBITDA", unit: "x", values: lev.map((v) => (v === Infinity ? null : v)),
      light: last(lev) === Infinity ? "alarm" : lightOf(last(lev), (x) => x <= 2, (x) => x <= 3.5),
      hint: `In wie vielen Jahren der operative Gewinn (EBITDA${f.period === "annual" ? "" : ", letzte vier Quartale"}) die Nettoschulden tilgen würde. Unter 2 gilt als gesund, über 3,5 als hoch.`,
      text: last(lev) === null ? "keine Angabe" : last(lev) === Infinity ? "EBITDA negativ" : last(lev) === 0 ? "mehr Kasse als Schulden" : last(lev)! <= 2 ? "gut tragbar" : last(lev)! <= 3.5 ? "erhöht" : "hoch",
    },
  ];
}

export interface BridgeStep {
  label: string;
  value: number;
  kind: "total" | "up" | "down";
}

/** Eigenkapital-Brücke: Vorperiode → Gewinn → Dividenden → Rückkäufe → Sonstiges → aktuelle Periode. Nur jährlich. */
export function equityBridge(f: Financials): BridgeStep[] | null {
  if (f.period !== "annual" || f.periods.length < 2) return null;
  const e1 = at(f.balance, "totalStockholderEquity", 0), e0 = at(f.balance, "totalStockholderEquity", 1);
  const ni = at(f.income, "netIncome", 0);
  if (e1 === null || e0 === null || ni === null) return null;
  const div = -Math.abs(at(f.cashflow, "dividendsPaid", 0) ?? 0);
  const buy = at(f.cashflow, "salePurchaseOfStock", 0) ?? 0; // negativ = Rückkauf, positiv = Kapitalerhöhung
  const other = e1 - e0 - ni - div - buy;
  const y = (p: string) => p.slice(0, 4);
  const steps: BridgeStep[] = [{ label: `EK ${y(f.periods[1])}`, value: e0, kind: "total" }];
  const add = (label: string, v: number) => {
    if (Math.abs(v) > Math.abs(e1) * 0.001) steps.push({ label, value: v, kind: v >= 0 ? "up" : "down" });
  };
  add(ni >= 0 ? "Gewinn" : "Verlust", ni);
  add("Dividenden", div);
  add(buy <= 0 ? "Rückkäufe" : "Kapitalerhöhung", buy);
  add("Sonstiges", other);
  steps.push({ label: `EK ${y(f.periods[0])}`, value: e1, kind: "total" });
  return steps;
}

/** Betrag kurz: 1,2 Bio. / 345 Mrd. / 12,3 Mrd. / 870 Mio. */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  const f = (x: number, d: number) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (a >= 1e12) return `${sign}${f(a / 1e12, 1)} Bio.`;
  if (a >= 1e11) return `${sign}${f(a / 1e9, 0)} Mrd.`;
  if (a >= 1e9) return `${sign}${f(a / 1e9, 1)} Mrd.`;
  if (a >= 1e6) return `${sign}${f(a / 1e6, 0)} Mio.`;
  return `${sign}${f(a, 0)}`;
}
