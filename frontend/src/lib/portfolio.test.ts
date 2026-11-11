import { describe, expect, it } from "vitest";
import { corrColor } from "../screens/portfolio";
import { PAGES, pageForFn } from "../state/workspace";
import { exampleQuestions } from "./ai";
import { resolveFn } from "./commands";
import { mergePosition, parseCsv, parseDate, parseNear, parseNumber, toCsv, type Portfolio, type Position } from "./portfolio";

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
    // Export im Terminal-Format (SAP GR, TT.MM.JJJJ) – der Import liest es wieder ein
    expect(csv.split("\r\n")[1]).toBe("SAP GR;12,5;182,25;15.03.2024;;");
    expect(parseCsv(csv).positions[0]).toMatchObject({ ticker: "SAP.XETRA", quantity: 12.5, cost: 182.25, opened: "2024-03-15" });
  });

  it("liest in kommagetrennten Zeilen den Punkt als Dezimalzeichen (150.125 war 150125)", () => {
    const r = parseCsv("Ticker,Quantity,Price\nNWND US,1.500,150.125\nSAP GR,10,99.5");
    expect(r.positions[0]).toMatchObject({ ticker: "NWND.US", quantity: 1.5, cost: 150.125 });
    expect(r.positions[1]).toMatchObject({ quantity: 10, cost: 99.5 });
    // mit Semikolon oder Tab bleibt 1.000 die deutsche Tausenderschreibweise
    expect(parseCsv("NWND US;1.000;150,125").positions[0]).toMatchObject({ quantity: 1000, cost: 150.125 });
    expect(parseNumber("1.000")).toBe(1000);
    expect(parseNumber("1.000", true)).toBe(1);
  });

  it("nennt Zeilennummern je Ticker und lehnt unmögliche Daten ab", () => {
    const r = parseCsv("NWND US; 10; 100; 31.02.2024\nSAP GR; 5\nNWND US; 5; 120");
    expect(r.lines["NWND.US"]).toEqual([1, 3]);
    expect(r.positions.find((x) => x.ticker === "NWND.US")?.opened).toBeNull();
    expect(r.errors.some((e) => e.includes("Zeile 1") && e.includes("31.02.2024"))).toBe(true);
  });
});

describe("Zahlen und Daten", () => {
  it("liest 0.865 als Dezimalzahl, 1.000 als Tausend", () => {
    expect(parseNumber("0.865")).toBe(0.865);
    expect(parseNumber("0.500")).toBe(0.5);
    expect(parseNumber("1.000")).toBe(1000);
    expect(parseNumber("12.345.678")).toBe(12345678);
    expect(parseNumber("1,5")).toBe(1.5);
  });
  it("akzeptiert nur echte Kalendertage", () => {
    expect(parseDate("29.02.2024")).toBe("2024-02-29");
    expect(parseDate("29.02.2025")).toBeNull();
    expect(parseDate("31.04.2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("5.1.26")).toBe("2026-01-05");
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

  it("behält eine abweichende Handelswährung über Export und Import", () => {
    const p: Portfolio = { version: 1, base: "EUR", benchmark: null, cash: 0, updated: null, sample: false, positions: [{ ...pos("SAP.XETRA", 10, 100, null), currency: "USD", note: "x" }] };
    const csv = toCsv(p);
    expect(csv.split("\r\n")[0]).toBe("Ticker;Stück;Einstandskurs;Kaufdatum;Notiz;Währung");
    expect(parseCsv(csv).positions[0]).toMatchObject({ currency: "USD", note: "x" });
    expect(parseCsv("SAP GR;10;100;;Notiz;keine").positions[0].currency).toBeNull();
  });

  it("liest eine Kursmarke in der Lesart, die näher am Kurs liegt", () => {
    expect(parseNear("1.163", 1.16)).toBe(1.163); // EUR/USD
    expect(parseNear("24.500", 24000)).toBe(24500); // DAX
    expect(parseNear("1.163", null)).toBe(1163); // ohne Kurs wie bisher
    expect(parseNear("1,163", 1.16)).toBe(1.163);
    expect(parseNear("182,5", 180)).toBe(182.5);
    expect(parseNear("abc", 1)).toBeNull();
  });
});
