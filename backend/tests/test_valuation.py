"""Tests des Bewertungstrends: Kalenderjahre, Bereinigungen, Gruppen-KGV, Revisionen und Endpunkte."""

import datetime as dt
import json
import math

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.demo import DemoProvider
from app.valuation.calc import (
    aggregate, calendarize, company_val, fy_from_quarters, months_in_year, split_fix, split_ratio,
    undo_dividend_adjustment, unit_factor,
)
from app.valuation.inputs import Estimate, ValInputs, from_fundamentals

TODAY = dt.date(2026, 11, 6)
NOW = dt.datetime(2026, 11, 6, 15, 0, tzinfo=dt.timezone.utc)


def mi(y, m):
    return y * 12 + m - 1


def test_calendar_years_from_fiscal_years():
    assert months_in_year(dt.date(2026, 12, 31), 2026) == 12
    assert months_in_year(dt.date(2027, 1, 31), 2026) == 11  # NVIDIA: Feb 2026 – Jan 2027
    assert months_in_year(dt.date(2026, 6, 30), 2026) == 6
    # Geschäftsjahr bis Januar: Kalenderjahr 2026 = 1/12 GJ bis Jan 2026 + 11/12 GJ bis Jan 2027
    fy = {mi(2026, 1): 12.0, mi(2027, 1): 24.0}
    assert calendarize(fy, 2026) == pytest.approx(1 + 22)
    assert calendarize(fy, 2027) is None  # GJ bis Jan 2028 fehlt
    assert calendarize({mi(2026, 6): 6.0, mi(2027, 6): 12.0}, 2026) == pytest.approx(3 + 6)
    q = [(dt.date(2025, 4, 30), 1.0), (dt.date(2025, 7, 31), 1.0), (dt.date(2025, 10, 31), 1.0), (dt.date(2026, 1, 31), 2.0),
         (dt.date(2026, 4, 30), 3.0)]
    assert fy_from_quarters(q, 1) == {mi(2026, 1): 5.0}  # unvollständiges Jahr fehlt


def test_split_and_dividend_corrections():
    assert split_ratio("10.000000/1.000000") == 10 and split_ratio("3:2") == 1.5 and split_ratio("x") is None
    split = (dt.date(2024, 6, 10), 10.0)
    raw = [(dt.date(2023, 12, 31), 5.0), (dt.date(2024, 3, 31), 5.5), (dt.date(2024, 9, 30), 0.6), (dt.date(2024, 12, 31), 0.62)]
    fixed = split_fix(raw, [split])
    assert fixed[0][1] == pytest.approx(0.5) and fixed[2][1] == 0.6
    adjusted = [(d, v / 10 if d < split[0] else v) for d, v in raw]
    assert split_fix(adjusted, [split]) == adjusted  # schon bereinigt: unverändert

    dates = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"]
    traded = [100.0, 102.0, 99.0, 98.0, 101.0]
    divs = [("2026-01-06", 2.0), ("2026-01-08", 1.0)]
    # so bereinigt die Datenquelle: Kurse vor jedem Ex-Tag × (1 − Dividende ÷ Vortageskurs)
    adj = list(traded)
    for ex, d in divs:
        i = dates.index(ex)
        f = 1 - d / traded[i - 1]
        adj = [a * f if j < i else a for j, a in enumerate(adj)]
    back = undo_dividend_adjustment(dates, adj, divs)
    assert back == pytest.approx(traded)


def test_unit_factor_detects_pence_and_currency():
    assert unit_factor(2500.0, 2.0, 12.5) == pytest.approx(100)  # Kurs in Pence, Gewinn in Pfund
    assert unit_factor(100.0, 5.0, 21.0) == 1.0  # kleine Abweichung (andere Abgrenzung) bleibt
    assert unit_factor(100.0, None, None, 10.0, 9.0) == 1.0
    assert unit_factor(100.0, None, None, 0.06, 15.0) == pytest.approx(100 / 0.06 / 15)  # Gewinn in Cent


