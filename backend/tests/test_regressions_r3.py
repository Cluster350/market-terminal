"""Regressionstests zur dritten Review-Runde (Geschäftsjahre, Rohstoff-Generika)."""

import asyncio
import datetime as dt

import pytest

from app.providers.demo import DemoProvider
from app.services.tickers import normalize

UTC = dt.timezone.utc


def _revenue(now: dt.datetime, period: str) -> dict[str, float]:
    f = asyncio.run(DemoProvider(now_fn=lambda: now).financials("NWND.US", period))
    return dict(zip(f.periods, next(r for r in f.income if r.key == "totalRevenue").values))


def test_historic_financials_do_not_change_when_fiscal_year_rolls():
    # Vorher war das Umsatzniveau am neuesten Geschäftsjahr verankert: am 1. März sprangen
    # FY2024 und alle Quartale um den Wachstumsfaktor (102,8 -> 93,6 Mrd.)
    before = dt.datetime(2026, 2, 27, 12, tzinfo=UTC)
    after = dt.datetime(2026, 3, 2, 12, tzinfo=UTC)
    later = dt.datetime(2026, 10, 28, 15, tzinfo=UTC)
    for period, key in (("annual", "2024-12-31"), ("quarterly", "2025-09-30")):
        values = [_revenue(t, period)[key] for t in (before, after, later)]
        assert values[0] == pytest.approx(values[1]) == pytest.approx(values[2])


def test_fiscal_year_appears_with_fourth_quarter_report():
    # NWND berichtet Q4/2025 Ende Januar/Anfang Februar 2026: danach gehört FY2025 in die Jahresansicht
    rep = DemoProvider._report_date("NWND.US", dt.date(2025, 12, 31))[0]
    assert rep < dt.date(2026, 2, 27)
    feb = _revenue(dt.datetime(2026, 2, 27, 12, tzinfo=UTC), "annual")
    jan = _revenue(dt.datetime(2026, 1, 2, 12, tzinfo=UTC), "annual")
    assert "2025-12-31" in feb and "2025-12-31" not in jan
    quarters = _revenue(dt.datetime(2026, 2, 27, 12, tzinfo=UTC), "quarterly")
    q2025 = sum(v for k, v in quarters.items() if k.startswith("2025"))
    assert feb["2025-12-31"] == pytest.approx(q2025, rel=1e-6)  # Jahr = Summe der Quartale


@pytest.mark.parametrize(
    "raw,expected",
    [("W 1 Comdty", "WHEAT.COMM"), ("C 1 Comdty", "CORN.COMM"), ("S 1 COMDTY", "SOY.COMM"), ("W1 Comdty", "WHEAT.COMM"), ("CL1 Comdty", "WTI.COMM")],
)
def test_bloomberg_generic_commodities_with_space(raw, expected):
    assert normalize(raw) == expected
