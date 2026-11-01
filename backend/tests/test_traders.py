"""Regressionstests zum Feedback der zehn Trader-Agenten (Demo-Datenqualität und API)."""

import asyncio
import datetime as dt
import math
import statistics

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers import demo_data as D
from app.providers.demo import DemoProvider
from app.services.tickers import normalize

UTC = dt.timezone.utc


def at(y, m, d, hh=12, mm=0):
    return DemoProvider(now_fn=lambda: dt.datetime(y, m, d, hh, mm, tzinfo=UTC))


def test_history_ohlv_stable_when_days_are_added():
    """Day/Quant: Eröffnung, Hoch, Tief und Volumen vergangener Tage ändern sich nicht."""
    a, b = at(2026, 10, 29, 21)._daily("NWND.US"), at(2026, 11, 3, 21)._daily("NWND.US")
    for day in (dt.date(2026, 3, 2), dt.date(2026, 10, 29)):
        i, j = a["days"].index(day), b["days"].index(day)
        assert [a[k][i] for k in "ohlcv"] == [b[k][j] for k in "ohlcv"]


def test_consensus_is_not_rewritten_by_the_report():
    """Earnings/Value: Die Schätzung vor dem Bericht bleibt nach dem Bericht dieselbe."""
    before = at(2026, 10, 29, 12)._fundamentals_raw("RHNC.XETRA")["Earnings"]["History"]
    after = at(2026, 10, 30, 12)._fundamentals_raw("RHNC.XETRA")["Earnings"]["History"]
    q = "2026-09-30"
    assert before[q]["epsActual"] is None and after[q]["epsActual"] is not None
    assert before[q]["epsEstimate"] == after[q]["epsEstimate"]


def test_price_reacts_to_earnings_surprise():
    """Day/Earnings/Quant: Überraschung und Kursreaktion hängen zusammen, Volumen steigt."""
    p = at(2026, 10, 29, 12)
    xs, ys, vr = [], [], []
    for c in D.COMPANIES[:20]:
        t = f"{c[0]}.{c[2]}"
        s = p._daily(t)
        idx = {d: i for i, d in enumerate(s["days"])}
        for rec in p._fundamentals_raw(t)["Earnings"]["History"].values():
            if rec["epsActual"] is None:
                continue
            day = dt.date.fromisoformat(rec["reportDate"])
            if rec["beforeAfterMarket"] == "AfterMarket":
                day += dt.timedelta(days=1)
            while day not in idx:
                day += dt.timedelta(days=1)
            i = idx[day]
            xs.append(rec["surprisePercent"])
            ys.append(math.log(s["c"][i] / s["c"][i - 1]))
            vr.append(s["v"][i] / statistics.mean(s["v"][i - 20 : i]))
    assert statistics.correlation(xs, ys) > 0.5
    assert statistics.median(vr) > 2


def test_dividend_history_is_stable_across_reports():
    """Value: Dividenden vergangener Jahre ändern sich nicht mit einem neuen Quartalsbericht."""
    d1 = asyncio.run(at(2026, 10, 29).dividends("RHNC.XETRA"))
    d2 = asyncio.run(at(2026, 11, 2).dividends("RHNC.XETRA"))
    assert [(x.ex_date, x.value) for x in d1.dividends] == [(x.ex_date, x.value) for x in d2.dividends]


def test_economic_calendar_follows_local_time():
    """FX/Macro: NFP erscheint um 08:30 New York, nach der Zeitumstellung also 13:30 UTC."""
    assert DemoProvider._event_time("US", dt.date(2026, 10, 2), 12, 30).hour == 12
    assert DemoProvider._event_time("US", dt.date(2026, 11, 6), 12, 30).hour == 13
    assert DemoProvider._event_time("DE", dt.date(2026, 10, 26), 8, 0).hour == 9
    assert DemoProvider._event_time("JP", dt.date(2026, 11, 19), 23, 30).hour == 23


def test_fx_week_closes_friday_new_york():
    p = at(2026, 11, 1, 11)
    q = asyncio.run(p.quotes(["EURUSD.FOREX"]))[0]
    assert q.timestamp == "2026-10-30T21:00:00Z"


def test_cross_rates_have_valid_and_arbitrage_free_ohlc():
    p = at(2026, 11, 1, 11)
    s, a, b = p._effective("EURGBP.FOREX"), p._effective("EURUSD.FOREX"), p._effective("GBPUSD.FOREX")
    ia = {d: i for i, d in enumerate(a["days"])}
    ib = {d: i for i, d in enumerate(b["days"])}
    for i, d in enumerate(s["days"]):
        assert s["l"][i] <= min(s["o"][i], s["c"][i]) + 1e-12
        assert s["h"][i] >= max(s["o"][i], s["c"][i]) - 1e-12
        if i < len(s["days"]) - 6:  # Intraday-Tage: Hoch/Tief aus dem Pfad
            assert s["l"][i] >= a["l"][ia[d]] / b["h"][ib[d]] - 1e-9
            assert s["h"][i] <= a["h"][ia[d]] / b["l"][ib[d]] + 1e-9


def test_beta_matches_price_history():
    """Quant: Beta in DES wird aus denselben Kursen berechnet, die der Chart zeigt."""
    p = at(2026, 10, 29)
    beta = p._fundamentals_raw("NWND.US")["Technicals"]["Beta"]
    s, b = p._daily("NWND.US"), p._daily("GSPC.INDX")
    cutoff = s["days"][-1] - dt.timedelta(days=365)
    mb = dict(zip(b["days"], b["c"]))
    pairs = [(c, mb[d]) for d, c in zip(s["days"], s["c"]) if d >= cutoff and d in mb]
    rs = [math.log(pairs[k][0] / pairs[k - 1][0]) for k in range(1, len(pairs))]
    rb = [math.log(pairs[k][1] / pairs[k - 1][1]) for k in range(1, len(pairs))]
    assert beta == pytest.approx(statistics.covariance(rs, rb) / statistics.variance(rb), abs=0.01)


def test_target_price_does_not_track_daily_price():
    """Value: Das Kursziel bleibt zwischen zwei Berichten fest."""
    t1 = at(2026, 9, 1)._fundamentals_raw("MTHR.SW")["AnalystRatings"]["TargetPrice"]
    t2 = at(2026, 9, 15)._fundamentals_raw("MTHR.SW")["AnalystRatings"]["TargetPrice"]
    assert t1 == t2


def test_history_api_from_to_and_gb_alias():
    with TestClient(create_app(at(2026, 10, 29))) as c:
        h = c.get("/api/history/NWND.US", params={"from": "2020-01-01", "to": "2020-12-31"}).json()
        assert h["t"][0] >= "2020-01-01" and h["t"][-1] <= "2020-12-31" and len(h["t"]) > 200
        assert len(h["c"]) == len(h["t"])
        assert c.get("/api/history/NWND.US", params={"from": "2021-01-01", "to": "2020-01-01"}).status_code == 400
    assert normalize("GB10Y Govt") == "UK10Y.GBOND"