def _inputs(ticker, eps_by_year, est0, est1, ago=None, quarters=None, fy_month=12):
    ann = [(dt.date(y, fy_month, 28 if fy_month == 2 else 30 if fy_month in (6, 9) else 31), v) for y, v in eps_by_year.items()]
    ago = ago or {}
    return ValInputs(
        ticker=ticker, name=ticker, sector="Technology", country="USA", exchange="US", currency="USD", pe_ref=None, forward_pe_ref=None,
        quarters=quarters or [], annual=ann,
        estimates=[Estimate(end=dt.date(2026, 12, 31), period="0y", eps=est0, ago={d: est0 / (1 + ago.get(d, 0)) for d in (7, 30, 60, 90)}),
                   Estimate(end=dt.date(2027, 12, 31), period="+1y", eps=est1, ago={d: est1 / (1 + ago.get(d, 0)) for d in (7, 30, 60, 90)}, up30=3, down30=1)],
    )


def _prices(start_price, end_price):
    days, out = [], []
    d = dt.date(2020, 1, 1)
    n = (TODAY - d).days
    for i in range(n + 1):
        day = d + dt.timedelta(days=i)
        if day.weekday() < 5:
            days.append(day.isoformat())
            out.append(start_price * (end_price / start_price) ** (i / n))
    return days, out


def test_group_pe_is_total_value_over_total_earnings():
    da, pa = _prices(50, 100)  # A verdoppelt sich
    db, pb = _prices(100, 100)
    a = company_val(_inputs("A.US", {2021: 2.0, 2022: 2.5, 2023: 3.0, 2024: 3.5, 2025: 4.0}, 5.0, 6.0, ago={90: 0.1}), 300e9, da, pa, TODAY, prices_adjusted=False)
    b = company_val(_inputs("B.US", {2021: 5.0, 2022: 5.0, 2023: 5.0, 2024: -1.0, 2025: 5.0}, 5.0, 5.0), 100e9, db, pb, TODAY, prices_adjusted=False)
    g = aggregate([a, b], TODAY, years_back=5)
    # 2027e: Börsenwert 300 + 100 Mrd. ÷ Gewinn (300/100·6 + 100/100·5 = 23 Mrd. »Einheiten«)
    sa, sb = 300e9 / a.price_now, 100e9 / b.price_now
    assert g.pe_years[2027] == pytest.approx((300e9 + 100e9) / (sa * 6.0 + sb * 5.0))
    # 2024 mit Verlust bei B: Verlust mindert den Gesamtgewinn
    pe24 = (sa * a.year_end(2024) + sb * b.year_end(2024)) / (sa * 3.5 + sb * -1.0)
    assert g.pe_years[2024] == pytest.approx(pe24)
    assert g.coverage[2021] == 2 and g.n == 2
    # Revisionen: Konsens von A war vor 90 Tagen 10 % niedriger
    assert g.revisions[90] == pytest.approx((sa * 6 + sb * 5) / (sa * 6 / 1.1 + sb * 5) - 1)
    assert g.revisions[7] == pytest.approx(0)
    assert g.up30 == 6 and g.down30 == 2
    assert g.growth_next == pytest.approx((sa * 6 + sb * 5) / (sa * 5 + sb * 5) - 1)
    assert len(g.forward_path) == 5 and g.forward_path[-1][1] == pytest.approx(g.pe_years[2027])
    assert g.dist52 == pytest.approx(0, abs=1e-9)  # beide auf dem Hoch
    assert set(g.decomposition) == {"1J", "3J", "5J"}


def test_negative_group_earnings_and_member_pe():
    d, p = _prices(10, 10)
    c = company_val(_inputs("L.US", {2023: -1.0, 2024: -2.0, 2025: -1.5}, -0.5, 0.5), 5e9, d, p, TODAY, prices_adjusted=False)
    g = aggregate([c], TODAY)
    assert g.pe_years[2026] is None and 2026 in g.negative_years
    assert g.pe_years[2027] == pytest.approx(10 / 0.5)


