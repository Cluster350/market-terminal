"""Rechenkern der Saisonalität (SAIS): Wochentage, Kalendermonate, Monatswechsel und Jahresverlauf –
jeweils ehrlich verglichen mit dem Zufall.

Vergleich zum Zufall (Permutationstest): Die Renditen bleiben, nur die Etiketten (Wochentag bzw. Monat) werden
zufällig neu verteilt – tausendfach. So entsteht, wie groß Unterschiede zwischen Gruppen schon rein zufällig
werden. Gemessen wird für das ganze Muster (die größte Abweichung einer Gruppe), denn bei 12 Monaten fällt fast
immer einer „auffällig“ aus. Dazu die Probe auf Beständigkeit: dieselbe Richtung in der ersten und zweiten
Hälfte der Jahre?
"""

from __future__ import annotations

import datetime as dt
import math
import random
from typing import Optional, Sequence

WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
PERMUTATIONS = 1000
SEED = 20261123  # gleiches Ergebnis bei jedem Aufruf


def daily_returns(dates: Sequence[str], closes: Sequence[Optional[float]]) -> list[tuple[dt.date, float]]:
    """Tagesrenditen in % (Schlusskurs gegen den vorigen Handelstag mit Kurs)."""
    out: list[tuple[dt.date, float]] = []
    prev: Optional[float] = None
    for d, c in zip(dates, closes):
        if c is None or c <= 0:
            continue
        if prev:
            out.append((dt.date.fromisoformat(d[:10]), (c / prev - 1) * 100))
        prev = c
    return out


def monthly_returns(dates: Sequence[str], closes: Sequence[Optional[float]]) -> list[tuple[int, int, float]]:
    """(Jahr, Monat, Rendite in %) aus den Monatsschlusskursen; nur vollständige Monate (Vormonat vorhanden,
    laufender Monat ausgelassen)."""
    last: dict[tuple[int, int], float] = {}
    order: list[tuple[int, int]] = []
    for d, c in zip(dates, closes):
        if c is None or c <= 0:
            continue
        key = (int(d[:4]), int(d[5:7]))
        if key not in last:
            order.append(key)
        last[key] = c
    out = []
    for prev, cur in zip(order, order[1:-1]):  # letzter Monat läuft noch
        expected = (prev[0] + (prev[1] == 12), prev[1] % 12 + 1)
        if cur == expected:
            out.append((cur[0], cur[1], (last[cur] / last[prev] - 1) * 100))
    return out


