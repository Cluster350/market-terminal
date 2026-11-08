"""Lädt Chronos-2 (beim ersten Mal ca. 0,5 GB aus dem Internet) und prüft eine Probe-Prognose.

Aufruf aus dem Ordner backend:  python -m scripts.check_forecast
"""

from __future__ import annotations

import math
import random
import sys
import time

from app.config import settings
from app.forecast.backtest import evaluate
from app.forecast.chronos_engine import ChronosEngine, installed
from app.forecast.simple import SimpleEngine


def main() -> int:
    if not installed():
        print("  Das Zusatzpaket fehlt (chronos-forecasting). Bitte Prognose-installieren-Windows.bat ausführen.")
        return 1
    print(f"  Modell {settings.forecast_model} laden (beim ersten Mal Download, bitte warten) …")
    t0 = time.time()
    engine = ChronosEngine(settings.forecast_model, settings.forecast_device)
    engine.load()
    if not engine.ready():
        print(f"  Fehler: {engine.error}")
        return 1
    print(f"  Geladen in {time.time() - t0:.0f} s.")
    rng = random.Random(7)
    level, y = 0.0, []
    for i in range(120):  # träge Reihe mit Saison, wie eine Inflationsrate
        level = 0.85 * level + rng.gauss(0, 0.2)
        y.append(2 + level + 0.3 * math.sin(i * 2 * math.pi / 12))
    t0 = time.time()
    chronos = evaluate(engine, y, 3)
    simple = evaluate(SimpleEngine(), y, 3)
    print(f"  Probe-Prognose mit Rückblick-Test in {time.time() - t0:.1f} s:")
    print(f"    Chronos-2: Fehler {chronos.mae:.3f}, 80-%-Band traf {chronos.cover80 * 100:.0f} %")
    print(f"    Statistik: Fehler {simple.mae:.3f}, 80-%-Band traf {simple.cover80 * 100:.0f} %")
    print("  Chronos-2 ist einsatzbereit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
