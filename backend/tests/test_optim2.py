"""Optimierungen Runde 2: gleiche Ausgaben bei weniger Rechenzeit."""

import datetime as dt

from fastapi.testclient import TestClient

from app.main import GZIP_LEVEL, create_app
from app.providers import demo
from app.providers.demo import DemoProvider

NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=dt.timezone.utc)


def test_gzip_level_keeps_content():
    """Niedrige Kompressionsstufe: große Antworten bleiben gzip-kodiert und inhaltlich gleich."""
    assert GZIP_LEVEL == 1
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        packed = c.get("/api/history/NWND.US", headers={"Accept-Encoding": "gzip"})
        plain = c.get("/api/history/NWND.US", headers={"Accept-Encoding": "identity"})
        assert packed.headers.get("content-encoding") == "gzip" and "content-encoding" not in plain.headers
        assert packed.content == plain.content and len(packed.json()["t"]) > 2000


def test_story_day_matches_direct_draw():
    """Der gemerkte Termin einer Meldung liefert dasselbe wie die direkte Ziehung – samt Zustand der Zufallsquelle."""
    hits = 0
    for kind, window in (("up", 21.0), ("order", 14 * 2.4), ("x", 1.0)):
        for k in range(200):
            day = dt.date(2026, 5, 1) + dt.timedelta(days=k)
            size = max(1, round(window))
            r, chosen = demo._story_draw("NWND.US", kind, size, day.toordinal() // size)
            want = (r.getstate(), r.randint(7 * 60, 21 * 60)) if chosen == day.toordinal() else None
            for _ in range(2):  # zweiter Aufruf kommt aus dem Speicher
                got = DemoProvider._story_day("NWND.US", kind, window, day)
                assert (got is None) == (want is None)
                if got is not None and want is not None:
                    hits += 1
                    assert got[1] == want[1]
                    fresh, _ = demo._story_draw("NWND.US", kind, size, day.toordinal() // size)
                    fresh.randint(7 * 60, 21 * 60)
                    assert got[0].getstate() == fresh.getstate()
            if chosen == day.toordinal():
                assert day.weekday() < 5
    assert hits > 10


def test_news_same_with_and_without_passed_reports():
    p = DemoProvider(now_fn=lambda: NOW)
    reports = p._report_index()
    for k in range(10):
        day = NOW.date() - dt.timedelta(days=k)
        assert [n.model_dump() for n in p._news_day(day)] == [n.model_dump() for n in p._news_day(day, reports)]