def test_inputs_parse_trend_formats():
    raw = {
        "General": {"Name": "X", "Sector": "Energy", "CountryName": "USA", "Exchange": "NYSE", "CurrencyCode": "USD"},
        "Valuation": {"TrailingPE": 12.0, "ForwardPE": 10.0},
        "Earnings": {
            "History": {"2026-06-30": {"date": "2026-06-30", "epsActual": 1.1}, "2026-09-30": {"date": "2026-09-30", "epsActual": None}},
            "Annual": {"2025-12-31": {"date": "2025-12-31", "epsActual": 4.0}},
            "Trend": {"Annual": {"2026-12-31": {"date": "2026-12-31", "period": "0y", "earningsEstimateAvg": "4.5", "epsTrend90daysAgo": "4.2",
                                                "epsRevisionsUpLast30days": "5", "epsRevisionsDownLast30days": 2}},
                      "Quarterly": {"2026-12-31": {"date": "2026-12-31", "period": "0q"}}},
        },
    }
    v = from_fundamentals(raw, "X.US")
    assert v.quarters == [(dt.date(2026, 6, 30), 1.1)] and v.annual == [(dt.date(2025, 12, 31), 4.0)]
    assert len(v.estimates) == 1 and v.estimates[0].eps == 4.5 and v.estimates[0].ago[90] == 4.2 and v.estimates[0].up30 == 5
    flat = {"Earnings": {"Trend": {"a": {"date": "2027-12-31", "period": "+1y", "epsTrendCurrent": 5.0}, "b": {"date": "2026-12-31", "period": "0q"}}}}
    assert [e.period for e in from_fundamentals(flat, "Y").estimates] == ["+1y"]


