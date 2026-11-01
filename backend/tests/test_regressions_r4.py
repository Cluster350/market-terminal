"""Regressionstests zur vierten Review-Runde (Trader-Feedback: OHLV, Earnings, EODHD-Kosten)."""

import asyncio
import datetime as dt

import httpx
import pytest

from app.config import Settings
from app.eodhd.client import EODHDClient
from app.providers.demo import COMPANY_TICKERS, DemoProvider, holidays
from app.providers.eodhd import EODHDProvider

UTC = dt.timezone.utc


def at(y, m, d, hh=12):
    return DemoProvider(now_fn=lambda: dt.datetime(y, m, d, hh, tzinfo=UTC))


@pytest.mark.parametrize("ticker", ["NWND.US", "ELBT.XETRA", "GDAXI.INDX", "US10Y.GBOND", "EURGBP.FOREX", "GOLD.COMM"])
def test_ohlv_of_all_past_days_stable_over_a_month(ticker):
    # Eine Zufallsquelle je Instrument (statt je Tag, die ~9 µs je Tag kostete): stabil bleibt es,
    # solange jeder Tag gleich viele Zahlen zieht – über Monats- und Feiertagsgrenzen hinweg prüfen
    a, b = at(2026, 11, 20)._daily(ticker), at(2026, 12, 29)._daily(ticker)
    n = len(a["days"])
    assert b["days"][:n] == a["days"]
    for k in "ohlcv":
        assert b[k][:n] == a[k], k


def test_earnings_reaction_never_on_exchange_holiday():
    # Vorher fiel z. B. die Reaktion von ALPV.XETRA auf den 1. Mai 2018: Der Feiertag wird später
    # entfernt, Eröffnungslücke und Volumenspitze gingen verloren
    p = at(2026, 10, 29)
    for t in COMPANY_TICKERS:
        group = p.session_group(t)
        for day in p._earnings_shocks(t, dt.date(2016, 1, 4), dt.date(2026, 10, 29)):
            assert day.weekday() < 5 and day not in holidays(group, day.year), (t, day)


def test_earnings_news_beat_matches_price_reaction_sign():
    # FRTL.US Q2/2026: Überraschung −0,002 % – gerundet −0,0; die News meldete "übertrifft",
    # die Kursreaktion rechnete mit "verfehlt"
    q = dt.date(2026, 6, 30)
    assert -0.005 < DemoProvider._eps_surprise("FRTL.US", q) < 0
    p = at(2026, 10, 29)
    rec = p._fundamentals_raw("FRTL.US")["Earnings"]["History"][q.isoformat()]
    day = dt.date.fromisoformat(rec["reportDate"])
    from app.providers import demo_data as D

    company = next(c for c in D.COMPANIES if f"{c[0]}.{c[2]}" == "FRTL.US")
    items = p._earnings_story(company, rec, day, 0)
    assert "verfehlt" in items[0].title
    guide = DemoProvider._guidance("FRTL.US", day, False)
    if guide is not None:  # Prognose in der News wie in der Kursreaktion
        assert len(items) == 2 and ("senkt" in items[1].title) == (guide == "down")


def _eodhd(handler) -> EODHDProvider:
    client = EODHDClient("KEY", "https://example.test/api", transport=httpx.MockTransport(handler), backoff_base=0.0)
    return EODHDProvider(Settings(eodhd_api_key="KEY"), client=client)


def test_eodhd_fundamentals_fetched_once_for_company_financials_earnings():
    calls = {"n": 0}

    def handler(request: httpx.Request):
        if "fundamentals" in request.url.path:
            calls["n"] += 1
            return httpx.Response(200, json={"General": {"Name": "X", "CurrencyCode": "USD"}, "Earnings": {"History": {}}})
        return httpx.Response(404)

    async def run():
        prov = _eodhd(handler)
        # GP (Earnings-Marker), DES und FA fragen beim Tickerwechsel gleichzeitig an
        await asyncio.gather(prov.company("X.US"), prov.financials("X.US", "annual"), prov.earnings("X.US"), prov.financials("X.US", "quarterly"))
        await prov.close()

    asyncio.run(run())
    assert calls["n"] == 1


def test_eodhd_news_uses_all_requested_watchlist_tickers():
    seen: set[str] = set()

    def handler(request: httpx.Request):
        seen.add(request.url.params.get("s", ""))
        return httpx.Response(200, json=[])

    async def run():
        prov = _eodhd(handler)
        await prov.news([f"T{i}.US" for i in range(30)], 50)
        await prov.close()

    asyncio.run(run())
    assert len(seen) == 30  # vorher nur die ersten 10


def test_daily_series_does_not_seed_a_generator_per_day(monkeypatch):
    # Laufzeit-Regression: je Tag ein random.Random zu seeden kostete ~9 µs × 2 800 Tage je
    # Instrument (/macro/curves kalt 1,2 -> 3,1 s, Heatmap 0,6 -> 2,4 s)
    import app.providers.demo as demo

    calls = {"n": 0}
    original = demo._rng

    def counting(*parts):
        calls["n"] += 1
        return original(*parts)

    monkeypatch.setattr(demo, "_rng", counting)
    p = at(2026, 10, 29)
    p._daily("US10Y.GBOND")
    p._daily("NWND.US")
    assert calls["n"] < 1000  # je Quartal einige (Earnings), nicht je Tag (vorher > 5 000)
