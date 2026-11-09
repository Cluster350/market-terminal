"""Regressionstests der sechsten Fehlersuche (nach Ehlers-Indikatoren und Trend-Scanning im Kurschart)."""

import asyncio
import datetime as dt
from types import SimpleNamespace

from app.cache import TTLCache
from app.providers.demo import DemoProvider
from app.rotation.service import RotationService
from app.services.terminal import Terminal

UTC = dt.timezone.utc


def test_rotation_weekly_last_point_is_not_dated_in_the_future():
    # Montag: der Wochenschlüssel der laufenden Woche ist der kommende Freitag (13.11.). Vorher zeigte RRG
    # „bis 13.11.2026“ und das CSV eine Zeile vom 13.11. – Kurse gibt es aber nur bis heute.
    monday = dt.datetime(2026, 11, 9, 15, 0, tzinfo=UTC)
    t = Terminal(DemoProvider(now_fn=lambda: monday), TTLCache())
    svc = RotationService(t, SimpleNamespace(result=None))
    res = asyncio.run(svc.rotation("currencies", bench="basket", freq="w"))
    assert res.state == "ready" and res.weeks
    assert res.weeks[-1] == "2026-11-09"
    assert res.weeks[-2] == "2026-11-06"  # frühere Wochen behalten ihren Freitag
    assert all(a < b for a, b in zip(res.weeks, res.weeks[1:]))
    # Tageswerte sind ohnehin echte Handelstage
    daily = asyncio.run(svc.rotation("currencies", bench="basket", freq="d"))
    assert daily.weeks[-1] <= "2026-11-09"
