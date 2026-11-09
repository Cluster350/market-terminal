"""Regressionstests der Fehlersuche nach Krypto (CRYP), Faktoren (FCTR/Faktorlast) und Tagesdaten (RRG)."""

import asyncio
import datetime as dt

import pytest

from app.ai.tools import run_tool
from app.cache import TTLCache
from app.crypto import service as crypto_service
from app.crypto.service import CryptoService
from app.eodhd import mapping
from app.errors import NotFound, TerminalError, UpstreamError
from app.factors import service as factor_service
from app.factors.service import FactorService
from app.factors.universe import REGIONS
from app.models import History, Intraday
from app.portfolio.models import Portfolio, Position
from app.providers.demo import DemoProvider
from app.realtime.demo import DemoSource
from app.realtime.hub import Tick
from app.rotation.calc import Series
from app.rotation.service import RotationService
from app.services import metrics
from app.services.terminal import Terminal

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 6, 15, 0, tzinfo=UTC)


def demo_terminal(now: dt.datetime = NOW) -> Terminal:
    return Terminal(DemoProvider(now_fn=lambda: now), TTLCache())


# --- Kleinstkurse (Shiba Inu ≈ 0,00001 USD) ---------------------------------------------------


def test_eodhd_history_keeps_significant_digits_of_tiny_prices():
    # vorher: round(x, 6) machte aus 0,00001234 den Kurs 0,000012 – Tagesrenditen, Schwankung, 7T/30T in CRYP
    # sprangen in Stufen von 8 %
    raw = [
        {"date": "2026-11-04", "open": 0.00001201, "high": 0.00001252, "low": 0.00001188, "close": 0.00001234, "adjusted_close": 0.00001234},
        {"date": "2026-11-05", "open": 0.00001234, "high": 0.00001290, "low": 0.00001230, "close": 0.00001281, "adjusted_close": 0.00001281},
    ]
    h = mapping.history(raw, "SHIB-USD.CC")
    assert h.c == [pytest.approx(1.234e-5, rel=1e-6), pytest.approx(1.281e-5, rel=1e-6)]
    assert h.h[1] == pytest.approx(1.29e-5, rel=1e-6) and h.l[0] == pytest.approx(1.188e-5, rel=1e-6)
    # normale Kurse weiter auf sechs Nachkommastellen (kein Rauschen aus dem Bereinigungsfaktor)
    n = mapping.history([{"date": "2026-11-05", "open": 3, "high": 3, "low": 3, "close": 3, "adjusted_close": 1.0000001234}], "X.US")
    assert n.c == [1.0] and n.o == [1.0]


def test_realtime_ticks_and_sparklines_keep_tiny_prices():
    # vorher schickte der Echtzeit-Strom Shiba Inu als 3,7e-05 (statt 3,65625e-05) an den Browser: falscher Kurs,
    # falsche Tagesveränderung und ein falsches Tageshoch in Watchlist und Kurschart
    assert Tick("SHIB-USD.CC", 3.65625e-05, 1).as_dict()["p"] == pytest.approx(3.65625e-05, rel=1e-9)
    assert Tick("EURUSD.FOREX", 1.16845678912, 1).as_dict()["p"] == 1.168457
    assert metrics.last_n([1.2345e-5, None, 1.2399e-5], 30) == [1.2345e-5, 1.2399e-5]

    class Provider:
        prices = iter([3.60e-05, 3.61e-05, 3.62e-05, 3.63e-05])

        def live_price(self, ticker):
            return next(self.prices, 3.63e-05), 1_000

    class Hub:
        connected, message, ticks = False, None, []

        def on_tick(self, tick):
            self.ticks.append(tick.price)

    async def run():
        src, hub = DemoSource(Provider(), every=0.001), Hub()
        src.set_symbols(["SHIB-USD.CC"])
        task = asyncio.create_task(src.run(hub))
        await asyncio.sleep(0.05)
        task.cancel()
        return hub.ticks

    # vorher galten alle vier Kurse als „unverändert“ (auf sechs Nachkommastellen gleich 0,000036)
    assert asyncio.run(run()) == [3.60e-05, 3.61e-05, 3.62e-05, 3.63e-05]


