// Regressionstests zum Feedback der zehn Trader-Agenten
import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";
import { displayTicker, fmtPrice, typeDe } from "./format";
import { explain } from "./glossary";
import { initial, reducer } from "../state/workspace";
import { searchPick } from "../shell/CommandLine";
import { parseNumber, periodChanges } from "../screens/screener";
import { earningsMarkers, vwapSeries, type Bar } from "../screens/GP";

describe("Befehlszeile", () => {
  it("versteht deutsche Wortbefehle", () => {
    expect(parseCommand("watchlist")).toEqual({ kind: "fn", fn: "W", ticker: null });
    expect(parseCommand("NWND US kurschart")).toEqual({ kind: "fn", fn: "GP", ticker: "NWND.US" });
    expect(parseCommand("dividende")).toEqual({ kind: "fn", fn: "DVD", ticker: null });
  });

  it("wählt Firmennamen nur bei eindeutigem Treffer", () => {
    const hits = [
      { ticker: "NWND.US", name: "Northwind Systems Inc" },
      { ticker: "NRTH.US", name: "Northern Rail Corp" },
    ];
    expect(searchPick("northwind", hits)).toBe("NWND.US");
    expect(searchPick("nwnd", hits)).toBe("NWND.US");
    expect(searchPick("north", hits)).toBeNull(); // mehrdeutig
    expect(searchPick("elbt", [{ ticker: "ELBT.XETRA", name: "Elbtal Software SE" }])).toBe("ELBT.XETRA");
    expect(searchPick("rhnc gr", hits)).toBeNull(); // mehrere Wörter: kein stiller Wechsel
  });
});

describe("Anzeige", () => {
  it("Bloomberg-Indexkürzel, deutsche Wertpapierarten, Pips", () => {
    expect(displayTicker("GSPC.INDX")).toBe("SPX Index");
    expect(displayTicker("STOXX50E.INDX")).toBe("SX5E Index");
    expect(typeDe("Common Stock")).toBe("Aktie");
    expect(fmtPrice(1.15953, "EURUSD.FOREX")).toBe("1,15953");
    expect(fmtPrice(116.0312, "USDJPY.FOREX")).toBe("116,031");
    expect(explain("KGV (TTM)")).toMatch(/Kurs-Gewinn/);
  });
});

describe("Screener-Eingaben", () => {
  it("akzeptiert 3 %, Dezimalkomma und Tausenderpunkte", () => {
    expect(parseNumber("3%")).toBe(3);
    expect(parseNumber(" 3,5 % ")).toBe(3.5);
    expect(parseNumber("1.000,5")).toBe(1000.5);
    expect(parseNumber("50 Mrd.")).toBe(50);
    expect(parseNumber("drei")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("Watchlist-Kennzahlen", () => {
  it("1M und YTD gegen den letzten Schluss vor dem Stichtag", () => {
    const h = { ticker: "X.US", currency: "USD", t: ["2025-12-30", "2025-12-31", "2026-09-30", "2026-10-30"], o: [], h: [], l: [], c: [90, 100, 110, 121], v: [] };
    const p = periodChanges(h);
    expect(p.ytd).toBeCloseTo(21);
    expect(p.m1).toBeCloseTo(10);
    const y = { ...h, ticker: "US10Y.GBOND", c: [4.0, 4.1, 3.8, 3.7] };
    expect(periodChanges(y).ytd).toBeCloseTo(-40); // bp
  });
});

describe("Chart", () => {
  const bar = (time: string, close: number, volume: number | null = 100): Bar => ({ time, open: close, high: close + 1, low: close - 1, close, volume }) as Bar;

  it("VWAP je Tag, ohne Volumen leer", () => {
    const v = vwapSeries([bar("2026-10-29", 10, 100), bar("2026-10-29", 20, 300)]);
    expect(v[1].value).toBeCloseTo((10 * 100 + 20 * 300) / 400);
    expect(vwapSeries([bar("2026-10-29", 10, null)])).toEqual([]);
  });

  it("Earnings-Marker am Reaktionstag, Farbe nach Überraschung", () => {
    const bars = [bar("2026-10-27", 1), bar("2026-10-28", 1), bar("2026-10-29", 1)];
    const m = earningsMarkers(
      [
        { date: "2026-09-30", reportDate: "2026-10-27", epsActual: 1.1, epsEstimate: 1.0, surprisePct: 10, timing: "AfterMarket" },
        { date: "2026-06-30", reportDate: "2026-10-29", epsActual: 0.9, epsEstimate: 1.0, surprisePct: -10, timing: "BeforeMarket" },
      ],
      bars,
    );
    expect(m.map((x) => [x.time, x.color])).toEqual([
      ["2026-10-28", "#29d17d"],
      ["2026-10-29", "#ff5252"],
    ]);
  });
});

describe("Arbeitsbereich", () => {
  const base = () => ({ ...initial(""), mode: "demo", security: "NWND.US" });

  it("fixiertes Panel behält sein Wertpapier; Befehle für das Panel ändern nur dieses", () => {
    let s = reducer(base(), { type: "pin", panel: 1, ticker: "GSPC.INDX" });
    s = reducer(s, { type: "security", ticker: "QBIT.US" });
    expect(s.security).toBe("QBIT.US");
    expect(s.pins.equity[1]).toBe("GSPC.INDX");
    s = reducer(s, { type: "active", index: 1 });
    s = reducer(s, { type: "security", ticker: "GDAXI.INDX", viaCommand: true });
    expect(s.pins.equity[1]).toBe("GDAXI.INDX");
    expect(s.security).toBe("QBIT.US");
  });

  it("Esc führt im Panel zurück", () => {
    let s = reducer(base(), { type: "fn", fn: "HELP", panel: 0 });
    expect(s.pages.equity.panels[0]).toBe("HELP");
    s = reducer(s, { type: "back" });
    expect(s.pages.equity.panels[0]).toBe("GP");
    expect(reducer(s, { type: "back" })).toBe(s); // nichts mehr zurück
  });

  it("Wiederverknüpfen übernimmt das Wertpapier der anderen Fenster", () => {
    const s = reducer({ ...base(), linked: false }, { type: "linked", linked: true, security: "ELBT.XETRA" });
    expect(s.security).toBe("ELBT.XETRA");
    expect(s.linked).toBe(true);
  });

  it("Layoutwechsel passt fixierte Panels an", () => {
    let s = reducer(base(), { type: "pin", panel: 3, ticker: "GSPC.INDX" });
    s = reducer(s, { type: "layout", layout: "split" });
    expect(s.pins.equity).toHaveLength(2);
  });
});
