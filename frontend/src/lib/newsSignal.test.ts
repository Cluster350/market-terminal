import { describe, expect, it } from "vitest";
import type { NewsInsight } from "./ai";
import { DEFAULT_SIGNAL, FRESH_MS, isSignalSettings, judge, sortNews, type SignalSettings } from "./newsSignal";
import { currentToasts, dismissToast, pushToast } from "./toasts";
import type { NewsItem } from "./types";

const NOW = Date.parse("2026-11-05T14:00:00Z");

const news = (over: Partial<NewsItem> = {}): NewsItem => ({
  id: "n1", date: new Date(NOW - 60_000).toISOString(), title: "Meldung", content: "", link: null, source: null,
  symbols: ["NWND.US"], tags: [], topic: "company", sentiment: { polarity: 0, pos: 0, neu: 1, neg: 0 }, urgent: false, ...over,
});

const insight = (id: string, relevance: number): NewsInsight => ({
  id, summary: "", sentiment: 0, reason: "", tickers: [], sectors: [], event: "other", relevance, horizon: "kurzfristig",
  engine: "demo", model: "", created: "",
});

const mine = new Set(["NWND.US"]);
const set = (over: Partial<SignalSettings>): SignalSettings => ({ ...DEFAULT_SIGNAL, ...over });

describe("Nachrichten-Signal: Entscheidung je Meldung", () => {
  it("meldet Eilmeldungen zu eigenen Werten sofort, fremde nur bei „alle“", () => {
    const own = news({ urgent: true });
    const other = news({ urgent: true, symbols: ["ELBT.XETRA"] });
    expect(judge(own, DEFAULT_SIGNAL, mine, undefined, false, 0)).toBe("signal");
    expect(judge(other, DEFAULT_SIGNAL, mine, undefined, false, 0)).toBe("skip");
    expect(judge(other, set({ scope: "all" }), mine, undefined, false, 0)).toBe("signal");
    expect(judge(own, set({ mode: "off" }), mine, undefined, false, 0)).toBe("skip");
  });

  it("normale Meldungen nur im Modus „wichtig“ mit KI-Relevanz ab 2", () => {
    const n = news();
    expect(judge(n, DEFAULT_SIGNAL, mine, insight("n1", 3), true, 0)).toBe("skip"); // nur Eilmeldungen
    const imp = set({ mode: "important" });
    expect(judge(n, imp, mine, undefined, false, 0)).toBe("skip"); // ohne KI keine Einordnung
    expect(judge(n, imp, mine, undefined, true, 10_000)).toBe("wait");
    expect(judge(n, imp, mine, undefined, true, 10 * 60_000)).toBe("skip"); // KI zu langsam
    expect(judge(n, imp, mine, insight("n1", 2), true, 0)).toBe("signal");
    expect(judge(n, imp, mine, insight("n1", 1), true, 0)).toBe("skip");
  });

  it("prüft gespeicherte Einstellungen", () => {
    expect(isSignalSettings(DEFAULT_SIGNAL)).toBe(true);
    expect(isSignalSettings({ mode: "laut", scope: "mine", sound: true })).toBe(false);
    expect(isSignalSettings({ mode: "urgent", scope: "mine" })).toBe(false);
    expect(isSignalSettings(null)).toBe(false);
  });
});

describe("Nachrichten-Signal: Abruf einordnen", () => {
  it("beim allerersten Start gilt alles als bekannt", () => {
    const r = sortNews([news({ urgent: true })], null, DEFAULT_SIGNAL, mine, undefined, false, NOW, new Map());
    expect(r.signals).toEqual([]);
    expect(Array.from(r.seen)).toEqual(["n1"]);
  });

  it("meldet jede Meldung nur einmal und alte gar nicht", () => {
    const fresh = news({ id: "a", urgent: true });
    const old = news({ id: "b", urgent: true, date: new Date(NOW - FRESH_MS - 1000).toISOString() });
    const broken = news({ id: "c", urgent: true, date: "kein Datum" });
    const r = sortNews([fresh, old, broken], new Set(), DEFAULT_SIGNAL, mine, undefined, false, NOW, new Map());
    expect(r.signals.map((n) => n.id)).toEqual(["a"]);
    expect(r.seen).toEqual(new Set(["a", "b", "c"]));
    const again = sortNews([fresh], r.seen, DEFAULT_SIGNAL, mine, undefined, false, NOW + 60_000, new Map());
    expect(again.signals).toEqual([]);
  });

  it("wartet auf die KI und meldet, sobald die Einordnung da ist", () => {
    const imp = set({ mode: "important" });
    const first = new Map<string, number>();
    const n = news();
    const r1 = sortNews([n], new Set(), imp, mine, undefined, true, NOW, first);
    expect(r1.wait.map((x) => x.id)).toEqual(["n1"]);
    expect(r1.seen.has("n1")).toBe(false); // noch offen
    const r2 = sortNews([n], r1.seen, imp, mine, { n1: insight("n1", 3) }, true, NOW + 20_000, first);
    expect(r2.signals.map((x) => x.id)).toEqual(["n1"]);
    expect(r2.seen.has("n1") && !first.has("n1")).toBe(true);
  });
});

describe("Hinweise unten rechts", () => {
  it("zeigt neueste oben, ersetzt gleiche Kennung und höchstens fünf", () => {
    for (let i = 0; i < 7; i++) pushToast({ id: `t${i}`, kind: "news", icon: "📰", message: `M${i}`, meta: "" }, 0);
    expect(currentToasts().map((t) => t.id)).toEqual(["t6", "t5", "t4", "t3", "t2"]);
    pushToast({ id: "t4", kind: "urgent", icon: "⚡", message: "neu", meta: "" }, 0);
    expect(currentToasts().map((t) => t.id)).toEqual(["t4", "t6", "t5", "t3", "t2"]);
    expect(currentToasts()[0].kind).toBe("urgent");
    for (const t of currentToasts()) dismissToast(t.id);
    expect(currentToasts()).toEqual([]);
  });
});