def _mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def group_stats(values: Sequence[float], labels: Sequence[int], groups: Sequence[int]) -> list[dict]:
    out = []
    for g in groups:
        xs = [v for v, lab in zip(values, labels) if lab == g]
        n = len(xs)
        sd = math.sqrt(sum((x - _mean(xs)) ** 2 for x in xs) / (n - 1)) if n > 1 else None
        out.append({"key": g, "n": n, "mean": _mean(xs) if n else None, "median": sorted(xs)[n // 2] if n else None,
                    "plus": sum(1 for x in xs if x > 0) / n * 100 if n else None, "sd": sd})
    return out


def _max_dev(values: Sequence[float], labels: Sequence[int], groups: Sequence[int], overall: float, sd: float) -> tuple[float, list[float]]:
    """Größte standardisierte Abweichung eines Gruppenmittels vom Gesamtmittel (und alle Abweichungen)."""
    sums = {g: 0.0 for g in groups}
    cnt = {g: 0 for g in groups}
    for v, lab in zip(values, labels):
        sums[lab] += v
        cnt[lab] += 1
    devs = []
    for g in groups:
        devs.append((sums[g] / cnt[g] - overall) / (sd / math.sqrt(cnt[g])) if cnt[g] and sd else 0.0)
    return max(abs(x) for x in devs) if devs else 0.0, devs


def permutation_test(values: Sequence[float], labels: Sequence[int], groups: Sequence[int], n_perm: int = PERMUTATIONS,
                     seed: int = SEED) -> dict:
    """Wie oft erzeugt bloßes Mischen der Etiketten eine so große Abweichung? p für das ganze Muster (größte
    Abweichung) und je Gruppe (zweiseitig)."""
    groups = [g for g in groups if any(lab == g for lab in labels)]
    if len(values) < 20 or len(groups) < 2:
        return {"pAll": None, "p": {}, "nPerm": 0}
    overall = _mean(values)
    sd = math.sqrt(sum((v - overall) ** 2 for v in values) / (len(values) - 1)) or 1e-12
    obs_max, obs = _max_dev(values, labels, groups, overall, sd)
    rng = random.Random(seed)
    shuffled = list(labels)
    hit_all = 0
    hit = [0] * len(groups)
    for _ in range(n_perm):
        rng.shuffle(shuffled)
        m, devs = _max_dev(values, shuffled, groups, overall, sd)
        if m >= obs_max - 1e-12:
            hit_all += 1
        for i, d in enumerate(devs):
            if abs(d) >= abs(obs[i]) - 1e-12:
                hit[i] += 1
    return {"pAll": (hit_all + 1) / (n_perm + 1), "p": {g: (hit[i] + 1) / (n_perm + 1) for i, g in enumerate(groups)},
            "z": dict(zip(groups, obs)), "nPerm": n_perm}


def stability(values: Sequence[float], labels: Sequence[int], years: Sequence[int], groups: Sequence[int]) -> dict:
    """Richtung je Gruppe in der ersten und zweiten Hälfte der Jahre (gleich = beständig)."""
    ys = sorted(set(years))
    if len(ys) < 4:
        return {}
    cut = ys[len(ys) // 2]
    out = {}
    for g in groups:
        a = [v for v, lab, y in zip(values, labels, years) if lab == g and y < cut]
        b = [v for v, lab, y in zip(values, labels, years) if lab == g and y >= cut]
        if a and b:
            out[g] = {"first": _mean(a), "second": _mean(b), "same": (_mean(a) > 0) == (_mean(b) > 0)}
    return {"cut": cut, "groups": out}


def verdict(p_all: Optional[float]) -> tuple[str, str]:
    """Urteil für das ganze Muster, in Worten."""
    if p_all is None:
        return "wenig", "Zu wenig Daten für einen Vergleich mit dem Zufall."
    if p_all < 0.01:
        share = f"{p_all * 100:.1f}".replace(".", ",")
        return "deutlich", f"Deutlicher als Zufall: Nur in {share} % der Zufallsmischungen war das Muster so ausgeprägt."
    if p_all < 0.05:
        return "schwach", f"Schwach: In {p_all * 100:.0f} % der Zufallsmischungen war das Muster ebenso ausgeprägt – auffällig, aber nicht sicher."
    return "zufall", f"Nicht vom Zufall zu unterscheiden: In {p_all * 100:.0f} % der Zufallsmischungen war das Muster ebenso ausgeprägt."


def turn_of_month(daily: Sequence[tuple[dt.date, float]], before: int = 1, after: int = 3) -> tuple[list[float], list[int], list[int]]:
    """Monatswechsel: letzter Handelstag und die ersten drei des neuen Monats (Etikett 1) gegen alle übrigen Tage (0)."""
    labels = [0] * len(daily)
    idx_by_month: dict[tuple[int, int], list[int]] = {}
    for i, (d, _) in enumerate(daily):
        idx_by_month.setdefault((d.year, d.month), []).append(i)
    months = sorted(idx_by_month)
    for k, m in enumerate(months):
        days = idx_by_month[m]
        for i in days[:after]:
            if k > 0:  # erster Monat: Monatsende davor fehlt
                labels[i] = 1
        if k + 1 < len(months):
            for i in days[-before:]:
                labels[i] = 1
    return [r for _, r in daily], labels, [d.year for d, _ in daily]


def year_path(dates: Sequence[str], closes: Sequence[Optional[float]], current_year: int) -> dict:
    """Durchschnittlicher Jahresverlauf: Kurs je Kalendertag als % gegenüber dem Jahresschluss des Vorjahres,
    gemittelt über alle vollständigen Jahre (fehlende Tage mit dem letzten Wert); dazu das laufende Jahr."""
    by_year: dict[int, list[tuple[int, float]]] = {}
    prev_close: dict[int, float] = {}
    last: Optional[float] = None
    last_year: Optional[int] = None
    for d, c in zip(dates, closes):
        if c is None or c <= 0:
            continue
        day = dt.date.fromisoformat(d[:10])
        if last_year is not None and day.year != last_year and last is not None:
            prev_close[day.year] = last
        if day.year in prev_close:
            by_year.setdefault(day.year, []).append((day.timetuple().tm_yday, (c / prev_close[day.year] - 1) * 100))
        last, last_year = c, day.year
    full = [y for y in by_year if y != current_year and by_year[y][-1][0] >= 350 and by_year[y][0][0] <= 10]
    grid = list(range(1, 366))

    def on_grid(points: list[tuple[int, float]], upto: int = 365) -> list[Optional[float]]:
        out: list[Optional[float]] = []
        j, cur = 0, None
        for g in grid:
            while j < len(points) and points[j][0] <= g:
                cur = points[j][1]
                j += 1
            out.append(cur if g <= upto else None)
        return out

    lines = [on_grid(by_year[y]) for y in full]
    avg = [(_mean([ln[i] for ln in lines if ln[i] is not None]) if any(ln[i] is not None for ln in lines) else None) for i in range(len(grid))]
    cur = by_year.get(current_year)
    current = on_grid(cur, cur[-1][0]) if cur else []
    # Anteil der Jahre mit Plus bis zu jedem Tag (wie verlässlich der Verlauf ist)
    plus = [(sum(1 for ln in lines if ln[i] is not None and ln[i] > 0) / len(lines) * 100 if lines else None) for i in range(len(grid))]
    return {"days": grid, "average": [None if v is None else round(v, 3) for v in avg],
            "current": [None if v is None else round(v, 3) for v in current], "plusShare": [None if v is None else round(v, 1) for v in plus],
            "years": sorted(full)}
