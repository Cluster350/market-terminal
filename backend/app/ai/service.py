"""KI-Dienst: wählt den Rechenweg (LM Studio, Demo-KI oder aus), führt die Warteschlange und
hält Ergebnisse vor. Die KI liest nur; Aktionen im Terminal führt erst ein Klick aus."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Optional

import httpx

from ..config import Settings
from ..errors import TerminalError
from ..services.terminal import Terminal
from ..services.tickers import normalize
from . import demo
from .agent import run_agent
from .brief import gather_brief_data, llm_brief
from .client import AIUnavailable, LLMClient
from .models import AiStatus, AskRequest, AskResult, Brief, BriefRequest, NewsInput, NewsInsight, NewsInsightResult, NewsRequest
from .news import NEWS_SCHEMA, InsightQueue, news_messages, parse_insight

log = logging.getLogger("terminal.ai")

PROBE_OK_TTL = 30.0  # Sekunden: so lange gilt „LM Studio erreichbar“
PROBE_FAIL_TTL = 8.0  # kurz, damit ein gerade gestartetes LM Studio schnell erkannt wird
BRIEF_TTL = 15 * 60.0


class AIService:
    def __init__(self, cfg: Settings, terminal: Terminal, data_mode: str, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.cfg = cfg
        self.terminal = terminal
        self.data_mode = data_mode
        self.configured = cfg.llm_mode if cfg.llm_mode in ("auto", "lmstudio", "demo", "off") else "auto"
        self.client: Optional[LLMClient] = None
        if self.configured in ("auto", "lmstudio"):
            self.client = LLMClient(
                cfg.llm_base_url, api_key=cfg.llm_api_key, model=cfg.llm_model, timeout=cfg.llm_timeout,
                max_concurrency=cfg.llm_max_concurrency, transport=transport,
            )
        self.queue = InsightQueue()
        self.queue.paused = lambda: self._foreground > 0 or self._offline
        self._foreground = 0  # laufende Fragen/Briefings: haben Vorrang vor der Warteschlange
        self._offline = False
        self._probe: Optional[tuple[float, Optional[list[str]], str]] = None
        self._probe_lock = asyncio.Lock()
        self._brief_lock = asyncio.Lock()
        self._briefs: dict[tuple, tuple[float, Brief]] = {}
        self._task: Optional[asyncio.Task] = None

    # --- Lebenszyklus ---------------------------------------------------------

    def start(self) -> None:
        if self.client is not None and self._task is None:
            self._task = asyncio.create_task(self.queue.run(self._analyze), name="ki-news-warteschlange")

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self.client is not None:
            await self.client.close()

    # --- Rechenweg ------------------------------------------------------------

    async def _models(self, force: bool = False) -> tuple[Optional[list[str]], str]:
        """Verfügbare Modelle in LM Studio (None = nicht erreichbar) und eine Meldung dazu."""
        if self.client is None:
            return None, ""
        async with self._probe_lock:
            now = time.monotonic()
            if self._probe and not force:
                at, models, msg = self._probe
                if now - at < (PROBE_OK_TTL if models else PROBE_FAIL_TTL):
                    return models, msg
            try:
                models = await self.client.models()
                msg = "" if models else "LM Studio läuft, aber es ist kein Sprachmodell verfügbar. Bitte in LM Studio ein Modell laden."
            except AIUnavailable as exc:
                models, msg = None, exc.message
            self._probe = (now, models or None, msg)
            self._offline = not models
            return models or None, msg

    def _mark_offline(self) -> None:
        self._probe = None
        self._offline = True

    async def engine(self) -> Optional[str]:
        """'lmstudio', 'demo' oder None (keine KI verfügbar)."""
        if self.configured == "off":
            return None
        if self.configured == "demo":
            return "demo"
        models, _ = await self._models()
        if models:
            return "lmstudio"
        if self.configured == "auto" and self.data_mode == "demo":
            return "demo"
        return None

    async def status(self) -> AiStatus:
        base = self.cfg.llm_base_url
        if self.configured == "off":
            return AiStatus(mode="off", configured="off", base_url=base, message="KI ausgeschaltet (LLM_MODE=off in der .env).")
        if self.configured == "demo":
            return AiStatus(mode="demo", configured="demo", base_url=base, model=demo.DEMO_MODEL,
                            message="Demo-KI aktiv: regelbasiert, ohne Sprachmodell (LLM_MODE=demo).")
        models, msg = await self._models()
        if models:
            assert self.client is not None
            model = self.client.configured_model or models[0]
            note = ""
            if self.client.configured_model and self.client.configured_model not in models:
                note = f" Hinweis: LLM_MODEL „{self.client.configured_model}“ ist in LM Studio nicht aufgeführt."
            return AiStatus(mode="lmstudio", configured=self.configured, base_url=base, model=model, models=models[:20],
                            queue=len(self.queue), message=f"LM Studio verbunden, Modell {model}.{note}")
        if self.configured == "auto" and self.data_mode == "demo":
            return AiStatus(mode="demo", configured="auto", base_url=base, model=demo.DEMO_MODEL,
                            message=f"Demo-KI aktiv (regelbasiert). {msg} Dann ordnet das Sprachmodell ein.")
        return AiStatus(mode="offline", configured=self.configured, base_url=base, queue=len(self.queue), message=msg or "KI nicht verfügbar.")

    async def _require(self) -> str:
        engine = await self.engine()
        if engine is None:
            raise AIUnavailable((await self.status()).message)
        return engine

    # --- News-Einordnung ------------------------------------------------------

    async def news(self, req: NewsRequest) -> NewsInsightResult:
        engine = await self.engine()
        if engine is None or not req.items:
            return NewsInsightResult(engine=engine)  # type: ignore[arg-type]
        if engine == "demo":
            return NewsInsightResult(engine="demo", insights={i.id: demo.analyze_news(i) for i in req.items})
        known, pending, failed = self.queue.submit("lmstudio", req.items, req.priority)
        return NewsInsightResult(engine="lmstudio", insights=known, pending=pending, failed=failed)

    async def _analyze(self, engine: str, item: NewsInput) -> NewsInsight:
        if engine == "demo" or self.client is None:
            return demo.analyze_news(item)
        names: dict[str, str] = {}
        if item.symbols:
            with contextlib.suppress(TerminalError):
                names = {q.ticker: q.name for q in await self.terminal.quotes(item.symbols[:5]) if q.name}
        try:
            data = await self.client.chat_json(news_messages(item, names), NEWS_SCHEMA, schema_name="news_einordnung", max_tokens=1000)
        except AIUnavailable:
            self._mark_offline()
            raise
        return parse_insight(data, item, engine="lmstudio", model=await self.client.model())

    def _relevance(self, engine: str, items) -> dict[str, int]:
        out: dict[str, int] = {}
        for n in items:
            if engine == "demo":
                out[n.id] = demo.analyze_news(demo.to_input(n)).relevance
            elif (hit := self.queue.get("lmstudio", n.id)) is not None:
                out[n.id] = hit.relevance
        return out

    # --- Morgenbriefing -------------------------------------------------------

    async def brief(self, req: BriefRequest) -> Brief:
        engine = await self._require()
        tickers: list[str] = []
        for raw in req.tickers:
            with contextlib.suppress(TerminalError):
                t = normalize(raw)
                if t not in tickers:
                    tickers.append(t)
        key = (engine, tuple(sorted(tickers)))
        async with self._brief_lock:
            hit = self._briefs.get(key)
            if hit and not req.refresh and time.monotonic() - hit[0] < BRIEF_TTL:
                return hit[1]
            data = await gather_brief_data(self.terminal, tickers)
            relevance = self._relevance(engine, data.news)
            if engine == "demo" or self.client is None:
                result = demo.brief(data, relevance)
            else:
                self._foreground += 1
                try:
                    result = await llm_brief(self.client, data, relevance)
                except AIUnavailable:
                    self._mark_offline()
                    raise
                finally:
                    self._foreground -= 1
                # Meldungen des Briefings im Hintergrund einordnen (für das nächste Briefing und NEWS)
                self.queue.submit("lmstudio", [demo.to_input(n) for n in data.news[:25]], "normal")
            self._briefs[key] = (time.monotonic(), result)
            if len(self._briefs) > 20:
                self._briefs.pop(next(iter(self._briefs)))
            return result

    # --- Fragen ---------------------------------------------------------------

    async def ask(self, req: AskRequest) -> AskResult:
        engine = await self._require()
        if engine == "demo" or self.client is None:
            return await demo.ask(self.terminal, req)
        self._foreground += 1
        try:
            return await run_agent(self.client, self.terminal, req, max_steps=self.cfg.llm_max_steps)
        except AIUnavailable:
            self._mark_offline()
            raise
        finally:
            self._foreground -= 1
