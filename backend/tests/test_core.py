import asyncio
import math

import pytest

from app.cache import TTLCache
from app.errors import BadRequest
from app.services import metrics
from app.services.tickers import normalize, normalize_list
from app.services.util import num, pct


@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, None), ("", None), ("NA", None), ("12.5", 12.5), ("1,234.5", 1234.5),
        (3, 3.0), (float("nan"), None), (True, None), ("abc", None), ("0", 0.0),
    ],
)
def test_num(raw, expected):
    assert num(raw) == expected


def test_pct():
    assert pct(110, 100) == pytest.approx(10.0)
    assert pct(1, 0) is None
    assert pct(None, 1) is None


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("aapl", "AAPL.US"),
        ("SAP GR", "SAP.XETRA"),
        ("SAP GR Equity", "SAP.XETRA"),
        ("vod ln", "VOD.LSE"),
        ("SAP.XETRA", "SAP.XETRA"),
        ("BRK-B", "BRK-B.US"),
        ("BTC-USD.CC", "BTC-USD.CC"),
        ("GSPC.INDX", "GSPC.INDX"),
    ],
)
def test_normalize(raw, expected):
    assert normalize(raw) == expected


@pytest.mark.parametrize("raw", ["", "a b c", "../etc", "AAPL/US", "x" * 40, "AA PL!"])
def test_normalize_rejects(raw):
    with pytest.raises(BadRequest):
        normalize(raw)


def test_normalize_list_dedup_and_limit():
    assert normalize_list("aapl, AAPL.US;msft") == ["AAPL.US", "MSFT.US"]
    with pytest.raises(BadRequest):
        normalize_list(",".join(f"T{i}" for i in range(60)))


def test_metrics_perf_and_ytd():
    closes = [100.0] * 30 + [110.0]
    assert metrics.perf(closes, 21) == pytest.approx(10.0)
    assert metrics.perf(closes[:5], 21) is None
    dates = ["2025-12-30", "2025-12-31", "2026-01-02", "2026-01-05"]
    assert metrics.perf_ytd(dates, [90, 100, 105, 120]) == pytest.approx(20.0)


def test_rsi_bounds_and_known_cases():
    up = [float(i) for i in range(1, 40)]
    assert metrics.rsi(up) == 100.0
    flat = [5.0] * 30
    assert metrics.rsi(flat) == 50.0
    zigzag = [10.0 + (1 if i % 2 else 0) for i in range(60)]
    assert 40 < metrics.rsi(zigzag) < 60


def test_annual_vol():
    import random

    rng = random.Random(1)
    p, closes = 100.0, []
    for _ in range(300):
        p *= math.exp(rng.gauss(0, 0.01))
        closes.append(p)
    vol = metrics.annual_vol(closes)
    assert 13 < vol < 19  # 1 % täglich ~ 15,9 % p. a.


def test_cache_single_flight_and_stale():
    async def run():
        cache = TTLCache()
        calls = 0

        async def loader():
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            return calls

        results = await asyncio.gather(*(cache.get_or_load("k", 60, loader) for _ in range(10)))
        assert calls == 1
        assert all(r == (1, False) for r in results)

        # Abgelaufener Eintrag + Fehler beim Nachladen -> alter Wert, als stale markiert
        await cache.get_or_load("s", 0, loader)

        async def failing():
            raise RuntimeError("down")

        value, stale = await cache.get_or_load("s", 0, failing)
        assert stale is True and value == 2

        with pytest.raises(RuntimeError):
            await cache.get_or_load("never", 0, failing)

    asyncio.run(run())
