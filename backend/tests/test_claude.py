"""Claude als Sprachmodell (LLM_MODE=claude): Übersetzung der Nachrichten, Werkzeugschleife, JSON, Fehler, Status.

Ohne Netz und ohne Schlüssel: Die Anthropic-API wird durch ein nachgebautes Objekt ersetzt."""

import asyncio
import json
from types import SimpleNamespace as NS

import anthropic
import httpx2
import pytest

from app.ai.agent import run_agent
from app.ai.claude import ClaudeClient, from_anthropic, to_anthropic, to_tool
from app.ai.client import AIUnavailable
from app.ai.models import AskRequest
from app.errors import UpstreamError


def text(t, stop="end_turn"):
    return NS(content=[NS(type="text", text=t)], stop_reason=stop, model="claude-opus-5-5")


class FakeMessages:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def create(self, **kw):
        self.calls.append(kw)
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


class FakeSDK:
    def __init__(self, replies=(), beta_replies=()):
        self.messages = FakeMessages(replies)
        self.beta = NS(messages=FakeMessages(beta_replies))
        self.models = NS(retrieve=self._retrieve)
        self.retrieved = []

    async def _retrieve(self, model, timeout=None):
        self.retrieved.append(model)
        return NS(id=model)


def _status_error(cls, code, message="Fehler"):
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls(message, response=httpx2.Response(code, request=req), body=None)


def test_message_translation():
    system, msgs = to_anthropic([
        {"role": "system", "content": "Regel A"},
        {"role": "system", "content": "Kontext B"},
        {"role": "user", "content": "Frage"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "t1", "type": "function", "function": {"name": "kurs", "arguments": '{"ticker": "NWND US"}'}},
            {"id": "t2", "type": "function", "function": {"name": "news", "arguments": "kaputt"}}]},
        {"role": "tool", "tool_call_id": "t1", "content": '{"last": 1}'},
        {"role": "tool", "tool_call_id": "t2", "content": '{"fehler": "x"}'},
        {"role": "user", "content": "Jetzt antworten"},
    ])
    assert system == "Regel A\n\nKontext B"
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[1]["content"][0] == {"type": "tool_use", "id": "t1", "name": "kurs", "input": {"ticker": "NWND US"}}
    assert msgs[1]["content"][1]["input"] == {}  # unlesbare Argumente: leer statt Absturz
    # beide Werkzeugergebnisse und der Folgetext in einer Nutzer-Nachricht
    assert [b["type"] for b in msgs[2]["content"]] == ["tool_result", "tool_result", "text"]
    # Antwort beginnt mit dem Modell (Verlauf): vorne eine Nutzer-Nachricht ergänzen
    assert to_anthropic([{"role": "assistant", "content": "Hallo"}])[1][0]["role"] == "user"
    spec = {"type": "function", "function": {"name": "kurs", "description": "Kurs", "parameters": {"type": "object", "properties": {}}}}
    assert to_tool(spec) == {"name": "kurs", "description": "Kurs", "input_schema": {"type": "object", "properties": {}}}


