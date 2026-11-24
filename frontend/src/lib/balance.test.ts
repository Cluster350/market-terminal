import { describe, expect, it } from "vitest";
import { ebitdaAt, equityBridge, kpis, money, splitBalance } from "./balance";
import { niceCeil, spreadLabels } from "../screens/balance";
import type { Financials, StatementRow } from "./types";

const r = (key: string, values: (number | null)[]): StatementRow => ({ key, label: key, values, kind: "money", emphasis: false });

function fin(over: Partial<Record<string, (number | null)[]>> = {}, period: "annual" | "quarterly" = "annual"): Financials {
  const b = {
    cash: [18, 12], netReceivables: [12, 10], inventory: [9, 9], totalCurrentAssets: [45, 38], nonCurrentAssetsTotal: [55, 52],
    propertyPlantEquipment: [30, 30], goodWill: [15, 14], intangibleAssets: [5, 5], totalAssets: [100, 90],
    totalCurrentLiabilities: [20, 22], nonCurrentLiabilitiesTotal: [38, 36], totalLiab: [58, 58], shortLongTermDebtTotal: [28, 30],
    totalStockholderEquity: [42, 32], ...over,
  };
  return {
    ticker: "X.US", period, currency: "USD", periods: ["2025-12-31", "2024-12-31"],
    income: [r("netIncome", [14, 10]), r("ebitda", [25, 20])],
    balance: Object.entries(b).map(([k, v]) => r(k, v as (number | null)[])),
    cashflow: [r("dividendsPaid", [-2, -2]), r("salePurchaseOfStock", [-3, 0])],
  };
}

describe("Bilanzbild", () => {
  it("zerlegt beide Seiten genau auf die Bilanzsumme", () => {
    const s = splitBalance(fin())!;
    const sum = (xs: { value: number }[]) => xs.reduce((a, x) => a + x.value, 0);
    expect(sum(s.assets)).toBeCloseTo(100);
    expect(sum(s.liabilities)).toBeCloseTo(100);
    expect(s.assets.find((x) => x.key === "ocurr")!.value).toBe(6); // 45 − 18 − 12 − 9
    expect(s.assets.find((x) => x.key === "gw")!.value).toBe(20); // Goodwill + immaterielle Werte
    expect(s.assets.find((x) => x.key === "ofix")!.value).toBe(5); // 55 − 30 − 20
    expect(s.debt).toBe(28);
    expect(splitBalance(fin({ totalAssets: [null, 90] }))).toBeNull();
  });
  it("Goodwill nicht doppelt zählen, wenn die immateriellen Werte ihn schon enthalten", () => {
    // 30 Sachanlagen + 15 Goodwill + 20 Immaterielle (inkl. Goodwill) = 65 > 55 Anlagevermögen
    const s = splitBalance(fin({ intangibleAssets: [20, 19] }))!;
    expect(s.assets.find((x) => x.key === "gw")!.value).toBe(20);
    expect(s.assets.reduce((a, x) => a + x.value, 0)).toBeCloseTo(100);
  });
  it("negatives Eigenkapital: kein Eigenkapital-Block, Ampeln rot", () => {
    const f = fin({ totalStockholderEquity: [-10, 32], totalLiab: [110, 58], nonCurrentLiabilitiesTotal: [90, 36] });
    const s = splitBalance(f)!;
    expect(s.liabilities.map((x) => x.key)).toEqual(["cl", "ncl"]);
    const k = Object.fromEntries(kpis(f).map((x) => [x.key, x]));
    expect(k.eqRatio.light).toBe("alarm");
    expect(k.eqRatio.text).toBe("Eigenkapital negativ");
    expect(k.gwEq.light).toBe("alarm");
  });
  it("Kennzahlen mit Faustregeln", () => {
    const k = Object.fromEntries(kpis(fin()).map((x) => [x.key, x]));
    expect(k.eqRatio.values[0]).toBe(42);
    expect(k.eqRatio.light).toBe("ok");
    expect(k.quick.values[0]).toBeCloseTo(1.5); // (18 + 12) ÷ 20
    expect(k.gwEq.values[0]).toBeCloseTo(47.6, 1); // 20 ÷ 42
    expect(k.lev.values[0]).toBeCloseTo(0.4); // (28 − 18) ÷ 25
    const cashRich = Object.fromEntries(kpis(fin({ cash: [40, 12] })).map((x) => [x.key, x]));
    expect(cashRich.lev.values[0]).toBe(0);
    expect(cashRich.lev.text).toBe("mehr Kasse als Schulden");
  });
  it("Quartale: EBITDA der letzten vier Quartale", () => {
    const f = { ...fin({}, "quarterly"), periods: ["q4", "q3", "q2", "q1", "q0"], income: [r("ebitda", [5, 6, 7, 8, 9])] };
    expect(ebitdaAt(f, 0)).toBe(26);
    expect(ebitdaAt(f, 2)).toBeNull(); // nur noch drei Quartale
  });
  it("Eigenkapital-Brücke geht genau auf", () => {
    const steps = equityBridge(fin())!;
    expect(steps.map((s) => s.label)).toEqual(["EK 2024", "Gewinn", "Dividenden", "Rückkäufe", "Sonstiges", "EK 2025"]);
    const flow = steps.slice(1, -1).reduce((a, s) => a + s.value, steps[0].value);
    expect(flow).toBeCloseTo(42);
    expect(steps.find((s) => s.label === "Sonstiges")!.value).toBeCloseTo(1); // 42 − 32 − 14 + 2 + 3
    expect(equityBridge(fin({}, "quarterly"))).toBeNull();
  });
  it("Hilfen: Beträge, Achsen, Beschriftungen", () => {
    expect(money(161.8e9)).toBe("162 Mrd.");
    expect(money(32.4e9)).toBe("32,4 Mrd.");
    expect(money(-3.3e9)).toBe("−3,3 Mrd.");
    expect(money(870e6)).toBe("870 Mio.");
    expect(niceCeil(32.4)).toBe(50);
    expect(niceCeil(180)).toBe(200);
    const ys = spreadLabels([100, 102, 104, 300], 13, 0, 400);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(13);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(13);
    expect(ys[3]).toBe(300);
    expect(Math.max(...spreadLabels([395, 396, 397], 13, 0, 400))).toBeLessThanOrEqual(400);
  });
});
