"""Prognose-Dienst: wählt je Reihe die Methode, die im Rückblick-Test am besten war (Auto-Auswahl),
und liefert Median, Bänder und die Ehrlichkeitsprüfung.

Modi (FORECAST_MODE):
- ``auto``    Chronos-2, wenn installiert, und die eingebaute Statistik; je Reihe gewinnt die
              Methode mit dem kleineren Fehler im Rückblick-Test (Standard)
- ``chronos`` immer Chronos-2 (Statistik nur, solange das Modell lädt oder fehlt)
- ``simple``  nur die eingebaute Statistik
- ``off``     aus
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Optional, Sequence

from ..errors import BadRequest, TerminalError
from .backtest import Score, apply_scales, evaluate
from .base import Engine
from .chronos_engine import DEFAULT_MODEL, ChronosEngine, installed
from .models import FcBand, FcEngineScore, FcEngineStatus, FcQuality, FcSeries, ForecastResult, ForecastStatus
from .simple import SimpleEngine

log = logging.getLogger("terminal.forecast")

MODES = ("auto", "chronos", "simple", "off")
CACHE_SECONDS = 6 * 3600
MIN_POINTS = 6


class ForecastOff(TerminalError):
    status = 503
    code = "forecast_off"


def normalize_mode(raw: str) -> str:
    m = (raw or "auto").strip().lower()
    return {"aus": "off", "statistik": "simple", "einfach": "simple", "chronos2": "chronos", "chronos-2": "chronos"}.get(m, m if m in MODES else "auto")


class ForecastService:
    def __init__(self, mode: str = "auto", model: str = DEFAULT_MODEL, device: str = "cpu", chronos: Optional[Engine] = None):
        self.mode = normalize_mode(mode)
        self.simple = SimpleEngine()
        self.installed = installed()
        self.chronos: Optional[Engine] = chronos
        if self.chronos is None and self.mode in ("auto", "chronos") and self.installed:
            self.chronos = ChronosEngine(model, device)
        self.model = model or DEFAULT_MODEL
        self.device = device or "cpu"
        self._cache: dict[str, tuple[float, ForecastResult]] = {}
        self._task: Optional[asyncio.Task] = None

    # --- Lebenszyklus ------------------------------------------------------------------

    def start(self) -> None:
        """Chronos-2 im Hintergrund laden; bis dahin rechnet die Statistik."""
        loader = getattr(self.chronos, "load", None)
        if self.mode != "off" and callable(loader) and not self.chronos.ready():  # type: ignore[union-attr]
            self._task = asyncio.create_task(asyncio.to_thread(loader))

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    def status(self) -> ForecastStatus:
        engines = [FcEngineStatus(name=self.simple.name, label=self.simple.label, ready=True)]
        if self.chronos is not None:
            engines.insert(0, FcEngineStatus(
                name=self.chronos.name, label=self.chronos.label, ready=self.chronos.ready(),
                loading=bool(getattr(self.chronos, "loading", False)), error=getattr(self.chronos, "error", None),
            ))
        message = None
        if self.mode == "off":
            message = "Prognose ausgeschaltet (FORECAST_MODE=off)."
        elif self.mode in ("auto", "chronos") and not self.installed and self.chronos is None:
            message = "Chronos-2 ist nicht installiert – es rechnet die eingebaute Statistik. Zusatzpaket: Prognose-installieren-Windows.bat."
        elif self.chronos is not None and getattr(self.chronos, "loading", False):
            message = "Chronos-2 lädt … bis dahin rechnet die eingebaute Statistik."
        elif self.chronos is not None and getattr(self.chronos, "error", None):
            message = f"{self.chronos.error} Es rechnet die eingebaute Statistik."  # type: ignore[union-attr]
        active = None if self.mode == "off" else (self.chronos.name if self.chronos is not None and self.chronos.ready() and self.mode != "simple" else self.simple.name)
        return ForecastStatus(mode=self.mode, active=active, engines=engines, model=self.model if self.chronos is not None else None,
                              device=self.device if self.chronos is not None else None, installed=self.installed, message=message)

    def engines(self) -> list[Engine]:
        if self.mode == "off":
            return []
        chronos_ok = self.chronos is not None and self.chronos.ready()
        if self.mode == "simple" or not chronos_ok:
            return [self.simple]
        if self.mode == "chronos":
            return [self.chronos]  # type: ignore[list-item]
        return [self.chronos, self.simple]  # type: ignore[list-item]

    # --- Prognose ----------------------------------------------------------------------

    async def forecast(
        self,
        *,
        kind: str,
        key: str,
        label: str,
        unit: Optional[str],
        freq: str,
        t: Sequence[str],
        y: Sequence[float],
        h: int,
        future_t: Sequence[str],
        consensus: Optional[Sequence[Optional[float]]] = None,
        next_consensus: Optional[float] = None,
        note: Optional[str] = None,
        extra: Optional[dict[str, Optional[float]]] = None,
    ) -> ForecastResult:
        engines = self.engines()
        if not engines:
            raise ForecastOff("Prognose ist ausgeschaltet (FORECAST_MODE=off).")
        if len(y) < MIN_POINTS:
            raise BadRequest(f"Zu wenig Werte für eine Prognose ({len(y)}; mindestens {MIN_POINTS}).")
        sig = hashlib.sha1(
            "|".join([kind, key, str(h), ",".join(e.name for e in engines), ",".join(t[-3:]), ",".join(f"{v:.6g}" for v in y[-3:]),
                      str(len(y)), str(next_consensus)]).encode()
        ).hexdigest()
        hit = self._cache.get(sig)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]

        values = [float(v) for v in y]
        scores: list[Score] = []
        for e in engines:
            scores.append(await asyncio.to_thread(evaluate, e, values, h))
        chosen_i = _choose(scores)
        engine = engines[chosen_i]
        best = scores[chosen_i]
        raw = (await asyncio.to_thread(engine.predict, [values], h))[0]
        table = [apply_scales(r, best.scale50, best.scale80) for r in raw]

        quality = FcQuality(
            origins=best.origins, pairs=best.pairs, mae=best.mae, mae_naive=best.mae_naive, skill=best.skill,
            cover50=best.cover50, cover80=best.cover80, raw_cover80=best.raw_cover80, band_scale=round(best.scale80, 2),
            compared=[FcEngineScore(engine=e.name, label=e.label, mae=s.mae, skill=s.skill) for e, s in zip(engines, scores)],
        )
        if consensus is not None:
            _consensus_check(quality, best, values, consensus)

        verdict, text = judge(quality, kind)
        result = ForecastResult(
            kind=kind, key=key, label=label, unit=unit, freq=freq,
            history=FcSeries(t=list(t), v=values),
            consensus=FcSeries(t=list(t), v=list(consensus)) if consensus is not None else None,
            next_consensus=next_consensus,
            forecast=FcBand(
                t=list(future_t)[:h],
                median=[r[2] for r in table], lo50=[r[1] for r in table], hi50=[r[3] for r in table],
                lo80=[r[0] for r in table], hi80=[r[4] for r in table],
            ),
            engine=engine.name, engine_label=engine.label, quality=quality, verdict=verdict, verdict_text=text,
            note=note, extra=extra or {},
        )
        if len(self._cache) > 400:
            self._cache.clear()
        self._cache[sig] = (time.time(), result)
        return result


def _choose(scores: list[Score]) -> int:
    """Index der Methode mit dem kleinsten Fehler im Rückblick-Test (ohne Test: die erste)."""
    best_i, best_mae = 0, None
    for i, s in enumerate(scores):
        if s.mae is None:
            continue
        if best_mae is None or s.mae < best_mae - 1e-12:
            best_i, best_mae = i, s.mae
    return best_i


def _consensus_check(q: FcQuality, s: Score, y: list[float], consensus: Sequence[Optional[float]]) -> None:
    """Fehler bei der jeweils nächsten Veröffentlichung: Modell gegen Konsens, an denselben Terminen."""
    em, ec = [], []
    for o, med in s.step1.items():
        est = consensus[o] if o < len(consensus) else None
        if est is None:
            continue
        em.append(abs(med - y[o]))
        ec.append(abs(est - y[o]))
    if em:
        q.model_mae1 = sum(em) / len(em)
        q.consensus_mae = sum(ec) / len(ec)
        q.consensus_n = len(em)


def judge(q: FcQuality, kind: str = "") -> tuple[str, str]:
    """Kurzurteil in Worten (für Anzeige und KI-Werkzeug)."""
    if q.origins < 5 or q.skill is None:
        return "wenig", "Zu wenig Verlauf für einen aussagekräftigen Rückblick-Test – Prognose mit Vorsicht lesen."
    pct = round(q.skill * 100)
    if q.skill >= 0.1:
        verdict, text = "gut", f"Im Rückblick {pct} % genauer als „bleibt wie zuletzt“."
    elif q.skill > 0:
        verdict, text = "knapp", f"Im Rückblick nur knapp genauer als „bleibt wie zuletzt“ ({pct} %)."
    else:
        verdict, text = "schwach", "Im Rückblick nicht genauer als „bleibt wie zuletzt“ – Prognose mit Vorsicht lesen."
    if q.cover80 is not None and q.cover80 < 0.6:
        text += f" Die Bänder waren zu eng (80-%-Band traf nur {round(q.cover80 * 100)} %)."
    if q.consensus_mae is not None and q.model_mae1 is not None and q.consensus_n >= 5:
        if q.consensus_mae < q.model_mae1 * 0.95:
            text += " Der Konsens der Analysten lag bisher näher als das Modell."
        elif q.model_mae1 < q.consensus_mae * 0.95:
            text += " Das Modell lag bisher näher als der Konsens."
    return verdict, text