def test_agent_loop_passes_claude_reply_back_unchanged():
    tool_reply = NS(content=[NS(type="thinking", thinking="", signature="sig"),
                             NS(type="tool_use", id="tu1", name="kurs", input={"ticker": "NWND US"})],
                    stop_reason="tool_use", model="claude-opus-5-5")
    sdk = FakeSDK(beta_replies=[tool_reply, text("NWND US steht bei 123,45.")])
    client = ClaudeClient("sk-test", sdk=sdk)

    class Term:
        def now(self):
            import datetime as dt
            return dt.datetime(2026, 11, 20, 12)

    async def fake_tool(t, name, args):
        return {"ticker": "NWND.US", "last": 123.45}

    import app.ai.agent as agent_mod
    orig = agent_mod.run_tool
    agent_mod.run_tool = fake_tool
    try:
        res = asyncio.run(run_agent(client, Term(), AskRequest(question="Wie steht NWND?")))
    finally:
        agent_mod.run_tool = orig
    assert res.engine == "claude" and res.answer.startswith("NWND US") and res.unverified == []
    first, second = sdk.beta.messages.calls
    # Opus 5.5: serverseitiges Ausweichen bei Ablehnung; keine temperature; eigenes Ausgabelimit mit Platz zum Denken
    assert first["fallbacks"] == "default" and first["betas"] == ["server-side-fallback-2026-07-01"]
    assert "temperature" not in first and first["max_tokens"] == 16000 and first["output_config"]["effort"] == "medium"
    assert "tool_choice" not in first
    assert first["tools"][0]["name"] and "input_schema" in first["tools"][0]
    # zweiter Schritt: die Antwort von Claude unverändert (mit Denk-Block), dann das Werkzeugergebnis
    assistant = second["messages"][-2]
    assert assistant["role"] == "assistant" and assistant["content"] is tool_reply.content
    result = second["messages"][-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "tu1" and json.loads(result["content"])["last"] == 123.45


def test_json_schema_refusal_and_errors():
    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}
    sdk = FakeSDK(replies=[text('{"a": 3}'), text("", stop="refusal")])
    news = ClaudeClient("sk-test", model="claude-haiku-5-5", effort="low", max_tokens=4000, sdk=sdk)
    assert asyncio.run(news.chat_json([{"role": "user", "content": "x"}], schema)) == {"a": 3}
    call = sdk.messages.calls[0]  # Haiku: ohne Ausweich-Beta
    assert call["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": schema}}
    with pytest.raises(UpstreamError, match="abgelehnt"):
        asyncio.run(news.chat([{"role": "user", "content": "x"}]))
    # Schema nicht darstellbar: einmal als Anweisung wiederholen
    sdk = FakeSDK(replies=[_status_error(anthropic.BadRequestError, 400, "output_config.format.schema: unsupported keyword"),
                           text('```json\n{"a": 4}\n```')])
    c = ClaudeClient("sk-test", model="claude-haiku-5-5", sdk=sdk)
    assert asyncio.run(c.chat_json([{"role": "system", "content": "S"}, {"role": "user", "content": "x"}], schema)) == {"a": 4}
    assert c._bad_schemas == {"antwort"} and "format" not in sdk.messages.calls[1]["output_config"]
    assert "JSON-Schema" in sdk.messages.calls[1]["system"]
    # andere 400 (z. B. Guthaben leer) schalten die strukturierte Ausgabe nicht ab, sondern melden den Grund
    sdk = FakeSDK(replies=[_status_error(anthropic.BadRequestError, 400, "Your credit balance is too low"), text('{"a": 5}')])
    c = ClaudeClient("sk-test", model="claude-haiku-5-5", sdk=sdk)
    with pytest.raises(AIUnavailable, match="Guthaben"):
        asyncio.run(c.chat_json([{"role": "user", "content": "x"}], schema))
    assert c._bad_schemas == set()
    with pytest.raises(AIUnavailable, match="Guthaben"):  # Status bleibt offline, auch wenn die Modellliste ginge
        asyncio.run(c.models())
    with pytest.raises(UpstreamError, match="Leere Anfrage"):
        asyncio.run(c.chat([{"role": "user", "content": "   "}]))
    # Schlüssel falsch / fehlt
    c = ClaudeClient("sk-test", model="claude-haiku-5-5", sdk=FakeSDK(replies=[_status_error(anthropic.AuthenticationError, 401)]))
    with pytest.raises(AIUnavailable, match="ANTHROPIC_API_KEY"):
        asyncio.run(c.chat([{"role": "user", "content": "x"}]))
    with pytest.raises(AIUnavailable, match="fehlt der API-Schlüssel"):
        asyncio.run(ClaudeClient("", sdk=FakeSDK()).models())
    sdk = FakeSDK()
    assert asyncio.run(ClaudeClient("sk-test", sdk=sdk).models()) == ["claude-opus-5-5"] and sdk.retrieved == ["claude-opus-5-5"]


