import { describe, expect, it } from "vitest";
import { explain, glossaryAnswer } from "./glossary";

describe("Glossar für Einsteiger", () => {
  it("beantwortet Begriffsfragen", () => {
    expect(glossaryAnswer("Was ist eine Put-Option?")?.[0]).toBe("Put");
    expect(glossaryAnswer("Was bedeutet Strike")?.[0]).toBe("Strike");
    expect(glossaryAnswer("was sind ETFs?")?.[0]).toBe("ETF");
    expect(glossaryAnswer("Erkläre mir das KGV")?.[0]).toBe("KGV (TTM)");
    expect(glossaryAnswer("Wie steht NWND?")).toBeNull();
    expect(glossaryAnswer("Was ist ein Rückwärts-DCF?")?.[0]).toBe("Rückwärts-DCF");
    expect(explain("Kapitalkosten")).toContain("Risiko");
  });
  it("erklärt Beta für Aktie und Depot", () => {
    expect(explain("Beta")).toContain("Vergleichsindex");
  });
});