def test_valuation_endpoints_demo(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        first = c.get("/api/valuation/overview").json()
        assert first["state"] in ("building", "ready")
        c.app.state.valuation  # noqa: B018
        import asyncio
        import time

        for _ in range(100):
            o = c.get("/api/valuation/overview", params={"kind": "sector", "region": "all"}).json()
            if o["state"] == "ready":
                break
            time.sleep(0.1)
        assert o["state"] == "ready" and o["years"] == list(range(2021, 2028)) and o["estYears"] == [2026, 2027]
        labels = {r["label"] for r in o["rows"]}
        assert "Technologie" in labels and len(o["rows"]) == 11
        tech = next(r for r in o["rows"] if r["key"] == "Technology")
        assert tech["n"] >= 5 and tech["peYears"]["2027"] and tech["peTtm"] and 0 <= tech["position"] <= 1
        assert tech["rev90"] is not None and tech["state"] in ("baer", "korrektur", "nahe")
        us = c.get("/api/valuation/overview", params={"kind": "sector", "region": "us"}).json()
        assert all(r["region"] == "us" for r in us["rows"]) and us["rows"]
        countries = c.get("/api/valuation/overview", params={"kind": "country"}).json()["rows"]
        assert {r["label"] for r in countries} >= {"USA", "Deutschland", "Schweiz"}
        d = c.get("/api/valuation/detail", params={"kind": "sector", "key": "Technology", "region": "all"}).json()
        assert len(d["monthly"]["t"]) == 121 and len(d["forwardPath"]["v"]) == 5 and d["recorded"]["t"] == ["2026-11-06"]
        assert d["members"][0]["mcap"] >= d["members"][-1]["mcap"] and set(d["decomposition"]) == {"1J", "3J", "5J"}
        de = c.get("/api/valuation/detail", params={"kind": "country", "key": "XETRA"}).json()
        assert de["row"]["label"] == "Deutschland"
        assert c.get("/api/valuation/detail", params={"kind": "sector", "key": "Unbekannt"}).status_code == 404
        assert c.get("/api/valuation/overview", params={"kind": "x"}).status_code == 422
    saved = json.loads((tmp_path / "bewertung-demo.json").read_text())
    assert saved["today"] == "2026-11-06" and saved["rows"]
    rec = json.loads((tmp_path / "bewertung-verlauf-demo.json").read_text())
    assert "2026-11-06" in rec["sector:all:Technology"]
    # Neustart: gespeichertes Ergebnis wird ohne Neuberechnung geladen
    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        assert c.get("/api/valuation/overview").json()["state"] == "ready"


def test_ask_tool_bewertung(tmp_path, monkeypatch):
    import asyncio

    from app.ai.tools import run_tool, summarize
    from app.services.terminal import Terminal
    from app.valuation.service import ValuationService

    t = Terminal(DemoProvider(now_fn=lambda: NOW))
    assert "fehler" in asyncio.run(run_tool(t, "bewertung", {}))
    t.valuation = ValuationService(t, str(tmp_path), "demo")
    asyncio.run(t.valuation.build())
    res = asyncio.run(run_tool(t, "bewertung", {"art": "sektor", "name": "Technologie"}))
    g = res["gruppen"]
    assert len(g) == 1 and g[0]["name"] == "Technologie" and "2027" in g[0]["kgv_je_jahr"] and "Analystenschätzungen" in res["hinweis"]
    land = asyncio.run(run_tool(t, "bewertung", {"art": "land"}))
    assert land["art"] == "Länder" and any(x["name"] == "Deutschland" for x in land["gruppen"])
    assert summarize("bewertung", {}, res) == "Bewertungstrend"


def test_listing_exclusions_adrs_and_dual_listings():
    from app.valuation.service import listing_exclusions

    out = listing_exclusions({
        "AAPL.US": ("US0378331005", "USA", 5e7),
        "TSM.US": ("US8740391003", "Taiwan", 1e7),  # ADR
        "ACN.US": ("IE00B4BNMY34", "Ireland", 3e6),  # Sitz Irland, aber eigentliche Aktie in New York
        "ASML.AS": ("NL0010273215", "Netherlands", 9e5),
        "ASML.US": ("USN070592100", "Netherlands", 1e6),  # US-ISIN, Sitz Niederlande: ADR-artig
        "AIR.PA": ("NL0000235190", "Netherlands", 1.5e6),
        "AIR.XETRA": ("NL0000235190", "Netherlands", 2e4),  # Zweitnotierung, kleines Volumen
        "SAP.XETRA": ("DE0007164600", "Germany", 1e6),
        "SAP.MI": ("DE0007164600", "Germany", 5e6),  # mehr Volumen, aber Heimatbörse laut ISIN ist Xetra
        "X.US": (None, "Taiwan", 1.0),  # ohne ISIN: nicht entscheidbar, bleibt
    })
    assert out == {"TSM.US", "ASML.US", "AIR.XETRA", "SAP.MI"}


def test_pe_bands_lines_future_and_fair_value():
    from app.valuation.bands import band_test, pe_bands, percentiles

    t = [f"2020-{i:03d}" for i in range(40)]
    pe = [10.0 + (i % 10) for i in range(40)]  # 10 … 19, Median 14,5
    level = [100.0] * 40
    pe[-1] = 20.0
    b = pe_bands(t, pe, level, future=[("2099-12-31", 10.0)])
    assert b.pct["p50"] == pytest.approx(14.5) and b.pct["p10"] < b.pct["p25"] < b.pct["p75"] < b.pct["p90"]
    # Kurslinie = Kurs × Band-KGV ÷ KGV: heute (KGV 20) liegt der Median bei 100 × 14,5 / 20
    assert b.lines["p50"][-1] == pytest.approx(72.5) and b.fair_now == pytest.approx(72.5)
    # Zukunft: Kurs beim Median-KGV auf den geschätzten Gewinn (KGV dort 10 zum heutigen Kurs)
    assert b.future_t == [t[-1], "2099-12-31"] and b.future["p50"][-1] == pytest.approx(145)
    assert b.fair_next == pytest.approx(145) and b.fair_year == 2099 and b.fair_gap == pytest.approx(0.45)
    assert b.position == 1.0
    assert percentiles([5.0] * 10) is None  # zu wenig Monate
    assert pe_bands(t[:5], pe[:5], level[:5]) is None
    # Verlust: kein KGV, keine Kurslinie
    pe2 = list(pe)
    pe2[5] = None
    assert pe_bands(t, pe2, level).lines["p50"][5] is None


def test_band_test_uses_only_past():
    from app.valuation.bands import band_test

    # KGV schwankt; nach hohem KGV fällt der Kurs, nach tiefem steigt er
    pe, level = [], []
    price = 100.0
    for i in range(80):
        p = 15 + 5 * math.sin(i / 4)
        pe.append(p)
        level.append(price)
        price *= 1 - (p - 15) / 200
    r = band_test(pe, level, horizon=6, min_history=24)
    assert r["oben"]["n"] > 0 and r["unten"]["n"] > 0
    assert r["oben"]["avg"] < 0 < r["unten"]["avg"]
    # ein Ausreißer ganz am Ende darf frühere Einordnungen nicht verändern (kein Blick in die Zukunft)
    pe2 = pe[:-1] + [1000.0]
    assert band_test(pe2, level, horizon=6, min_history=24) == r


def test_stock_bands_endpoint_and_group_fair_value(tmp_path, monkeypatch):
    monkeypatch.setenv("PORTFOLIO_DIR", str(tmp_path))
    from app.config import Settings

    with TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg=Settings())) as c:
        b = c.get("/api/valuation/bands/NWND US").json()
        assert b["ticker"] == "NWND.US" and len(b["t"]) == 121 and set(b["lines"]) == {"p10", "p25", "p50", "p75", "p90"}
        assert b["futureT"][-1] == "2027-12-31" and b["fairYear"] == 2027 and b["fairGap"] is not None
        assert set(b["test"]) == {"unten", "mitte", "oben"} and "Median" in b["note"]
        assert c.get("/api/valuation/bands/GDAXI.INDX").status_code in (404, 400)
        import time

        for _ in range(100):
            o = c.get("/api/valuation/overview").json()
            if o["state"] == "ready":
                break
            time.sleep(0.1)
        tech = next(r for r in o["rows"] if r["key"] == "Technology")
        assert tech["median"] > 0 and tech["fairGap"] is not None
        d = c.get("/api/valuation/detail", params={"kind": "sector", "key": "Technology"}).json()
        assert d["bands"]["level"][-1] == pytest.approx(100) and d["bands"]["pct"]["p50"] == pytest.approx(tech["median"])
        assert all("fairGap" in m for m in d["members"])


