"""Chronos-2 (Amazon, Apache-2.0): vortrainiertes Zeitreihenmodell, läuft lokal auf dem Prozessor.

Optional: braucht das Zusatzpaket ``chronos-forecasting`` (bringt PyTorch mit, siehe
requirements-forecast.txt). Die Modellgewichte (rund 0,5 GB) lädt Hugging Face beim ersten Start
in den Benutzerordner; danach geht es ohne Internet.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import threading
from typing import Any, Optional

from .base import LEVELS

log = logging.getLogger("terminal.forecast")

DEFAULT_MODEL = "amazon/chronos-2"


def installed() -> bool:
    """Ist das Zusatzpaket vorhanden? (ohne es zu laden – das dauert einige Sekunden)"""
    try:
        return importlib.util.find_spec("chronos") is not None and importlib.util.find_spec("torch") is not None
    except (ImportError, ValueError):
        return False


class ChronosEngine:
    name = "chronos"
    label = "Chronos-2"

    def __init__(self, model: str = DEFAULT_MODEL, device: str = "cpu", threads: int = 0):
        self.model = model or DEFAULT_MODEL
        self.device = device or "cpu"
        self.threads = threads
        self.pipe: Any = None
        self.loading = False
        self.error: Optional[str] = None
        self._lock = threading.Lock()  # ein Aufruf gleichzeitig (Speicher, Rechenkerne)

    def ready(self) -> bool:
        return self.pipe is not None

    def load(self) -> None:
        """Modell laden (blockiert einige Sekunden; im Hintergrund-Thread aufrufen)."""
        self.loading, self.error = True, None
        try:
            import torch
            from chronos import BaseChronosPipeline

            n = self.threads or max(1, min(4, (os.cpu_count() or 2) // 2))
            torch.set_num_threads(n)  # LM Studio und das Terminal sollen weiter flüssig laufen
            self.pipe = BaseChronosPipeline.from_pretrained(self.model, device_map=self.device)
            log.info("Prognose: %s geladen (%s, %d Threads)", self.model, self.device, n)
        except Exception as exc:  # noqa: BLE001 – ohne Modell bleibt die Statistik-Prognose
            self.error = _explain(exc)
            log.warning("Prognose: Chronos-2 nicht geladen: %s", exc)
        finally:
            self.loading = False

    def predict(self, series: list[list[float]], h: int) -> list[list[list[float]]]:
        if self.pipe is None:
            raise RuntimeError("Chronos-2 ist nicht geladen.")
        import numpy as np

        return self._run([np.asarray(s, dtype=np.float32) for s in series], h)

    def predict_x(self, series: list[list[float]], covs: list[list[list[float]]], h: int) -> list[list[list[float]]]:
        """Mit Einflussgrößen: Chronos-2 nimmt sie als „past_covariates“ (nur Vergangenheit) entgegen."""
        if self.pipe is None:
            raise RuntimeError("Chronos-2 ist nicht geladen.")
        import numpy as np

        inputs = [
            {"target": np.asarray(s, dtype=np.float32),
             "past_covariates": {f"x{j}": np.asarray(c, dtype=np.float32) for j, c in enumerate(cs)}}
            for s, cs in zip(series, covs)
        ]
        return self._run(inputs, h)

    def _run(self, inputs: list, h: int) -> list[list[list[float]]]:
        with self._lock:
            quantiles, _ = self.pipe.predict_quantiles(inputs, prediction_length=h, quantile_levels=list(LEVELS))
        out: list[list[list[float]]] = []
        for q in quantiles:  # je Reihe: (Variablen, Schritte, Quantile)
            rows = q[0].float().cpu().numpy().tolist()
            out.append([sorted(r) for r in rows])  # Quantile sicher aufsteigend
        return out


def _explain(exc: Exception) -> str:
    text = str(exc)
    if "huggingface" in text.lower() or "connection" in text.lower() or "resolve" in text.lower():
        return "Modell konnte nicht geladen werden (beim ersten Start ist Internet nötig, ca. 0,5 GB)."
    if isinstance(exc, ImportError):
        return "Zusatzpaket fehlt – werkzeuge\\Prognose installieren.bat ausführen."
    return f"Chronos-2 nicht geladen: {text[:160]}"
