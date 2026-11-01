import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerText } from "../screens/ai";
import { PAGES, pageForFn } from "../state/workspace";
import { exampleQuestions, toNewsInput } from "./ai";
import { FN, resolveFn } from "./commands";
import type { NewsItem } from "./types";

describe("KI-Funktionen in der Befehlszeile", () => {
  it("kennt BRIEF und ASK samt deutscher Wörter", () => {
    expect(resolveFn("brief")).toBe("BRIEF");
    expect(resolveFn("BRIEFING")).toBe("BRIEF");
    expect(resolveFn("morgen")).toBe("BRIEF");
    expect(resolveFn("KI")).toBe("ASK");
    expect(resolveFn("frage")).toBe("ASK");
    expect(FN.ASK.needsTicker).toBe(false);
  });

  it("legt BRIEF und ASK auf die NEWS-Seite", () => {
    const news = PAGES.find((p) => p.id === "news")!;
    expect(news.panels).toEqual(["TOP", "BRIEF", "ASK"]);
    expect(news.pool).toContain("W");
    expect(pageForFn("ASK")).toBe("news");
  });
});

describe("Übergabe an die KI", () => {
  it("kürzt Meldungen auf die Grenzen des Backends", () => {
    const n: NewsItem = {
      id: "x".repeat(120), date: "2026-10-28T10:00:00Z", title: "T".repeat(800), content: "C".repeat(9000), link: null, source: "S",
      symbols: ["A.US", "B.US", "C.US", "D.US", "E.US", "F.US", "G.US"], tags: [], topic: "company", sentiment: { polarity: 0.2, neg: null, neu: null, pos: null }, urgent: false,
    } as unknown as NewsItem;
    const i = toNewsInput(n);
    expect(i.id).toHaveLength(80);
    expect(i.title).toHaveLength(500);
    expect(i.content).toHaveLength(4000);
    expect(i.symbols).toHaveLength(6);
    expect(i.polarity).toBe(0.2);
  });

  it("schlägt Fragen zum aktiven Wertpapier vor", () => {
    expect(exampleQuestions("SAP GR")[0]).toBe("Wie steht SAP GR?");
    expect(exampleQuestions(null)).not.toContain("Wie steht null?");
  });
});

describe("Antwortanzeige", () => {
  it("markiert Zahlen ohne Beleg und setzt Fettdruck", () => {
    const html = renderToStaticMarkup(<AnswerText text={"**Northwind** bei 150,75 USD, Ziel 512,00 USD; 1512,00 ist etwas anderes"} unverified={["512,00"]} />);
    expect(html).toContain("<b>Northwind</b>");
    expect(html.match(/<mark/g)).toHaveLength(1);
    expect(html).toContain('class="unverified"');
    expect(html).toContain(">512,00</mark> USD");
  });

  it("lässt Text ohne Markierungen unverändert", () => {
    const html = renderToStaticMarkup(<AnswerText text={"Keine Zahlen (a+b)*"} unverified={[]} />);
    expect(html).toContain("Keine Zahlen (a+b)*");
    expect(html).not.toContain("<mark");
  });
});
