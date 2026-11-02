import { describe, expect, it } from "vitest";
import { corrColor } from "../screens/portfolio";
import { PAGES, pageForFn } from "../state/workspace";
import { exampleQuestions } from "./ai";
import { resolveFn } from "./commands";
import { mergePosition, parseCsv, parseDate, parseNumber, toCsv, type Portfolio, type Position } from "./portfolio";

const pos = (ticker: string, quantity: number, cost: number | null, opened: string | null = null): Position => ({
  id: ticker, ticker, quantity, cost, opened, currency: null, note: "",
});

describe("Zahlen und Daten aus der Eingabe", () => {
  it("liest deutsche und englische Schreibweise", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("182,5")).toBe(182.5);
    expect(parseNumber("0.75")).toBe(0.75);
    expect(parseNumber("1.000")).toBe(1000);
    expect(parseNumber("-12")).toBe(-12);
    expect(parseNumber("12,50 €")).toBe(12.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("liest Datumsangaben", () => {
    expect(parseDate("15.03.2024")).toBe("2024-03-15");
    expect(parseDate("1.2.25")).toBe("2025-02-01");
    expect(parseDate("2024-03-15")).toBe("2024-03-15");
    expect(parseDate("März")).toBeNull();
  });
});

describe("Positionen zusammenführen", () => {
  it("bildet den Durchschnittskurs und behält das frühere Kaufdatum", () => {
    const { positions, merged } = mergePosition([pos("SAP.XETRA", 10, 100, "2024-05-01")], pos("SAP.XETRA", 30, 140, "2023-01-02"));
    expect(merged).toBe(true);
    expect(positions).toHaveLength(1);
    expect(positions[0].quantity).toBe(40);
    expect(positions[0].cost).toBe(130);
    expect(positions[0].opened).toBe("2023-01-02");
  });

  it("entfernt eine glattgestellte Position", () => {
    expect(mergePosition([pos("A.US", 5, 10)], pos("A.US", -5, 12)).positions).toHaveLength(0);
  });
});

describe("CSV", () => {
  it("liest Liste mit Kopfzeile, Tabulatoren und Fehlern", () => {
    const r = parseCsv("Ticker;Stück;Kurs;Datum\nSAP GR; 20; 182,50; 15.03.2024\nnwnd\t5\t120.5\nfoo bar baz; 1\nAAPL US; ; 100\nSAP GR; 10; 200");
    expect(r.positions.map((p) => p.ticker)).toEqual(["SAP.XETRA", "NWND.US"]);
    expect(r.positions[0].quantity).toBe(30);
    expect(r.positions[0].cost).toBeCloseTo((20 * 182.5 + 10 * 200) / 30, 4);
    expect(r.positions[1].cost).toBe(120.5);
    expect(r.errors).toHaveLength(2);
  });

  it("schreibt und liest dieselbe Liste", () => {
    const p: Portfolio = { version: 1, base: "EUR", benchmark: null, cash: 0, updated: null, sample: false, positions: [pos("SAP.XETRA", 12.5, 182.25, "2024-03-15")] };
    const csv = toCsv(p);
    expect(csv.split("\r\n")[1]).toBe("SAP.XETRA;12,5;182,25;2024-03-15;");
    expect(parseCsv(csv).positions[0]).toMatchObject({ ticker: "SAP.XETRA", quantity: 12.5, cost: 182.25, opened: "2024-03-15" });
  });
});

describe("Seite DEPOT", () => {
  it("kennt Befehle und Seite", () => {
    expect(resolveFn("DEPOT")).toBe("PORT");
    expect(resolveFn("portfolio")).toBe("PORT");
    expect(resolveFn("risiko")).toBe("RISK");
    expect(pageForFn("RISK")).toBe("depot");
    const depot = PAGES.find((p) => p.id === "depot")!;
    expect(depot.key).toBe("5");
    expect(depot.panels).toEqual(["PORT", "RISK"]);
  });

  it("färbt Korrelationen nach Vorzeichen", () => {
    expect(corrColor(null)).toBe("transparent");
    expect(corrColor(0.9)).toContain("255, 128, 0");
    expect(corrColor(-0.5)).toContain("102, 184, 255");
  });

  it("schlägt die Depotfrage in ASK vor", () => {
    expect(exampleQuestions(null)[0]).toBe("Wie riskant ist mein Depot?");
    expect(exampleQuestions("SAP GR").slice(0, 3)).toEqual(["Wie steht SAP GR?", "Ist SAP GR teuer im Vergleich zur Branche?", "Wie riskant ist mein Depot?"]);
  });
});