def test_from_anthropic_tool_calls():
    msg = from_anthropic(NS(content=[NS(type="text", text="Moment"), NS(type="tool_use", id="a", name="news", input={"n": 1})],
                            stop_reason="tool_use", model="m"))
    assert msg["content"] == "Moment" and msg["tool_calls"][0]["function"] == {"name": "news", "arguments": '{"n": 1}'}


def test_service_status_claude_without_key(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_MODE", "claude")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.ai.service import AIService
    from app.config import Settings

    svc = AIService(Settings(), terminal=None, data_mode="eodhd")  # type: ignore[arg-type]
    st = asyncio.run(svc.status())
    assert st.mode == "offline" and "ANTHROPIC_API_KEY" in st.message
    assert svc.news_client is not svc.client and svc.news_client.configured_model == "claude-haiku-5-5"
    assert svc.client.configured_model == "claude-opus-5-5"


def test_notebook_does_not_inherit_anthropic_key():
    from app.notebook import SECRETS

    assert "ANTHROPIC_API_KEY" in SECRETS


def test_step_limit_keeps_tools_but_forbids_calls_and_no_text_fallback():
    tool = lambda i: NS(content=[NS(type="tool_use", id=f"tu{i}", name="maerkte", input={})], stop_reason="tool_use", model="m")
    # Text, der wie ein Werkzeugaufruf aussieht, ist bei Claude kein Aufruf (er hätte kein tool_use-Gegenstück)
    sdk = FakeSDK(beta_replies=[tool(1), tool(2), text('{"name": "kurs", "arguments": {}}')])
    client = ClaudeClient("sk-test", sdk=sdk)

    class Term:
        def now(self):
            import datetime as dt
            return dt.datetime(2026, 11, 20, 12)

    async def fake_tool(t, name, args):
        return {"ok": 1}

    import app.ai.agent as agent_mod
    orig = agent_mod.run_tool
    agent_mod.run_tool = fake_tool
    try:
        res = asyncio.run(run_agent(client, Term(), AskRequest(question="Märkte?"), max_steps=2))
    finally:
        agent_mod.run_tool = orig
    last = sdk.beta.messages.calls[-1]
    assert last["tool_choice"] == {"type": "none"} and last["tools"]
    assert res.answer.startswith("{") and len(res.trace) == 2


def test_wrong_news_model_does_not_disable_ai(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_MODE", "claude")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("CLAUDE_NEWS_MODEL", "claude-gibts-nicht")
    from app.ai.service import AIService
    from app.config import Settings

    svc = AIService(Settings(), terminal=None, data_mode="eodhd")  # type: ignore[arg-type]

    async def ok(model, timeout=None):
        if model == "claude-gibts-nicht":
            raise anthropic.NotFoundError("x", response=httpx2.Response(404, request=httpx2.Request("GET", "https://a")), body=None)
        return NS(id=model)

    svc.client._sdk = NS(models=NS(retrieve=ok))
    svc.news_client._sdk = NS(models=NS(retrieve=ok))
    st = asyncio.run(svc.status())
    assert st.mode == "claude" and "CLAUDE_NEWS_MODEL" in st.message


def test_dotenv_last_line_wins_and_environment_first(tmp_path, monkeypatch):
    from app import config

    env = tmp_path / ".env"
    env.write_text("﻿LLM_MODE=auto\nANTHROPIC_API_KEY=\nX_TEST_KEEP=datei\n# Kommentar\nLLM_MODE=claude\nANTHROPIC_API_KEY=sk-ende\n", encoding="utf-8")
    for k in ("LLM_MODE", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("X_TEST_KEEP", "umgebung")
    monkeypatch.setattr(config, "DOTENV_DUPLICATES", [])
    config._load_dotenv([env])
    import os

    assert os.environ["LLM_MODE"] == "claude" and os.environ["ANTHROPIC_API_KEY"] == "sk-ende"
    assert os.environ["X_TEST_KEEP"] == "umgebung"  # schon gesetzte Umgebungsvariable hat Vorrang
    assert config.DOTENV_DUPLICATES == ["LLM_MODE", "ANTHROPIC_API_KEY"]
