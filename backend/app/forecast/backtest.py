"""Rückblick-Test: Die Prognose wird an früheren Zeitpunkten so erstellt, als wäre die Zukunft
unbekannt, und mit dem tatsächlichen Verlauf verglichen.

Gemessen wird
- der mittlere absolute Fehler (MAE) des Medians,
- derselbe Fehler der einfachen Regel „bleibt wie zuletzt“ (naiv) – daraus die Güte
  (``skill`` = 1 − MAE Modell / MAE naiv; > 0 heißt besser als die einfache Regel),
- wie oft der tatsächliche Wert im 50- bzw. 80-%-Band lag (sollte etwa 50 % bzw. 80 % sein).
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Optional, Sequence

from .base import Engine, quantile

MAX_ORIGINS = 24
MIN_CAL_PAIRS = 10  # weniger Vergleichswerte: Bänder unverändert lassen
SCALE_MIN, SCALE_MAX = 0.75, 4.0


@dataclass
class Pair:
    origin: int
    step: int
    actual: float
    q: tuple[float, float, float, float, float]  # 10/25/50/75/90-%-Quantil


def _norm(p: Pair, lo: int, hi: int) -> float:
    """Abstand zum Median in Einheiten der halben Bandbreite (≤ 1: im Band)."""
    d = p.actual - p.q[2]
    w = (p.q[hi] - p.q[2]) if d >= 0 else (p.q[2] - p.q[lo])
    if w > 0:
        return abs(d) / w
    return 0.0 if d == 0 else math.inf


def band_scales(pairs: Sequence[Pair]) -> tuple[float, float]:
    """Faktoren für 50- und 80-%-Band, damit sie im Rückblick so oft trafen wie versprochen."""
    if len(pairs) < MIN_CAL_PAIRS:
        return 1.0, 1.0
    s50 = quantile([_norm(p, 1, 3) for p in pairs], 0.5)
    s80 = quantile([_norm(p, 0, 4) for p in pairs], 0.8)
    clamp = lambda x: min(SCALE_MAX, max(SCALE_MIN, x if math.isfinite(x) else SCALE_MAX))  # noqa: E731
    return clamp(s50), clamp(s80)


def apply_scales(row: Sequence[float], s50: float, s80: float) -> list[float]:
    q10, q25, q50, q75, q90 = row
    lo50, hi50 = q50 - s50 * (q50 - q25), q50 + s50 * (q75 - q50)
    lo80, hi80 = q50 - s80 * (q50 - q10), q50 + s80 * (q90 - q50)
    return [min(lo80, lo50), lo50, q50, hi50, max(hi80, hi50)]


def cross_coverage(pairs: Sequence[Pair]) -> tuple[Optional[float], Optional[float]]:
    """Trefferquote der kalibrierten Bänder, ehrlich geprüft: Jeder Startpunkt wird mit Faktoren
    bewertet, die ohne ihn berechnet wurden."""
    if not pairs:
        return None, None
    by: dict[int, list[Pair]] = {}
    for p in pairs:
        by.setdefault(p.origin, []).append(p)
    in50 = in80 = 0
    for o, own in by.items():
        s50, s80 = band_scales([p for p in pairs if p.origin != o])
        for p in own:
            q = apply_scales(p.q, s50, s80)
            in50 += q[1] <= p.actual <= q[3]
            in80 += q[0] <= p.actual <= q[4]
    return in50 / len(pairs), in80 / len(pairs)


@dataclass
class Score:
    engine: str
    origins: int = 0
    pairs: int = 0
    mae: Optional[float] = None
    mae_naive: Optional[float] = None
    cover50: Optional[float] = None
    cover80: Optional[float] = None
    mae1: Optional[float] = None  # nur Schritt 1 (Vergleich mit dem Konsens)
    step1: dict[int, float] = field(default_factory=dict)  # Startpunkt -> Median für Schritt 1
    pairs_list: list[Pair] = field(default_factory=list)
    raw_cover80: Optional[float] = None  # Trefferquote des 80-%-Bands vor der Kalibrierung
    scale50: float = 1.0
    scale80: float = 1.0

    @property
    def skill(self) -> Optional[float]:
        if self.mae is None or not self.mae_naive:
            return None
        return 1 - self.mae / self.mae_naive


def origins_for(n: int, h: int, min_train: int) -> list[int]:
    """Startpunkte (Länge der Trainingsreihe) für den Rückblick-Test, jüngste zuletzt."""
    count = min(MAX_ORIGINS, n - min_train)
    if count <= 0:
        return []
    return list(range(n - count, n))


def evaluate(engine: Engine, y: Sequence[float], h: int, min_train: Optional[int] = None) -> Score:
    y = [float(x) for x in y]
    n = len(y)
    min_train = min_train or max(8, n // 2)
    starts = origins_for(n, h, min_train)
    score = Score(engine=engine.name)
    if not starts:
        return score
    preds = engine.predict([y[:o] for o in starts], h)
    err, err_naive, in50, in80 = [], [], 0, 0
    err1: list[float] = []
    for o, table in zip(starts, preds):
        for k in range(min(h, n - o)):
            actual = y[o + k]
            q10, q25, q50, q75, q90 = table[k]
            score.pairs_list.append(Pair(o, k, actual, (q10, q25, q50, q75, q90)))
            err.append(abs(q50 - actual))
            err_naive.append(abs(y[o - 1] - actual))
            in50 += q25 <= actual <= q75
            in80 += q10 <= actual <= q90
            if k == 0:
                err1.append(abs(q50 - actual))
                score.step1[o] = q50
    m = len(err)
    score.origins, score.pairs = len(starts), m
    if m:
        score.mae = sum(err) / m
        score.mae_naive = sum(err_naive) / m
        score.raw_cover80 = in80 / m
        score.mae1 = sum(err1) / len(err1) if err1 else None
        # Bänder kalibrieren; die angezeigte Trefferquote ist die der kalibrierten Bänder (über Kreuz geprüft)
        score.scale50, score.scale80 = band_scales(score.pairs_list)
        if len(score.pairs_list) >= MIN_CAL_PAIRS + 2:
            score.cover50, score.cover80 = cross_coverage(score.pairs_list)
        else:
            score.cover50, score.cover80 = in50 / m, in80 / m
    return score
