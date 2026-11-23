"""Claude über die Anthropic-API (Bezahlung nach Verbrauch, Schlüssel ANTHROPIC_API_KEY in der .env).

Gleiche Schnittstelle wie der LM-Studio-Client (``client.py``): Die übrigen KI-Teile (News-Einordnung, BRIEF, ASK,
Damodaran-Persona) schicken Nachrichten im OpenAI-Format und bekommen ``{"content", "tool_calls"}`` zurück. Dieser
Client übersetzt in das Format der Anthropic-API und zurück. Die Antwort von Claude geht unverändert (``_raw``) in den
nächsten Schritt einer Werkzeugschleife zurück – samt Denk-Blöcken, wie es die API verlangt.

Die KI bleibt nur lesend: Claude bekommt ausschließlich die lesenden Werkzeuge des Terminals (tools.py).
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Optional

import anthropic

from ..errors import UpstreamError
from .client import AITimeout, AIUnavailable, _with_schema_hint, extract_json

DEFAULT_MODEL = "claude-opus-5-5"  # Fragen (ASK), Briefing, Damodaran-Persona
DEFAULT_NEWS_MODEL = "claude-haiku-5-5"  # News-Einordnung: viele kleine Aufgaben, günstig und schnell
# Modelle mit serverseitigem Ausweichen, wenn ein Sicherheitsfilter eine Anfrage ablehnt
FALLBACK_MODELS = ("claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"
BLOCK_SECONDS = 300  # so lange gilt ein Schlüssel- oder Guthabenfehler, bevor neu geprüft wird


class ClaudeClient:
    engine = "claude"
    supports_schema = True

    def __init__(self, api_key: str, *, model: str = "", effort: str = "medium", max_tokens: int = 16000,
                 timeout: float = 180, max_concurrency: int = 2, sdk: Any = None, env_name: str = "CLAUDE_MODEL"):
        self.configured_model = model or DEFAULT_MODEL
        self.base_url = "https://api.anthropic.com"
        self.effort = effort
        self.max_tokens = max_tokens
        self._key = api_key
        self._sdk = sdk if sdk is not None else anthropic.AsyncAnthropic(api_key=api_key or None, timeout=timeout, max_retries=2)
        self._sem = asyncio.Semaphore(max_concurrency)
        self._checked = False
        self.env_name = env_name  # Name der Einstellung in der .env (für verständliche Meldungen)
        self._bad_schemas: set[str] = set()  # Schemas, die die API nicht als strukturierte Ausgabe annimmt
        self._blocked: Optional[tuple[float, str]] = None  # zuletzt: Schlüssel/Guthaben-Fehler (Zeit, Meldung)

    async def close(self) -> None:
        close = getattr(self._sdk, "close", None)
        if close is not None:
            await close()

    async def models(self, timeout: float = 5.0) -> list[str]:
        """Prüft Schlüssel und Modell (kostenlose Abfrage der Modellliste). Liefert das eingestellte Modell."""
        if not self._key:
            raise AIUnavailable("Für Claude fehlt der API-Schlüssel: in der .env ANTHROPIC_API_KEY=… eintragen und das Terminal neu starten.")
        if self._blocked and time.monotonic() - self._blocked[0] < BLOCK_SECONDS:
            # Guthaben leer o. Ä.: die Modellliste ginge trotzdem – Status bleibt ein paar Minuten „offline“
            raise AIUnavailable(self._blocked[1])
        if not self._checked:
            try:
                await self._sdk.models.retrieve(self.configured_model, timeout=timeout)
            except anthropic.NotFoundError as exc:
                raise AIUnavailable(f"Claude-Modell „{self.configured_model}“ gibt es nicht. {self.env_name} in der .env prüfen.") from exc
            except anthropic.APIError as exc:
                raise _map_error(exc) from exc
            self._checked = True
        return [self.configured_model]

    async def model(self) -> str:
        return self.configured_model

    async def chat(self, messages: list[dict], *, tools: Optional[list[dict]] = None, schema: Optional[dict] = None,
                   schema_name: str = "antwort", temperature: float = 0.2, max_tokens: int = 1200, tool_choice: str = "auto") -> dict:
        """Eine Antwort im OpenAI-Format (content, tool_calls). ``temperature`` und ``max_tokens`` der Aufrufer gelten
        für lokale Modelle; Claude denkt vor der Antwort, deshalb ein eigenes, großzügiges Limit.
        ``tool_choice="none"``: Werkzeuge beschreiben, aber keinen Aufruf zulassen."""
        structured = bool(schema) and schema_name not in self._bad_schemas
        system, conv = to_anthropic(messages if not schema or structured else _with_schema_hint(messages, schema))
        if not conv:
            raise UpstreamError("Leere Anfrage – bitte eine Frage eingeben.")
        params: dict[str, Any] = {"model": self.configured_model, "max_tokens": self.max_tokens, "messages": conv,
                                  "output_config": {"effort": self.effort}}
        if system:
            params["system"] = system
        if tools:
            params["tools"] = [to_tool(t) for t in tools]
            if tool_choice == "none":
                params["tool_choice"] = {"type": "none"}
        if structured:
            params["output_config"] = {**params["output_config"], "format": {"type": "json_schema", "schema": schema}}
        try:
            resp = await self._create(params)
        except anthropic.BadRequestError as exc:
            if not structured or not _about_schema(exc):
                raise self._fail(exc) from exc
            # nur dieses Schema lässt sich nicht als strukturierte Ausgabe darstellen: als Anweisung schicken
            self._bad_schemas.add(schema_name)
            return await self.chat(messages, tools=tools, schema=schema, schema_name=schema_name, max_tokens=max_tokens, tool_choice=tool_choice)
        return from_anthropic(resp)

    def _fail(self, exc: Exception) -> Exception:
        err = _map_error(exc)
        if isinstance(err, AIUnavailable):  # Schlüssel/Guthaben: Status zeigt es, bis es wieder geht
            self._blocked = (time.monotonic(), err.message)
            self._checked = False
        return err

    async def chat_json(self, messages: list[dict], schema: dict, *, schema_name: str = "antwort", max_tokens: int = 900) -> dict:
        msg = await self.chat(messages, schema=schema, schema_name=schema_name, max_tokens=max_tokens)
        data = extract_json(msg["content"])
        if not isinstance(data, dict):
            raise UpstreamError("Claude hat kein gültiges JSON geliefert.")
        return data

    async def _create(self, params: dict) -> Any:
        async with self._sem:
            try:
                if self.configured_model in FALLBACK_MODELS:
                    # lehnt ein Sicherheitsfilter ab, rechnet die API dieselbe Anfrage mit einem passenden Modell neu
                    resp = await self._sdk.beta.messages.create(**params, betas=[FALLBACK_BETA], fallbacks="default")
                else:
                    resp = await self._sdk.messages.create(**params)
            except anthropic.BadRequestError:
                raise
            except anthropic.APIError as exc:
                raise self._fail(exc) from exc
        self._blocked = None
        if getattr(resp, "stop_reason", None) == "refusal":
            raise UpstreamError("Claude hat diese Anfrage abgelehnt (Sicherheitsfilter). Bitte anders formulieren.")
        return resp


def _about_schema(exc: Exception) -> bool:
    """Betrifft eine 400 die strukturierte Ausgabe (Schema nicht unterstützt) – nicht etwa Guthaben oder Länge?"""
    msg = (getattr(exc, "message", "") or str(exc)).lower()
    return any(w in msg for w in ("schema", "output_config", "json_schema", "format"))


def _map_error(exc: Exception) -> Exception:
    if isinstance(exc, anthropic.APITimeoutError):
        return AITimeout("Claude hat nicht rechtzeitig geantwortet (LLM_TIMEOUT_SECONDS).")
    if isinstance(exc, anthropic.APIConnectionError):
        return AIUnavailable("Claude ist nicht erreichbar – Internetverbindung prüfen.")
    if isinstance(exc, anthropic.AuthenticationError):
        return AIUnavailable("Der Claude-API-Schlüssel wird nicht angenommen. ANTHROPIC_API_KEY in der .env prüfen.")
    if isinstance(exc, anthropic.PermissionDeniedError):
        return AIUnavailable("Der Claude-API-Schlüssel hat keinen Zugriff auf dieses Modell.")
    if isinstance(exc, anthropic.RateLimitError):
        return UpstreamError("Claude: zu viele Anfragen in kurzer Zeit – bitte kurz warten.")
    if isinstance(exc, anthropic.APIStatusError):
        msg = getattr(exc, "message", "") or str(exc)
        if "credit" in msg.lower() or "balance" in msg.lower():
            return AIUnavailable("Claude: Das Guthaben ist aufgebraucht – auf platform.claude.com unter „Billing“ aufladen.")
        return UpstreamError(f"Claude: {msg[:300]}")
    return UpstreamError(f"Claude: {exc}"[:300])


# --- Übersetzung OpenAI-Format <-> Anthropic-Format --------------------------------------------


def to_tool(spec: dict) -> dict:
    fn = spec.get("function") or spec
    params = fn.get("parameters") or {"type": "object", "properties": {}}
    return {"name": fn["name"], "description": fn.get("description", ""), "input_schema": params}


def _args(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        out = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return out if isinstance(out, dict) else {}


def to_anthropic(messages: list[dict]) -> tuple[str, list[dict]]:
    """System-Texte werden zusammengefasst; Werkzeugergebnisse (role tool) werden tool_result-Blöcke in einer
    Nutzer-Nachricht; aufeinanderfolgende Nachrichten derselben Rolle werden zusammengelegt."""
    system: list[str] = []
    out: list[dict] = []

    def add(role: str, blocks: Any) -> None:
        if isinstance(blocks, str):
            blocks = [{"type": "text", "text": blocks}] if blocks.strip() else []
        if not blocks:
            return
        if out and out[-1]["role"] == role:
            prev = out[-1]["content"]
            out[-1]["content"] = (prev if isinstance(prev, list) else [{"type": "text", "text": prev}]) + list(blocks)
        else:
            out.append({"role": role, "content": list(blocks)})

    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            if content.strip():
                system.append(content)
        elif role == "tool":
            add("user", [{"type": "tool_result", "tool_use_id": m.get("tool_call_id") or "call_0", "content": content or "{}"}])
        elif role == "assistant":
            if m.get("_raw") is not None:
                out.append({"role": "assistant", "content": m["_raw"]})  # unverändert zurück (Denk-Blöcke)
                continue
            blocks: list[dict] = [{"type": "text", "text": content}] if content.strip() else []
            for call in m.get("tool_calls") or []:
                fn = call.get("function") or {}
                blocks.append({"type": "tool_use", "id": call.get("id") or "call_0", "name": fn.get("name", ""), "input": _args(fn.get("arguments"))})
            add("assistant", blocks)
        else:
            add("user", content)
    if out and out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": [{"type": "text", "text": "(Fortsetzung)"}]})
    return "\n\n".join(system), out


def from_anthropic(resp: Any) -> dict:
    text: list[str] = []
    calls: list[dict] = []
    for block in resp.content or []:
        kind = getattr(block, "type", None)
        if kind == "text":
            text.append(block.text)
        elif kind == "tool_use":
            calls.append({"id": block.id, "type": "function",
                          "function": {"name": block.name, "arguments": json.dumps(block.input or {}, ensure_ascii=False)}})
    msg: dict[str, Any] = {"role": "assistant", "content": "".join(text), "_raw": resp.content, "model": getattr(resp, "model", None)}
    if calls:
        msg["tool_calls"] = calls
    return msg
