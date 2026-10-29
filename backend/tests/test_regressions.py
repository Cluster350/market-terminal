"""Regressionstests für gefundene Fehler (Randfälle, ungültige Eingaben, EODHD-Datenfehler)."""

import asyncio
import datetime as dt
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.cache import TTLCache
from app.config import Settings
from app.eodhd import mapping
from app.eodhd.client import EODHDClient
from app.errors import NotFound, UpstreamError
from app.main import create_app
from app.models import Intraday, Quote
from app.providers.demo import DemoProvider
from app.providers.eodhd import EODHDProvider
from app.services import metrics
from app.services.terminal import Terminal
from app.services.util import num

UTC = dt.timezone.utc


def make_client(now: dt.datetime, provider: DemoProvider | None = None) -> TestClient:
    return TestClient(create_app(provider or DemoProvider(now_fn=lambda: now)))


@pytest.fixture(scope="module")
def client():
    with make_client(dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)) as c:
        yield c


def _eodhd(handler) -> EODHDProvider:
    client = EODHDClient("KEY", "https://example.test/api", transport=httpx.MockTransport(handler), backoff_base=0.0)
    return EODHDProvider(Settings(eodhd_api_key="KEY"), client=client)


# --- Hilfsfunktionen und Mapping ------------------------------------------------------


def test_num_huge_int_is_none_not_overflow():
    assert num(10**400) is None


def test_quote_previous_close_zero_gives_no_change():
    q = mapping.quote({"close": 10.0, "previousClose": 0, "change": 10.0, "change_p": "NA"}, "NEW.US")
    assert q.last == 10.0
    assert q.prev_close is None and q.change is None and q.change_pct is None


def test_history_adjusted_close_zero_falls_back_to_close():
    h = mapping.history(
        [
            {"date": "2026-10-26", "open": 10, "high": 11, "low": 9, "close": 10, "adjusted_close": 0, "volume": 1},
            {"date": "2026-10-27", "open": 10, "high": 11, "low": 9, "close": 10.5, "adjusted_close": 10.5, "volume": 1},
        ],
        "X.US",
    )
    assert h.c == [10.0, 10.5]
    assert h.o[0] == 10.0 and h.h[0] == 11.0 and h.l[0] == 9.0


@pytest.mark.parametrize(
    "title,topic",
    [
        ("Company steps up production at its new headquarters", "company"),
        ("Tesla begins operating robotaxi service", "company"),
        ("Confusion as startup generates buzz", "company"),
        ("Apple beats EPS estimates", "earnings"),
        ("Quarterly results top forecasts", "earnings"),
        ("Analyst upgrades Nvidia, lifts price target", "analyst"),
        ("Bank downgrades rating on Ford", "analyst"),
        ("Fed holds rates steady", "macro"),
        ("EZB: Leitzins bleibt unverändert", "macro"),
        ("Microsoft to acquire gaming studio", "mna"),
        ("Firmenübernahme im Chemiesektor", "mna"),
    ],
)
def test_classify_topic_uses_word_starts(title, topic):
    assert mapping.classify_topic(title, []) == topic


def test_dividends_ttm_ignores_announced_future_dividend():
    d = mapping.dividends(
        [{"date": "2027-02-10", "value": 0.5}, {"date": "2026-08-10", "value": 0.25}, {"date": "2025-08-10", "value": 0.2}],
        [],
        "X.US",
        today=dt.date(2026, 10, 29),
    )
    assert d.ttm == pytest.approx(0.25)
    assert d.dividends[0].ex_date == "2027-02-10"  # bleibt in der Liste sichtbar


def test_econ_events_deduplicated():
    raw = {"type": "CPI", "comparison": "yoy", "country": "US", "date": "2026-10-15 12:30:00", "actual": 3.1, "estimate": 3.0}
    ev = mapping.econ_events([raw, dict(raw)])
    assert len(ev) == 1


def test_last_sessions_keeps_only_requested_days():
    def ts(day: int, hour: int) -> int:
        return int(dt.datetime(2026, 10, day, hour, tzinfo=UTC).timestamp())

    t = [ts(22, 15), ts(23, 15), ts(26, 15), ts(26, 16)]
    i = Intraday(ticker="X.US", interval="5m", t=t, o=[1, 2, 3, 4], h=[1, 2, 3, 4], l=[1, 2, 3, 4], c=[1, 2, 3, 4], v=[1, 2, 3, 4])
    one = mapping.last_sessions(i, 1)
    assert one.t == t[2:] and one.c == [3, 4]
    assert mapping.last_sessions(i, 2).c == [2, 3, 4]
    assert mapping.last_sessions(i, 10).c == [1, 2, 3, 4]


# --- EODHD-Client und -Provider ---------------------------------------------------------


