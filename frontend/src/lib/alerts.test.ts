import { describe, expect, it } from "vitest";
import { toInput } from "../screens/alerts";
import { markStyle } from "../screens/GP";
import { pageForFn, PAGES } from "../state/workspace";
import { alertStatus, conditionLabel, takeNewEvents, type Alert, type AlertEvent } from "./alerts";
import { resolveFn } from "./commands";

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: "a", ticker: "NWND.US", kind: "price", level: 150, direction: "above", alarm: true, active: true, note: "",
  created: "2026-11-02T10:00:00Z", triggeredAt: null, triggeredPrice: null, ...over,
});

const ev = (id: string): AlertEvent => ({
  id, alertId: "a", ticker: "NWND.US", kind: "price", level: 150, direction: "above", price: 151, changePct: 1, at: "2026-11-02T10:00:00Z", message: "x",
});

describe("Kursalarme", () => {
  it("meldet beim ersten Start keine alten Auslösungen, danach nur neue", () => {
    const first = takeNewEvents([ev("1"), ev("2")], null);
    expect(first.fresh).toEqual([]);
    expect([...first.seen]).toEqual(["1", "2"]);
    const next = takeNewEvents([ev("3"), ev("1"), ev("2")], first.seen);
    expect(next.fresh.map((e) => e.id)).toEqual(["3"]);
    expect(takeNewEvents([ev("3")], next.seen).fresh).toEqual([]);
  });

  it("beschreibt Bedingung und Zustand", () => {
    expect(conditionLabel(alert())).toBe("über 150,00");
    expect(conditionLabel(alert({ ticker: "EURUSD.FOREX", level: 1.085, direction: "below" }))).toBe("unter 1,08500");
    expect(conditionLabel(alert({ kind: "change", level: 5, direction: "below" }))).toBe("Tagesminus ab 5,0 %");
    expect(conditionLabel(alert({ kind: "change", level: 0.5 }))).toBe("Tagesplus ab 0,50 %");
    expect(alertStatus(alert())).toBe("armed");
    expect(alertStatus(alert({ active: false, triggeredAt: "2026-11-02T11:00:00Z" }))).toBe("fired");
    expect(alertStatus(alert({ active: false }))).toBe("off");
    expect(alertStatus(alert({ alarm: false }))).toBe("mark");
  });

  it("übersetzt das Formular in die API-Eingabe", () => {
    expect(toInput("NWND.US", "above", 150, "")).toMatchObject({ kind: "price", direction: "above", alarm: true });
    expect(toInput("NWND.US", "chgDown", 5, "Stopp")).toMatchObject({ kind: "change", direction: "below", level: 5, note: "Stopp" });
    expect(toInput("NWND.US", "mark", 140, "")).toMatchObject({ kind: "price", direction: null, alarm: false });
  });

  it("zeichnet Marken je Zustand unterschiedlich", () => {
    expect(markStyle(alert()).title).toBe("🔔");
    expect(markStyle(alert({ active: false, triggeredAt: "x" })).title).toBe("✓");
    expect(markStyle(alert({ alarm: false, note: "Unterstützung" })).title).toBe("Unterstützung");
    expect(markStyle(alert()).color).not.toBe(markStyle(alert({ alarm: false })).color);
  });

  it("kennt den Befehl ALRT", () => {
    expect(resolveFn("alarm")).toBe("ALRT");
    expect(resolveFn("KURSMARKEN")).toBe("ALRT");
    expect(pageForFn("ALRT")).toBe("depot");
    expect(PAGES.find((p) => p.id === "equity")!.pool).toContain("ALRT");
  });
});