def test_ai_tools_do_not_round_tiny_prices_to_zero():
    t = demo_terminal()
    t.crypto = CryptoService(t)

    async def main():
        q = (await t.quotes(["SHIB-USD.CC"]))[0]
        k = await run_tool(t, "kurs", {"ticker": "SHIB-USD.CC"})
        w = await run_tool(t, "wertentwicklung", {"ticker": "SHIB-USD.CC"})
        c = await run_tool(t, "krypto", {"name": "Shiba Inu"})
        return q, k, w, c

    q, k, w, c = asyncio.run(main())
    assert 0 < q.last < 0.001
    assert k["kurs"] == pytest.approx(q.last, rel=1e-5)  # vorher 0.0
    assert k["vortag"] == pytest.approx(q.prev_close, rel=1e-5) and k["hoch"] > 0 and k["tief"] > 0
    assert w["letzter_schluss"] > 0 and w["tief_52w"] > 0
    assert c["coins"][0]["kurs"] == pytest.approx(q.last, rel=1e-5)  # vorher nur zwei gültige Stellen
    nwnd = asyncio.run(run_tool(t, "kurs", {"ticker": "NWND.US"}))
    assert nwnd["kurs"] == round(nwnd["kurs"], 4)  # normale Kurse unverändert gerundet


# --- Faktorlast -----------------------------------------------------------------------------


def test_factor_exposure_refuses_short_and_credit_depots():
    t = demo_terminal()
    fs = FactorService(t)
    long_ = asyncio.run(fs.exposure(Portfolio(base="EUR", positions=[Position(ticker="SPY.US", quantity=10)])))
    assert long_.market.beta == pytest.approx(1.0, abs=0.01)
    # vorher: Leerverkauf von SPY ergab Beta +1,0 (Renditen eines negativen Depotwerts mit falschem Vorzeichen),
    # ein Depot auf Kredit Beta −1,05 statt eines gehebelten Betas über 1
    for p in (
        Portfolio(base="EUR", positions=[Position(ticker="SPY.US", quantity=-10)]),
        Portfolio(base="EUR", cash=-100_000, positions=[Position(ticker="SPY.US", quantity=100)]),
    ):
        with pytest.raises(NotFound, match="nicht durchgehend positiv"):
            asyncio.run(fs.exposure(p))
    # Leerverkauf neben größeren Käufen (Depotwert bleibt positiv): weiter berechnet
    mixed = Portfolio(base="EUR", positions=[Position(ticker="SPY.US", quantity=10), Position(ticker="IWM.US", quantity=-5)])
    assert asyncio.run(fs.exposure(mixed)).weeks >= 52


class _CountingTerminal:
    """Suche und Kursabrufe ohne Treffer, gezählt."""

    def __init__(self):
        self.searches = self.histories = 0

    async def search(self, q, limit):
        self.searches += 1
        return []

    async def history(self, ticker):
        self.histories += 1
        raise NotFound(ticker)


def test_unresolved_isin_is_not_searched_on_every_call(monkeypatch):
    clock = [1_000_000.0]
    monkeypatch.setattr(factor_service.time, "time", lambda: clock[0])
    t = _CountingTerminal()
    svc = FactorService(t, None, "eodhd")
    f = REGIONS["eu"].factors[0]
    assert asyncio.run(svc.ticker_of(f, "EUR")) is None
    calls = (t.searches, t.histories)
    # vorher: bei jedem Aufruf (FCTR alle 5 Minuten, RRG, Faktorlast) erneut Suche und Kursabrufe
    for _ in range(3):
        assert asyncio.run(svc.ticker_of(f, "EUR")) is None
    assert (t.searches, t.histories) == calls
    clock[0] += factor_service.RETRY_SECONDS + 1  # nach einer Stunde wieder versuchen
    assert asyncio.run(svc.ticker_of(f, "EUR")) is None and t.histories > calls[1]


# --- Kryptoübersicht ------------------------------------------------------------------------


def test_crypto_master_data_retried_soon_after_transient_error(monkeypatch):
    clock = [1_000_000.0]
    monkeypatch.setattr(crypto_service.time, "time", lambda: clock[0])

    class P:
        calls = 0
        fail: type | None = UpstreamError

        async def crypto_info(self, ticker):
            self.calls += 1
            if self.fail:
                raise self.fail("Zeitüberschreitung")
            return {"circulating_supply": 19.9e6}

    class T:
        p = P()

    svc = CryptoService(T())
    assert asyncio.run(svc._crypto_info("BTC-USD.CC")) == {}
    T.p.fail = None
    clock[0] += 60
    assert asyncio.run(svc._crypto_info("BTC-USD.CC")) == {}  # kurz danach: noch gemerkt
    clock[0] += crypto_service.INFO_RETRY_SECONDS
    # vorher erst nach 24 Stunden: so lange ohne Marktkapitalisierung, Anteile nur unter den übrigen Coins
    assert asyncio.run(svc._crypto_info("BTC-USD.CC")) == {"circulating_supply": 19.9e6}
    # gibt es nicht (NotFound): weiter einen Tag gemerkt, kein Abruf je Minute
    svc2, T.p.fail, before = CryptoService(T()), NotFound, T.p.calls
    asyncio.run(svc2._crypto_info("XMR-USD.CC"))
    clock[0] += crypto_service.INFO_RETRY_SECONDS + 1
    asyncio.run(svc2._crypto_info("XMR-USD.CC"))
    assert T.p.calls == before + 1