def test_client_broken_compression_is_upstream_error():
    async def run():
        c = EODHDClient(
            "KEY", "https://example.test/api", backoff_base=0.0, max_retries=0,
            transport=httpx.MockTransport(lambda r: httpx.Response(200, headers={"Content-Encoding": "gzip"}, content=b"kaputt")),
        )
        with pytest.raises(UpstreamError):
            await c.get("eod/X.US")
        await c.close()

    asyncio.run(run())


def test_eodhd_intraday_one_day_returns_one_session():
    def handler(request: httpx.Request):
        days = [(2026, 10, 22), (2026, 10, 23), (2026, 10, 26)]
        rows = [
            {"timestamp": int(dt.datetime(*d, h, tzinfo=UTC).timestamp()), "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}
            for d in days for h in (14, 15)
        ]
        return httpx.Response(200, json=rows)

    async def run():
        prov = _eodhd(handler)
        out = await prov.intraday("X.US", 1)
        assert {dt.datetime.fromtimestamp(t, UTC).date() for t in out.t} == {dt.date(2026, 10, 26)}
        await prov.close()

    asyncio.run(run())


def _paged_screener(seen: list):
    def handler(request: httpx.Request):
        seen.append(request)
        if "screener" not in request.url.path:
            return httpx.Response(404)
        off = int(request.url.params["offset"])
        # Seiten überlappen (Reihenfolge ändert sich zwischen zwei Abrufen)
        data = [{"code": f"T{(off + i) % 150}", "exchange": "US", "adjusted_close": 1, "market_capitalization": 1e9} for i in range(100)]
        return httpx.Response(200, json={"data": data})

    return handler


def test_eodhd_screener_local_sort_loads_largest_and_dedups():
    seen: list = []

    async def run():
        prov = _eodhd(_paged_screener(seen))
        rows, _, _ = await prov.screener([], "pe", False, 300)
        assert seen[0].url.params["sort"] == "market_capitalization.desc"
        assert len(rows) == len({r.ticker for r in rows}) == 150
        await prov.close()

    asyncio.run(run())


def test_terminal_enriched_sort_ascending_still_loads_largest():
    seen: list = []

    async def run():
        prov = _eodhd(_paged_screener(seen))
        await Terminal(prov).screen([], "rsi14", False, 10)
        sorts = {r.url.params["sort"] for r in seen if "screener" in r.url.path}
        assert sorts == {"market_capitalization.desc"}
        await prov.close()

    asyncio.run(run())


# --- API-Validierung --------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"filters": "abc"},
        {"filters": [1]},
        {"filters": {"a": 1}},
        {"filters": [{"field": ["x"], "op": "gt", "value": 1}]},
        {"filters": [{"field": "pe", "op": ["gt"], "value": 1}]},
        {"filters": [{"field": "sector", "op": "eq", "value": {"a": 1}}]},
        {"filters": [{"field": "sector", "op": "in", "value": [{"x": 1}]}]},
    ],
)
def test_screener_malformed_filters_are_400(client, body):
    r = client.post("/api/screener", json=body)
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "bad_request"


@pytest.mark.parametrize(
    "raw",
    [
        '{"limit": Infinity}',
        '{"filters": [{"field": "pe", "op": "gt", "value": NaN}]}',
        '{"filters": [{"field": "pe", "op": "gt", "value": 1e400}]}',
    ],
)
def test_screener_non_finite_numbers_are_400(client, raw):
    r = client.post("/api/screener", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 400, r.text


@pytest.mark.parametrize("frm,to", [("9999-12-30", "9999-12-31"), ("0001-01-01", "0001-01-05")])
def test_calendar_extreme_dates_are_400(client, frm, to):
    r = client.get(f"/api/macro/calendar?from={frm}&to={to}")
    assert r.status_code == 400, r.text


def test_news_since_respects_offsets_and_rejects_garbage(client):
    utc = client.get("/api/news", params={"since": "2026-10-28T10:00:00Z", "limit": 300}).json()["items"]
    plus2 = client.get("/api/news", params={"since": "2026-10-28T12:00:00+02:00", "limit": 300}).json()["items"]
    space = client.get("/api/news", params={"since": "2026-10-28 10:00:00", "limit": 300}).json()["items"]
    assert [n["id"] for n in plus2] == [n["id"] for n in utc] == [n["id"] for n in space]
    assert all(n["date"] > "2026-10-28T10:00:00Z" for n in utc)
    assert client.get("/api/news?since=garbage").status_code == 400


def test_non_finite_values_become_null_instead_of_500():
    now = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)
    prov = DemoProvider(now_fn=lambda: now)

    async def quotes(tickers):
        return [Quote(ticker=t, last=float("nan"), change=float("inf")) for t in tickers]

    prov.quotes = quotes
    with make_client(now, prov) as c:
        r = c.get("/api/quotes?tickers=NWND.US")
        assert r.status_code == 200
        assert r.json()[0]["last"] is None and r.json()[0]["change"] is None


