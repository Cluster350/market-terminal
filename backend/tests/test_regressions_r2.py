"""Regressionstests zur zweiten Review-Runde (Feiertage, Earnings-Zeitpunkte, Peers, Ticker-Prüfung)."""

import asyncio
import datetime as dt
import statistics

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW))) as c:
        yield c


@pytest.mark.parametrize("url", ["/api/calendar/earnings?from=9999-12-30", "/api/calendar/earnings?from=1800-01-01&to=1800-01-02"])
def test_earnings_calendar_extreme_dates_are_400(client, url):
    # Vorher: Standard-Ende "from + 6 Tage" lief bei 9999-12-30 über -> 500
    r = client.get(url)
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("hour,visible", [(12, False), (21, True)])
def test_demo_earnings_appear_at_release_time_not_at_midnight(hour, visible):
    # NWND.US berichtet Q3/2026 am 27.10.2026 nach Börsenschluss (≈ 20:10 UTC)
    assert DemoProvider._report_date("NWND.US", dt.date(2026, 9, 30)) == (dt.date(2026, 10, 27), "AfterMarket")
    now = dt.datetime(2026, 10, 27, hour, 0, tzinfo=UTC)
    p = DemoProvider(now_fn=lambda: now)
    e = asyncio.run(p.earnings("NWND.US"))
    in_history = any(h.date == "2026-09-30" and h.eps_actual is not None for h in e.history)
    news = [n for n in asyncio.run(p.news(["NWND.US"], 100)) if "Quartal" in n.title and n.date.startswith("2026-10-27")]
    assert in_history is visible
    assert bool(news) is visible  # ERN und Nachrichten erscheinen gleichzeitig
    if not visible:
        assert e.next is not None and e.next.date == "2026-09-30" and e.next.report_date == "2026-10-27"


def test_demo_fundamentals_cache_follows_release():
    # Gleicher Provider, Uhr springt über die Veröffentlichung: der Tages-Cache darf nicht veralten
    clock = {"now": dt.datetime(2026, 10, 27, 12, 0, tzinfo=UTC)}
    p = DemoProvider(now_fn=lambda: clock["now"])
    before = asyncio.run(p.earnings("NWND.US"))
    clock["now"] = dt.datetime(2026, 10, 27, 21, 0, tzinfo=UTC)
    after = asyncio.run(p.earnings("NWND.US"))
    assert before.history[0].date == "2026-06-30" and after.history[0].date == "2026-09-30"


def test_peer_median_excludes_the_security_itself(client):
    p = client.get("/api/peers/ELBT.XETRA").json()
    own, others = p["rows"][0], p["rows"][1:]
    assert own["ticker"] == "ELBT.XETRA" and others
    for key in ("pe", "perf12m", "marketCap"):
        vals = [r[key] for r in others if r[key] is not None]
        assert p["median"][key] == pytest.approx(statistics.median(vals))


def test_resolve_does_not_cache_unknown_result():
    p = DemoProvider(now_fn=lambda: NOW)
    calls = {"n": 0}
    original = p.resolve

    async def flaky(ticker):
        calls["n"] += 1
        return None if calls["n"] == 1 else await original(ticker)  # erst "NA", dann bekannt

    p.resolve = flaky
    with TestClient(create_app(p)) as c:
        assert c.get("/api/resolve?q=NWND US").status_code == 404
        r = c.get("/api/resolve?q=NWND US")
        assert r.status_code == 200 and r.json()["ticker"] == "NWND.US"


def test_demo_business_days_computed_once_per_day():
    clock = {"now": NOW}
    p = DemoProvider(now_fn=lambda: clock["now"])
    first = p.days()
    assert p.days() is first and first[-1] == dt.date(2026, 10, 28)
    clock["now"] = NOW + dt.timedelta(days=1)
    assert p.days()[-1] == dt.date(2026, 10, 29)


def test_michigan_sentiment_refers_to_current_month(client):
    cal = client.get("/api/macro/calendar?from=2026-10-05&to=2026-10-11&country=US").json()
    mich = next(e for e in cal if "Michigan" in e["event"])
    assert mich["date"].startswith("2026-10-09") and mich["period"] == "Okt 2026"
    eu = client.get("/api/macro/calendar?from=2026-10-01&to=2026-10-02&country=EU").json()
    flash = next(e for e in eu if e["event"] == "Inflation Rate YoY Flash")
    assert flash["period"] == "Sep 2026"  # Schnellschätzung am 1. Werktag gilt dem Vormonat


def test_curve_comparison_values_are_calendar_based(client):
    from app.services import metrics

    h = client.get("/api/history/JP10Y.GBOND").json()
    pt = next(p for c in client.get("/api/macro/curves?countries=JP").json() for p in c["points"] if p["tenor"] == "10Y")
    last = dt.date.fromisoformat(h["t"][-1])
    for months, key in ((1, "y1m"), (12, "y1y")):
        cutoff = metrics.shift_date(last, months).isoformat()
        expected = [v for d, v in zip(h["t"], h["c"]) if d <= cutoff][-1]
        assert pt[key] == pytest.approx(expected)
