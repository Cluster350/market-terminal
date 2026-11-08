import { describe, expect, it } from "vitest";
import { chartDatasets, datasetsToCsv, fileName, parseDisplayNumber, textTable } from "./exporter";

describe("CSV-Export", () => {
  it("liest angezeigte Zahlen mit Einheit, Größenordnung und Vorzeichen", () => {
    expect(parseDisplayNumber("1.234,56")).toEqual({ value: 1234.56, unit: null });
    expect(parseDisplayNumber("+5,4 %")).toEqual({ value: 5.4, unit: "%" });
    expect(parseDisplayNumber("−3,1 Pp")).toEqual({ value: -3.1, unit: "Pp" });
    expect(parseDisplayNumber("1,05 Bio. USD")).toEqual({ value: 1.05e12, unit: "USD" });
    expect(parseDisplayNumber("417 Mrd.")).toEqual({ value: 417e9, unit: null });
    expect(parseDisplayNumber("12 bp")).toEqual({ value: 12, unit: "bp" });
    expect(parseDisplayNumber("211,5 K")).toEqual({ value: 211.5, unit: "K" });
    expect(parseDisplayNumber("▲ 2,3 %")).toEqual({ value: 2.3, unit: "%" });
    for (const t of ["06.11.2026", "NWND US", "neg.", "Index", "–", "2026e", "16:35"]) expect(parseDisplayNumber(t)).toBeNull();
  });

  it("baut Tabellen mit Einheit in der Überschrift und schützt vor Formeln", () => {
    const t = textTable("Test", ["Name", "Kurs", "Tag"], [["Northwind", "159,04", "+3,90 %"], ["=HYPERLINK(1)", "–", "−1,2 %"]]);
    expect(t.columns).toEqual(["Name", "Kurs", "Tag [%]"]);
    expect(t.rows).toEqual([["Northwind", 159.04, 3.9], ["=HYPERLINK(1)", null, -1.2]]);
    const csv = datasetsToCsv([t]);
    expect(csv).toBe("Name;Kurs;Tag [%]\nNorthwind;159,04;3,9\n'=HYPERLINK(1);;-1,2");
    const two = datasetsToCsv([t, { title: "Zweite; Tabelle", columns: ["a"], rows: [[1.5]] }]);
    expect(two.split("\n\n")).toHaveLength(2);
    expect(two).toContain('"Zweite; Tabelle"\na\n1,5');
    expect(fileName("GP", "NWND.US")).toMatch(/^GP-NWND\.US-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(fileName("ECO", null)).toMatch(/^ECO-\d{4}/);
  });

  it("setzt Einheiten je Spalte, je Zeile oder als eigene Spalte und lässt leere Spalten weg", () => {
    const fa = textTable("GuV", ["Position", "GJ 2024", "GJ 2025", "30 Tage", "Δ J/J"], [
      ["Umsatz", "152.283", "168.936", "", "+10,9 %"],
      ["Bruttomarge", "65,9 %", "65,8 %", "", "−0,1 Pp"],
    ]);
    expect(fa.columns).toEqual(["Position", "GJ 2024", "GJ 2025", "Δ J/J", "Δ J/J Einheit"]);
    expect(fa.rows).toEqual([["Umsatz", 152283, 168936, 10.9, "%"], ["Bruttomarge [%]", 65.9, 65.8, -0.1, "Pp"]]);
    const eco = textTable("ECO", ["Zeit", "Land", "Ereignis", "Prognose"], [["07:00", "DE", "Industrieproduktion", "0,12 %"], ["14:30", "US", "Erstanträge", "211 K"]]);
    expect(eco.rows).toEqual([["07:00", "DE", "Industrieproduktion [%]", 0.12], ["14:30", "US", "Erstanträge [K]", 211]]);
    const port = textTable("PORT", ["Wertpapier", "Stück", "Kurs"], [["NRDW GR", "135", "122,44 EUR"], ["QBIT US", "74", "200,60 USD"]]);
    expect(port.columns).toEqual(["Wertpapier", "Stück", "Kurs", "Kurs Einheit"]);
    expect(port.rows).toEqual([["NRDW GR", 135, 122.44, "EUR"], ["QBIT US", 74, 200.6, "USD"]]);
    const kv = textTable("Bewertung", ["Kennzahl", "Wert"], [["Marktkap.", "1,05 Bio. USD"], ["KGV", "29,9"], ["Insider", "2,4 %"]], { unitColumn: true });
    expect(kv.columns).toEqual(["Kennzahl", "Wert", "Einheit"]);
    expect(kv.rows).toEqual([["Marktkap.", 1.05e12, "USD"], ["KGV", 29.9, null], ["Insider", 2.4, "%"]]);
    const w = textTable("W", ["Ticker", "Kurs ▼", ""], [["NWND US", "159,04", "↑↓×"]]);
    expect(w.columns).toEqual(["Ticker", "Kurs"]);
    expect(datasetsToCsv([{ title: "", columns: ["a", "b"], rows: [[1046197699227.0001, 1.168456789]] }])).toBe("a;b\n1046197699227;1,168457");
  });

  it("liest Datenreihen aus Diagrammen (Kategorien, Zeitachse, Punkte, Treemap)", () => {
    const cat = chartDatasets({
      xAxis: { type: "category", data: ["1J", "2J", "10J"] },
      series: [
        { name: "US heute", type: "line", data: [4.1, 4.0, { value: 4.3 }] },
        { name: "US vor 1J", type: "line", data: [4.9, null, 4.6], markLine: { data: [{ yAxis: 0 }] } },
      ],
    }, "Zinskurven");
    expect(cat).toEqual([{ title: "Zinskurven", columns: ["Kategorie", "US heute", "US vor 1J"], rows: [["1J", 4.1, 4.9], ["2J", 4.0, null], ["10J", 4.3, 4.6]] }]);

    const time = chartDatasets({
      xAxis: { type: "time" },
      series: [
        { name: "A", type: "line", data: [["2026-01-02", 100], ["2026-01-01", 99]] },
        { name: "B", type: "line", data: [["2026-01-02", 50]] },
      ],
    });
    expect(time[0].rows).toEqual([["2026-01-01", 99, null], ["2026-01-02", 100, 50]]);

    const pts = chartDatasets({ series: [{ name: "Depot", type: "scatter", data: [{ name: "NWND", value: [12, 3.5] }] }] });
    expect(pts[0].columns).toEqual(["Reihe", "Name", "x", "y"]);
    expect(pts[0].rows).toEqual([["Depot", "NWND", 12, 3.5]]);

    const tree = chartDatasets({ series: [{ type: "treemap", data: [{ name: "Technologie", value: 10, children: [{ name: "NWND.US", value: 7 }, { name: "CTSO.US", value: 3 }] }] }] }, "Heatmap");
    expect(tree[0]).toEqual({ title: "Heatmap", columns: ["Gruppe", "Name", "Wert"], rows: [["Technologie", "NWND.US", 7], ["Technologie", "CTSO.US", 3]] });
    expect(chartDatasets({ series: [] })).toEqual([]);
  });
});