# --- Datumslogik ------------------------------------------------------------------------


def test_perf_ytd_uses_current_year():
    dates = ["2026-12-30", "2026-12-31"]
    assert metrics.perf_ytd(dates, [100.0, 110.0], today=dt.date(2027, 1, 1)) == pytest.approx(0.0)
    assert metrics.perf_ytd(["2025-12-31", "2026-12-31"], [100.0, 110.0], today=dt.date(2026, 12, 31)) == pytest.approx(10.0)


def test_ytd_consistent_on_new_years_day():
    # 1. Januar, 10:00 UTC: Europa handelt schon, die USA noch nicht – YTD muss überall ≈ 0 sein
    with make_client(dt.datetime(2027, 1, 1, 10, 0, tzinfo=UTC)) as c:
        rows = c.get("/api/macro/indices").json()
        spx = next(r for r in rows if r["ticker"] == "GSPC.INDX")
        assert spx["chgYtd"] == pytest.approx(0.0)
        assert all(abs(r["chgYtd"]) < 5 for r in rows if r["chgYtd"] is not None)


@pytest.mark.parametrize(
    "now",
    [
        dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC),
        dt.datetime(2026, 8, 20, 12, 0, tzinfo=UTC),
        dt.datetime(2027, 1, 1, 10, 0, tzinfo=UTC),
        dt.datetime(2026, 5, 15, 12, 0, tzinfo=UTC),
    ],
)
def test_demo_next_earnings_period_is_quarter_end(now):
    e = asyncio.run(DemoProvider(now_fn=lambda: now).earnings("NWND.US"))
    d = dt.date.fromisoformat(e.next.date)
    assert d.month in (3, 6, 9, 12) and (d + dt.timedelta(days=1)).day == 1
    assert e.next.date > e.history[0].date


def test_demo_before_first_session_has_no_500():
    with make_client(dt.datetime(2016, 1, 4, 7, 0, tzinfo=UTC)) as c:
        for url in (
            "/api/company/NWND.US", "/api/financials/NWND.US?period=quarterly", "/api/earnings/NWND.US",
            "/api/dividends/MTHR.SW", "/api/macro/curves", "/api/market/movers", "/api/market/heatmap",
            "/api/history/NWND.US", "/api/quotes?tickers=NWND.US",
        ):
            assert c.get(url).status_code == 200, url
        assert c.post("/api/screener", json={"enrich": True}).status_code == 200


# --- Cache --------------------------------------------------------------------------------


def test_cache_locks_of_failing_keys_do_not_grow_unbounded():
    async def run():
        cache = TTLCache(max_entries=50)

        async def fail():
            raise NotFound("x")

        for i in range(1000):
            with pytest.raises(NotFound):
                await cache.get_or_load(f"hist:BAD{i}.US", 60, fail)
        assert len(cache._locks) <= 2 * 50 + 1

    asyncio.run(run())


def test_cache_evicts_by_data_volume():
    async def run():
        cache = TTLCache(max_entries=1000, max_weight=10_000)

        def history(n: int):
            async def load():
                return Intraday(ticker="X", interval="5m", t=list(range(n)), o=[], h=[], l=[], c=[], v=[])

            return load

        for i in range(10):
            await cache.get_or_load(f"h{i}", 60, history(3000))
        assert cache.stats()["entries"] <= 3
        value, stale = await cache.get_or_load("h9", 60, history(1))  # neuester Eintrag bleibt erhalten
        assert len(value.t) == 3000 and stale is False

    asyncio.run(run())


def test_cache_screener_tuple_weight():
    from app.cache import _weight

    assert _weight(([1, 2, 3], [], ["note"])) == 4 + 1 + 2
    assert _weight({"x": 1}) == 1


def test_screen_request_body_roundtrip_unchanged(client):
    # Gültige Filter funktionieren weiterhin, inkl. "in"-Listen und Textsuche
    body = {
        "filters": [
            {"field": "sector", "op": "in", "value": ["Technology"]},
            {"field": "name", "op": "contains", "value": "inc"},
            {"field": "pe", "op": "gt", "value": 0},
        ],
        "sort": "pe",
        "desc": False,
    }
    r = client.post("/api/screener", json=body)
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert rows and all(x["sector"] == "Technology" and "inc" in x["name"].lower() for x in rows)
    pes = [x["pe"] for x in rows]
    assert pes == sorted(pes)
    json.dumps(r.json(), allow_nan=False)
