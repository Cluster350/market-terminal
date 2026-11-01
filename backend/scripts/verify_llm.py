"""Prüft die Anbindung an LM Studio (oder einen anderen OpenAI-kompatiblen Server).

Aufruf (aus backend/):
    python -m scripts.verify_llm

Getestet wird, was das Terminal braucht: Server erreichbar, Modell geladen, einfache Antwort,
strukturierte Ausgabe (JSON-Schema) für die News-Einordnung, Werkzeugaufrufe für den Assistenten
und eine vollständige Frage mit Demo-Daten. Am Ende stehen Zeiten und Empfehlungen.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

from app.ai.agent import run_agent
from app.ai.client import LLMClient, extract_json, strip_think
from app.ai.models import AskRequest, NewsInput
from app.ai.news import NEWS_SCHEMA, news_messages, parse_insight
from app.ai.tools import TOOL_BY_NAME
from app.cache import TTLCache
from app.config import Settings
from app.errors import TerminalError
from app.providers.demo import DemoProvider
from app.services.terminal import Terminal

if os.name == "nt":
    os.system("")  # Farben in der Windows-Konsole einschalten

OK = "\033[32mOK\033[0m"
FAIL = "\033[31mFEHLER\033[0m"
WARN = "\033[33mHINWEIS\033[0m"

SAMPLE = NewsInput(
    id="pruefung-1",
    title="Northwind Systems hebt Jahresprognose an und übertrifft Gewinnerwartungen",
    content=(
        "Northwind Systems hat im dritten Quartal einen Gewinn je Aktie von 1,92 USD erzielt, Analysten hatten 1,71 USD erwartet. "
        "Der Umsatz stieg um 14 Prozent auf 28,4 Mrd. USD. Für das Gesamtjahr erwartet das Unternehmen nun ein Umsatzwachstum von 12 Prozent."
    ),
    date="2026-10-28T20:05:00Z",
    source="PRUEFUNG",
    symbols=["NWND.US"],
    topic="earnings",
)


def line(state: str, name: str, text: str) -> None:
    print(f"[{state}] {name}: {text}")


async def main() -> int:
    cfg = Settings()
    print(f"LLM_MODE={cfg.llm_mode} · LLM_BASE_URL={cfg.llm_base_url} · LLM_MODEL={cfg.llm_model or '(erstes geladenes Modell)'}")
    if cfg.llm_mode in ("off", "demo"):
        line(WARN, "Einstellung", f"LLM_MODE={cfg.llm_mode}: Das Terminal nutzt LM Studio nicht. In der .env LLM_MODE=auto setzen.")
    client = LLMClient(cfg.llm_base_url, api_key=cfg.llm_api_key, model=cfg.llm_model, timeout=cfg.llm_timeout)
    tips: list[str] = []
    try:
        # 1. Server und Modelle
        try:
            models = await client.models(timeout=5)
        except TerminalError as exc:
            line(FAIL, "Server", exc.message)
            print("\nSo geht es: LM Studio öffnen, ein Modell laden, links „Developer“ wählen und „Start Server“ einschalten.")
            print("Läuft LM Studio auf einem anderen Rechner, in der .env LLM_BASE_URL=http://<IP>:1234/v1 eintragen")
            print("und in LM Studio „Serve on Local Network“ aktivieren.")
            return 1
        if not models:
            line(FAIL, "Modelle", "Der Server läuft, aber es ist kein Sprachmodell verfügbar. In LM Studio ein Modell laden.")
            return 1
        model = await client.model()
        line(OK, "Server", f"erreichbar, {len(models)} Modell(e): {', '.join(models[:6])}{' …' if len(models) > 6 else ''}")
        if cfg.llm_model and cfg.llm_model not in models:
            line(WARN, "Modell", f"LLM_MODEL „{cfg.llm_model}“ steht nicht in der Liste. Namen in LM Studio prüfen (Developer → Modellname).")
        line(OK, "Modell", f"verwendet wird „{model}“")

        # 2. Einfache Antwort (lädt das Modell bei Bedarf)
        t0 = time.monotonic()
        try:
            msg = await client.chat([{"role": "user", "content": "Antworte nur mit dem Wort OK."}], max_tokens=200)
        except TerminalError as exc:
            line(FAIL, "Antwort", exc.message)
            return 1
        secs = time.monotonic() - t0
        raw = msg.get("content", "")
        line(OK, "Antwort", f"„{strip_think(raw)[:60]}“ in {secs:.1f} s{' (Denk-Abschnitt erkannt und entfernt)' if '<think>' in raw.lower() else ''}")
        if secs > 60:
            tips.append("Schon die erste Antwort dauert über eine Minute (beim ersten Mal lädt LM Studio das Modell; sonst ein kleineres Modell wählen).")

        # 3. Strukturierte Ausgabe für die News-Einordnung
        t0 = time.monotonic()
        try:
            data = await client.chat_json(news_messages(SAMPLE, {"NWND.US": "Northwind Systems Inc"}), NEWS_SCHEMA, schema_name="news_einordnung", max_tokens=1000)
            insight = parse_insight(data, SAMPLE, engine="lmstudio", model=model)
            secs = time.monotonic() - t0
            how = "mit JSON-Schema" if client.supports_schema else "ohne JSON-Schema (Schema als Anweisung)"
            line(OK, "News-Einordnung", f"{secs:.1f} s, {how}: Relevanz {insight.relevance}/3, Stimmung {insight.sentiment:+.2f}, Ereignis {insight.event}")
            print(f"      „{insight.summary}“")
            if insight.relevance < 2 or insight.sentiment <= 0:
                tips.append("Die Probe-Meldung (Prognose angehoben, Gewinn über Erwartung) wurde schwach eingeordnet. Ein größeres Modell ordnet meist treffender ein.")
            if secs > 30:
                tips.append(f"Eine Meldung braucht {secs:.0f} s. Bei vielen Meldungen dauert die Einordnung lange; ein kleineres oder schnelleres Modell hilft.")
        except TerminalError as exc:
            line(FAIL, "News-Einordnung", exc.message)
            tips.append("Das Modell liefert kein verwertbares JSON. Ein Instruct-Modell (z. B. Qwen 3, Llama 3.1, Mistral) laden.")

        # 4. Werkzeugaufruf
        t0 = time.monotonic()
        try:
            msg = await client.chat(
                [{"role": "system", "content": "Hole Zahlen immer über Werkzeuge."}, {"role": "user", "content": "Wie steht die Aktie NWND US?"}],
                tools=[TOOL_BY_NAME["kurs"].spec()],
                max_tokens=600,
            )
            secs = time.monotonic() - t0
            calls = msg.get("tool_calls") or []
            if calls:
                fn = calls[0].get("function", {})
                line(OK, "Werkzeuge", f"{secs:.1f} s, Aufruf {fn.get('name')}({fn.get('arguments')})")
            else:
                data = extract_json(msg.get("content", ""))
                if isinstance(data, dict) and data.get("name") == "kurs":
                    line(WARN, "Werkzeuge", f"{secs:.1f} s, Aufruf nur als Text erkannt (funktioniert, ist aber weniger zuverlässig)")
                else:
                    line(WARN, "Werkzeuge", f"{secs:.1f} s, kein Werkzeugaufruf. Antwort: „{strip_think(msg.get('content', ''))[:80]}“")
                    tips.append("Das Modell ruft keine Werkzeuge auf. Für den Assistenten (ASK) ein Modell mit Tool-Unterstützung laden (in LM Studio mit Hammer-Symbol).")
        except TerminalError as exc:
            line(FAIL, "Werkzeuge", exc.message)

        # 5. Vollständige Frage mit Demo-Daten
        terminal = Terminal(DemoProvider(), TTLCache())
        t0 = time.monotonic()
        try:
            res = await run_agent(client, terminal, AskRequest(question="Wie steht Northwind Systems (NWND US) und wie ist die Aktie bewertet?"), max_steps=cfg.llm_max_steps)
            line(OK if res.trace else WARN, "Assistent", f"{res.seconds:.1f} s, {res.steps} Schritt(e), Daten: {', '.join(t.summary for t in res.trace) or 'keine'}")
            print("      " + res.answer.replace("\n", "\n      ")[:900])
            if res.unverified:
                line(WARN, "Zahlenprüfung", f"ohne Beleg: {', '.join(res.unverified)}")
                tips.append("Die Antwort enthält Zahlen, die nicht aus den Daten stammen. Das Terminal markiert sie gelb; ein größeres Modell hält sich besser an die Daten.")
        except TerminalError as exc:
            line(FAIL, "Assistent", exc.message)
        finally:
            await terminal.p.close()
        print(f"      (Gesamtdauer Assistent {time.monotonic() - t0:.1f} s)")
    finally:
        await client.close()

    print()
    if tips:
        print("Empfehlungen:")
        for tip in tips:
            print(f" - {tip}")
    else:
        print("Alles bereit. Das Terminal nutzt LM Studio automatisch (unten rechts steht dann „KI: LM Studio“).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001 – Prüfskript soll alles melden
        print(f"[{FAIL}] Unerwarteter Fehler: {type(exc).__name__}: {exc}")
        print("Bitte ein Foto dieses Fensters schicken.")
        sys.exit(1)