def test_sector_relative_excludes_the_stock_itself():
    from app.valuation.calc import aggregate, company_val, sector_relative

    da, pa = _prices(50, 100)
    db, pb = _prices(100, 100)
    dc, pc = _prices(80, 60)
    eps = {2021: 2.0, 2022: 2.5, 2023: 3.0, 2024: 3.5, 2025: 4.0}
    a = company_val(_inputs("A.US", eps, 5.0, 6.0), 300e9, da, pa, TODAY, prices_adjusted=False)
    b = company_val(_inputs("B.US", {y: 5.0 for y in eps}, 5.0, 5.0), 100e9, db, pb, TODAY, prices_adjusted=False)
    cc = company_val(_inputs("C.US", {y: 4.0 for y in eps}, 4.0, 4.0), 50e9, dc, pc, TODAY, prices_adjusted=False)
    g = aggregate([a, b, cc], TODAY)
    rel = sector_relative(a, TODAY, g.sums, 300e9)
    # Sektor ohne A = B und C: KGV aufs nächste Jahr = Börsenwert ÷ Gewinn der beiden
    sb, sc = 100e9 / b.price_now, 50e9 / cc.price_now
    expect = (sb * b.price_now + sc * cc.price_now) / (sb * 5.0 + sc * 4.0)
    assert rel.pe_next == pytest.approx(expect)
    assert rel.fair_sector == pytest.approx(expect * 6.0)  # Kurs von A beim Sektor-KGV
    ex = aggregate([b, cc], TODAY)
    assert rel.pe_now == pytest.approx(ex.pe_ttm)  # gleich wie die Gruppe ganz ohne A
    # nicht Mitglied: Sektor bleibt vollständig
    full = sector_relative(a, TODAY, g.sums, None)
    assert full.pe_next == pytest.approx(g.pe_years[2027])
    assert sector_relative(a, TODAY, {"num": [1.0], "den": [1.0]}, None) is None


def test_stock_bands_with_sector(tmp_path):
    import asyncio

    from app.services.terminal import Terminal
    from app.valuation.service import ValuationService

    t = Terminal(DemoProvider(now_fn=lambda: NOW))
    vs = ValuationService(t, str(tmp_path), "demo")
    b0 = asyncio.run(vs.stock_bands("NWND.US"))
    assert b0.sector is None  # Sektordaten noch nicht berechnet
    asyncio.run(vs.build())
    b = asyncio.run(vs.stock_bands("NWND.US"))
    s = b.sector
    assert s.label == "Technologie" and s.region == "us" and s.n >= 2
    assert s.pe_next > 0 and s.rel_now > 0 and s.fair_sector_gap is not None and s.bands is not None
    assert s.bands.pct["p50"] == pytest.approx(s.rel_median)
