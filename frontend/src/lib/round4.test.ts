import { describe, expect, it } from "vitest";
import { normalizeTicker, parseCommand } from "./commands";
import { displayTicker } from "./format";
import { vwapSeries, type Bar } from "../screens/GP";
import { periodChanges } from "../screens/screener";
import { searchPick } from "../shell/CommandLine";
import type { History } from "./types";

describe("displayTicker -> normalizeTicker (Rundreise, auch für Verlauf und Tab-Vervollständigung)", () => {
  // Alle Instrumente des Katalogs (backend/app/providers/base.py) und typische Sonderfälle
  const tickers = [
    "GSPC.INDX", "NDX.INDX", "DJI.INDX", "RUT.INDX", "GSPTSE.INDX", "GDAXI.INDX", "MDAXI.INDX", "STOXX50E.INDX",
    "FCHI.INDX", "FTSE.INDX", "SSMI.INDX", "N225.INDX", "HSI.INDX", "AXJO.INDX", "VIX.INDX", "IXIC.INDX",
    "EURUSD.FOREX", "USDJPY.FOREX", "BTC-USD.CC", "US10Y.GBOND", "UK30Y.GBOND", "GOLD.COMM", "WTI.COMM",
    "NWND.US", "ELBT.XETRA", "THMS.LSE", "MTHR.SW", "LMRE.PA", "DLTA.AS",
  ];
  it.each(tickers)("%s", (t) => {
    expect(normalizeTicker(displayTicker(t))).toBe(t);
    expect(parseCommand(`${displayTicker(t)} GP`)).toEqual({ kind: "fn", fn: "GP", ticker: t });
  });
});

describe("vwapSeries", () => {
  it("setzt an jedem Handelstag zurück (Zeitstempel in UTC-Sekunden, Regression)", () => {
    const bar = (iso: string, close: number, volume: number): Bar => {
      const ts = Date.parse(iso) / 1000;
      return { time: ts as Bar["time"], open: close, high: close, low: close, close, volume, ts };
    };
    const v = vwapSeries([bar("2026-10-29T14:00:00Z", 10, 100), bar("2026-10-29T14:05:00Z", 20, 100), bar("2026-10-30T14:00:00Z", 30, 100)]);
    expect(v[1].value).toBeCloseTo(15);
    expect(v[2].value).toBeCloseTo(30); // neuer Tag: nicht (10+20+30)/3
  });
});

describe("periodChanges", () => {
  const h: History = {
    ticker: "X.US", currency: "USD", t: ["2026-11-30", "2026-12-30", "2026-12-31"],
    o: [null, null, null], h: [null, null, null], l: [null, null, null], c: [90, 99, 100], v: [null, null, null],
  };
  it("YTD am 1. Januar ist 0, nicht die Vorjahresperformance (Regression)", () => {
    expect(periodChanges(h, Date.parse("2027-01-01T10:00:00Z")).ytd).toBeCloseTo(0);
    expect(periodChanges(h, Date.parse("2026-12-31T10:00:00Z")).ytd).toBeNull(); // keine Vorjahreskurse
    expect(periodChanges(h, Date.parse("2027-01-01T10:00:00Z")).m1).toBeCloseTo((100 / 90 - 1) * 100);
  });
});

describe("searchPick", () => {
  it("nimmt nie den gerade abgelehnten Ticker (Regression: wäre ungeprüft geöffnet worden)", () => {
    const hits = [{ ticker: "FOO.US", name: "Foo Corp" }];
    expect(searchPick("foo", hits)).toBe("FOO.US");
    expect(searchPick("foo", hits, "FOO.US")).toBeNull();
    expect(searchPick("foo", [...hits, { ticker: "FOO.XETRA", name: "Foo AG" }], "FOO.US")).toBe("FOO.XETRA");
  });
});

describe("Fixierte Panels und Befehle", () => {
  it("Befehl wechselt nur das fixierte aktive Panel – aber nicht, wenn es kein Wertpapier zeigt (Regression)", async () => {
    const { initial, reducer } = await import("../state/workspace");
    let s = initial();
    s = reducer(s, { type: "security", ticker: "NWND.US" });
    s = reducer(s, { type: "pin", panel: 0, ticker: "GSPC.INDX" }); // GP fixiert auf den Index
    const viaCommand = reducer(s, { type: "security", ticker: "ELBT.XETRA", viaCommand: true });
    expect(viaCommand.pins.equity[0]).toBe("ELBT.XETRA");
    expect(viaCommand.security).toBe("NWND.US");
    // Panel 0 zeigt jetzt WEI (ohne Wertpapier): der Befehl gilt dem Arbeitsbereich
    const wei = reducer(s, { type: "fn", fn: "WEI", panel: 0 });
    const after = reducer(wei, { type: "security", ticker: "ELBT.XETRA", viaCommand: true });
    expect(after.security).toBe("ELBT.XETRA");
  });
});
