"""Client für OpenAI-kompatible Server wie LM Studio (http://localhost:1234/v1).

Lokale Modelle sind unterschiedlich gut im Einhalten von Formaten. Der Client fängt die
häufigsten Abweichungen ab: Denk-Abschnitte (<think>), JSON in Codeblöcken, Server ohne
Unterstützung für response_format und Werkzeugaufrufe als Text statt als tool_calls.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Optional

import httpx

from ..errors import TerminalError, UpstreamError


class AIUnavailable(TerminalError):
    status = 503
    code = "ai_offline"


class AITimeout(TerminalError):
    status = 504
    code = "ai_timeout"


_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def strip_think(text: str) -> str:
    """Denk-Abschnitte von Reasoning-Modellen entfernen (auch einen nicht geschlossenen am Anfang)."""
    text = _THINK.sub("", text or "")
    if "<think>" in text.lower():
        text = re.split(r"<think>", text, flags=re.I)[0]
    if "</think>" in text.lower():
        text = re.split(r"</think>", text, flags=re.I)[-1]
    return text.strip()


def extract_json(text: str) -> Optional[Any]:
    """Erstes JSON-Objekt aus einer Modellantwort (auch in ```json-Blöcken oder mit Vortext)."""
    text = strip_think(text)
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        pass
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        try:
            return json.loads(fence.group(1))
        except ValueError:
            pass
    start = text.find("{")
    while start >= 0:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    return None


class LLMClient:
    def __init__(
        self,
        base_url: str,
        *,
        api_key: str = "",
        model: str = "",
        timeout: float = 180,
        max_concurrency: int = 1,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.configured_model = model
        self._model: Optional[str] = model or None
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._http = httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0), headers=headers, transport=transport)
        self._sem = asyncio.Semaphore(max_concurrency)
        self.supports_schema = True  # wird beim ersten 400 auf False gesetzt

    async def close(self) -> None:
        await self._http.aclose()

    async def models(self, timeout: float = 3.0) -> list[str]:
        try:
            r = await self._http.get(f"{self.base_url}/models", timeout=timeout)
        except httpx.HTTPError as exc:
            raise AIUnavailable(self._offline_message()) from exc
        if r.status_code >= 400:
            raise AIUnavailable(f"KI-Server antwortet mit Fehler {r.status_code}.")
        try:
            data = r.json().get("data", [])
        except ValueError:
            data = []
        # Einbettungsmodelle eignen sich nicht für Chat
        ids = [m.get("id") for m in data if isinstance(m, dict) and m.get("id")]
        return [m for m in ids if "embed" not in m.lower()]

    async def model(self) -> str:
        if self._model:
            return self._model
        names = await self.models()
        if not names:
            raise AIUnavailable("In LM Studio ist kein Sprachmodell verfügbar. Bitte ein Modell laden.")
        self._model = names[0]
        return self._model

    def _offline_message(self) -> str:
        return f"LM Studio ist nicht erreichbar ({self.base_url}). In LM Studio unter „Developer“ den Server starten."

    async def chat(
        self,
        messages: list[dict],
        *,
        tools: Optional[list[dict]] = None,
        schema: Optional[dict] = None,
        schema_name: str = "antwort",
        temperature: float = 0.2,
        max_tokens: int = 1200,
    ) -> dict:
        """Eine Chat-Antwort (choices[0].message). Ohne Schema-Unterstützung des Servers wird
        das Schema stattdessen als Anweisung mitgegeben."""
        payload: dict[str, Any] = {
            "model": await self.model(),
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if schema and self.supports_schema:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}}
        r = await self._post(payload)
        if r.status_code == 400 and "response_format" in payload:
            # Server oder Modell kennt keine strukturierte Ausgabe: Schema als Anweisung schicken
            self.supports_schema = False
            payload.pop("response_format")
            payload["messages"] = _with_schema_hint(messages, schema)
            r = await self._post(payload)
        if r.status_code >= 400:
            raise UpstreamError(f"KI-Server: {_error_text(r)}")
        try:
            choice = r.json()["choices"][0]
            message = dict(choice.get("message") or {})
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise UpstreamError("KI-Server: unerwartete Antwort.") from exc
        message["content"] = message.get("content") or ""
        return message

    async def chat_json(self, messages: list[dict], schema: dict, *, schema_name: str = "antwort", max_tokens: int = 900) -> dict:
        """Antwort als JSON-Objekt; bei unlesbarer Antwort ein zweiter Versuch mit klarer Anweisung."""
        msg = await self.chat(messages, schema=schema, schema_name=schema_name, max_tokens=max_tokens, temperature=0.1)
        data = extract_json(msg["content"])
        if isinstance(data, dict):
            return data
        retry = [*_with_schema_hint(messages, schema), {"role": "assistant", "content": msg["content"][:2000]},
                 {"role": "user", "content": "Das war kein gültiges JSON. Antworte nur mit dem JSON-Objekt, ohne weiteren Text."}]
        msg = await self.chat(retry, max_tokens=max_tokens, temperature=0.0)
        data = extract_json(msg["content"])
        if not isinstance(data, dict):
            raise UpstreamError("Das Modell hat kein gültiges JSON geliefert.")
        return data

    async def _post(self, payload: dict) -> httpx.Response:
        async with self._sem:
            try:
                return await self._http.post(f"{self.base_url}/chat/completions", json=payload)
            except httpx.TimeoutException as exc:
                raise AITimeout("Das Sprachmodell hat nicht rechtzeitig geantwortet (LLM_TIMEOUT_SECONDS).") from exc
            except httpx.HTTPError as exc:
                raise AIUnavailable(self._offline_message()) from exc


def _with_schema_hint(messages: list[dict], schema: Optional[dict]) -> list[dict]:
    if not schema:
        return messages
    hint = (
        "Antworte ausschließlich mit einem JSON-Objekt, das diesem JSON-Schema entspricht, "
        "ohne Codeblock und ohne weiteren Text:\n" + json.dumps(schema, ensure_ascii=False)
    )
    out = [dict(m) for m in messages]
    if out and out[0].get("role") == "system":
        out[0]["content"] = f"{out[0]['content']}\n\n{hint}"
    else:
        out.insert(0, {"role": "system", "content": hint})
    return out


def _error_text(r: httpx.Response) -> str:
    try:
        body = r.json()
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err)[:300]
        if err:
            return str(err)[:300]
    except ValueError:
        pass
    return f"HTTP {r.status_code}"
