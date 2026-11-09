// Regressionstests der Fehlersuche nach Krypto, Faktoren und Tagesdaten (CSV-Kleinstwerte, Rotationstexte,
// Intraday-Diagramm in Euro, Alarmwerte beim Bearbeiten).

import { describe, expect, it } from "vitest";
import { levelText } from "../screens/alerts";
import { datasetsToCsv, textTable } from "./exporter";
import { inEur, intradayNormalized } from "./intradayLines";
import { parseNumber } from "./portfolio";
import { rotationTestText, signedPct } from "./rotation";
import type { Intraday } from "./types";

const bars = (t: number[], c: (number | null)[]): Intraday => ({ ticker: "X", interval: "5m", t, o: c, h: c, l: c, c, v: c.map(() => null) });

describe("CSV-Export von Kleinstwerten", () => {
  it("behält die gültigen Stellen von Kursen unter 0,01 (Shiba Inu)", () => {
    // vorher: 0,000037 statt 0,00003656 – feste sechs Nachkommastellen
    const t = textTable("Krypto", ["Coin", "Kurs USD"], [["SHIB Shiba Inu", "0,00003656"], ["DOGE Dogecoin", "0,6923"]]);
    expect(datasetsToCsv([t])).toBe("Coin;Kurs USD\nSHIB Shiba Inu;0,00003656\nDOGE Dogecoin;0,6923");
    const raw = datasetsToCsv([{ title: "", columns: ["a", "b", "c", "d"], rows: [[3.65625e-5, 1.234e-7, -0.0000004, 0]] }]);
    expect(raw).toBe("a;b;c;d\n0,0000365625;0,0000001234;-0,0000004;0"); // nie in Exponentenschreibweise
    // übrige Zahlen wie bisher: höchstens 6 Nachkommastellen, kein Rauschen bei großen Beträgen
    expect(datasetsToCsv([{ title: "", columns: ["a", "b", "c", "d"], rows: [[1046197699227.0001, 1.168456789, 100, -1.2]] }])).toBe(
      "a;b;c;d\n1046197699227;1,168457;100;-1,2",
    );
  });
});

describe("Rotation: Prozentwerte um null", () => {
  it("zeigt auf 0,0 gerundete Werte ohne Minuszeichen", () => {
    expect(signedPct(-0.00004)).toBe("0,0 %"); // vorher „−0,0 %“
    expect(signedPct(0.00004)).toBe("0,0 %");
    expect(signedPct(-0.0123)).toBe("−1,2 %");
    expect(signedPct(0.01)).toBe("+1,0 %");
    expect(signedPct(null)).toBe("–");
    const test = { quadrants: { fuehrend: { h13: { n: 9, avg: -0.0001, up: 0.5 } }, erholend: { h13: { n: 3, avg: 0.012, up: 0.6 } } } } as never;
    const text = rotationTestText(test, "w", 13);
    expect(text).toContain("führend 0,0 %");
    expect(text).toContain("erholend +1,2 %");
    expect(text).not.toContain("−0,0");
  });
});

describe("CRYP-Intraday in Euro", () => {
  it("rechnet Dollar-Kurse mit EUR/USD zum selben Zeitpunkt um, am Wochenende mit dem letzten Kurs", () => {
    // Bitcoin in USD unverändert, der Euro steigt von 1,10 auf 1,20: in Euro fällt Bitcoin um 1/12
    const btc = bars([100, 200, 300, 400], [100, 100, null, 100]);
    const fx = bars([150, 250, 350], [1.1, null, 1.2]);
    const eur = inEur(btc, fx)!;
    expect(eur.c).toEqual([null, 100 / 1.1, null, 100 / 1.2]); // vor dem ersten Devisenkurs: kein Wert
    const line = intradayNormalized(eur, 0);
    expect(line[line.length - 1][1]).toBeCloseTo((1.1 / 1.2) * 100, 9); // vorher blieb die Linie bei 100 (Dollar)
    expect(inEur(btc, undefined)).toBeUndefined();
    expect(inEur(undefined, fx)).toBeUndefined();
  });
});

describe("Alarm bearbeiten", () => {
  it("füllt den Wert mit allen Stellen vor, sodass Speichern nur der Notiz ihn nicht ändert", () => {
    // vorher: fmt(x, 4) – Shiba Inu 0,00006 wurde zu „0,0001“ (beim Speichern +67 %), 0,00004 zu „0“
    expect(levelText(0.00006)).toBe("0,00006");
    expect(levelText(0.0000366)).toBe("0,0000366");
    expect(levelText(1.16845)).toBe("1,16845"); // Devisen in Pips: vorher 1,1685
    for (const x of [0.00006, 0.0000366, 1.16845, 150, 1000, 123.456, 159421.6415]) expect(parseNumber(levelText(x))).toBe(x);
  });
});