def test_crypto_24h_in_euro_uses_friday_fx_close_on_monday():
    """Montag 12 Uhr UTC: „vor 24 Stunden“ ist Sonntag, der Devisenmarkt war zu. Bezug in Euro ist der
    Freitagsschluss von EUR/USD – vorher fehlte er (nur zwei Handelstage geladen: Sonntagabend und Montag),
    und die 24 Stunden in Euro rechneten mit dem Devisenkurs von jetzt."""
    monday = dt.datetime(2026, 11, 9, 12, 0, tzinfo=UTC)
    t = demo_terminal(monday)
    friday_close = dt.datetime(2026, 11, 6, 22, 0, tzinfo=UTC).timestamp()

    async def intraday(ticker, days, interval="5m"):
        # Krypto rund um die Uhr zu 100 USD; Devisen Sonntag 22 Uhr bis Freitag 22 Uhr (1,10, ab Sonntag 1,12)
        end = int(monday.timestamp())
        ts_, c_ = [], []
        for ts in range(end - 7 * 86400, end, 300):
            d = dt.datetime.fromtimestamp(ts, UTC)
            if ticker.endswith(".FOREX"):
                if d.weekday() == 5 or (d.weekday() == 4 and d.hour >= 22) or (d.weekday() == 6 and d.hour < 22):
                    continue
                c_.append(1.10 if ts < friday_close else 1.12)
            else:
                c_.append(100.0)
            ts_.append(ts)
        data = Intraday(ticker=ticker, interval="5m", t=ts_, o=c_, h=c_, l=c_, c=c_, v=[None] * len(c_))
        return mapping.last_sessions(data, days)  # wie der EODHD-Abruf: nur die letzten `days` Handelstage

    t.intraday = intraday  # type: ignore[method-assign]
    eur = asyncio.run(CryptoService(t).overview("eur"))
    btc = next(r for r in eur.rows if r.ticker == "BTC-USD.CC")
    # Kurs jetzt in Euro gegenüber 100 USD zum Freitagskurs 1,10
    assert btc.chg_24h == pytest.approx((btc.last / (100 / 1.10) - 1) * 100, rel=1e-9)


# --- Rotation -------------------------------------------------------------------------------


def test_rotation_reports_members_without_enough_history_for_sectors():
    # vorher gingen die Hinweise verloren, wenn der Bereich keine eigene Liste mitgab (Sektoren, Firmen im Sektor):
    # eine junge Firma fehlte ohne „Nicht enthalten“
    n = 120
    weeks = [f"w{i:03d}" for i in range(n)]
    bench = [100.0 * (1.001 ** i) for i in range(n)]
    old = Series(key="ALT", label="Alt AG", values=[100.0 * (1.002 ** i) for i in range(n)])
    young = Series(key="NEU", label="Neu AG", values=[None] * (n - 6) + [50.0] * 6)
    res = RotationService._compute("sector", "Im Sektor", "Index", weeks, bench, [old, young])
    assert [m.key for m in res.members] == ["ALT"] and res.skipped == ["Neu AG (zu wenig Verlauf)"]


def test_alert_texts_show_tiny_prices():
    from app.alerts.models import Alert
    from app.alerts.service import condition_text

    a = Alert(id="x", ticker="SHIB-USD.CC", level=0.00004, direction="above", created="2026-11-09T00:00:00Z")
    # vorher „über 0,0000“ – auch in der Meldung beim Auslösen und im KI-Werkzeug „alarme“
    assert condition_text(a) == "über 0,00004000"
    assert condition_text(a.model_copy(update={"ticker": "NWND.US", "level": 0.5})) == "über 0,5000"
    assert condition_text(a.model_copy(update={"ticker": "NWND.US", "level": 150.0})) == "über 150,00"
