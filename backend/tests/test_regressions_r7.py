"""Regressionstests der siebten Fehlersuche (nach DCF / innerem Wert und dem Windows-Start)."""

import datetime as dt
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.intrinsic import calc
from app.intrinsic.params import Params, apply_loaded
from app.intrinsic.service import Inputs, build
from app.main import create_app
from app.models import Company, Financials, Quote, SharesInfo, StatementRow
from app.providers.demo import DemoProvider

UTC = dt.timezone.utc
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os

    os.environ["PORTFOLIO_DIR"] = str(tmp_path_factory.mktemp("pf"))
    with TestClient(create_app(DemoProvider(now_fn=lambda: dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)))) as c:
        yield c


def _levers(r: dict) -> dict:
    return {lv["key"]: lv for lv in r["levers"]}


def test_dcf_lever_outside_range_is_limited_not_a_server_error(client):
    # Kapitalkosten „−100“ (%) im Eingabefeld: vorher Division durch null beim Abzinsen → Fehler 500, die Ansicht hing
    # an der Eingabe fest. Jetzt wird wie bei den Vorschlägen der Persona auf den erlaubten Bereich begrenzt.
    r = client.post("/api/intrinsic/QBIT.US", json={"levers": {"wacc": -1.0}, "simulate": False})
    assert r.status_code == 200
    d = r.json()
    assert d["state"] == "ok" and d["valuePerShare"] > 0
    assert _levers(d)["wacc"]["value"] == pytest.approx(0.02)
    assert any("Kapitalkosten Jahre 1–5" in w and "begrenzt" in w for w in d["warnings"])
    # nach oben genauso: 500 % Wachstum → 150 %
    up = client.post("/api/intrinsic/QBIT.US", json={"levers": {"growth_next": 5.0}, "simulate": False}).json()
    assert _levers(up)["growth_next"]["value"] == pytest.approx(1.5)
    # im Bereich: unverändert und ohne Hinweis
    ok = client.post("/api/intrinsic/QBIT.US", json={"levers": {"wacc": 0.11}, "simulate": False}).json()
    assert _levers(ok)["wacc"]["value"] == pytest.approx(0.11) and not any("begrenzt" in w and "Kapitalkosten" in w for w in ok["warnings"])
    # die Persona rechnet mit denselben Hebeln: auch dort kein Fehler 500
    coach = client.post("/api/ai/valuation/QBIT.US", json={"mode": "kommentar", "levers": {"wacc": -1.0}})
    assert coach.status_code == 200


def _fin(period, periods, inc, bal):
    mk = lambda d: [StatementRow(key=k, label=k, values=v) for k, v in d.items()]  # noqa: E731
    return Financials(ticker="X.US", period=period, currency="USD", periods=periods, income=mk(inc), balance=mk(bal), cashflow=[])


def _inputs(quarterly=None, riskfree=0.04) -> Inputs:
    comp = Company(ticker="X.US", name="X", sector="Technology", industry="Software", country="USA", currency="USD",
                   shares=SharesInfo(outstanding=10))
    annual = _fin("annual", ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31"],
                  {"totalRevenue": [100, 90, 80, 70], "operatingIncome": [10, 9, 8, 7], "interestExpense": [1, 1, 1, 1],
                   "incomeBeforeTax": [9, 8, 7, 6], "incomeTaxExpense": [2, 2, 2, 1]},
                  {"cash": [20], "shortLongTermDebtTotal": [30], "totalStockholderEquity": [50]})
    return Inputs("X.US", comp, annual, quarterly, Quote(ticker="X.US", last=15.0, currency="USD"), riskfree, "Test", 1.0)


def test_dcf_lever_limit_keeps_a_start_value_outside_the_range():
    # Sehr hoher risikoloser Zins: Startwert der Kapitalkosten über der Bereichsgrenze von 25 %. Er bleibt einstellbar;
    # begrenzt wird auf den Startwert, nicht darunter
    start = {x.key: x.default for x in build(_inputs(riskfree=0.25), Params(), {}).levers}
    assert start["wacc"] > 0.25
    same = build(_inputs(riskfree=0.25), Params(), {"wacc": start["wacc"]})
    assert not any("Kapitalkosten Jahre" in w for w in same.warnings)
    over = build(_inputs(riskfree=0.25), Params(), {"wacc": 0.60})
    assert {x.key: x.value for x in over.levers}["wacc"] == pytest.approx(start["wacc"])
    assert any("Kapitalkosten Jahre 1–5" in w for w in over.warnings)


def test_dcf_ttm_with_missing_quarter_ebit_falls_back_to_fiscal_year():
    # Ein Quartal ohne operatives Ergebnis: vorher „Zu wenige Finanzdaten“, obwohl das Geschäftsjahr vollständig ist
    q = _fin("quarterly", ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31"],
             {"totalRevenue": [30, 28, 27, 26], "operatingIncome": [3, None, 3, 3]},
             {"cash": [21], "shortLongTermDebtTotal": [29], "totalStockholderEquity": [52]})
    res = build(_inputs(q), Params(), {})
    assert res.state == "ok" and res.value_per_share is not None
    assert res.base_period.startswith("Geschäftsjahr")
    # vollständige Quartale: weiter letzte 12 Monate
    q_ok = _fin("quarterly", ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31"],
                {"totalRevenue": [30, 28, 27, 26], "operatingIncome": [3, 3, 3, 3]},
                {"cash": [21], "shortLongTermDebtTotal": [29], "totalStockholderEquity": [52]})
    assert build(_inputs(q_ok), Params(), {}).base_period.startswith("letzte 12 Monate")


def test_terminal_growth_warning_uses_decimal_comma():
    base = calc.Base(revenue=100, margin=0.1, tax_effective=0.2, tax_marginal=0.25, invested_capital=100, cash=0, debt=0,
                     shares=1, riskfree=0.0391)
    lev = calc.Levers(0.05, 0.05, 0.1, 5, 1.0, 0.09, 0.09, 0.06, 0.09)
    _, warn = calc.check_levers(lev, base)
    assert "(3,91 %)" in warn[0] and warn[0].endswith("Wirtschaft.")


def test_loaded_country_premium_of_zero_replaces_builtin_value():
    # Österreich hat eingebaut 0,5 %; lädt Damodarans Tabelle 0 % (Aaa), muss 0 % gelten („or“ verwarf die 0)
    p = Params()
    assert p.country("AT").crp > 0
    loaded = apply_loaded(Params(), {"crp": {"AT": 0.0, "FR": 0.0071}})
    assert loaded.country("AT").crp == 0.0
    assert loaded.country("FR").crp == pytest.approx(0.0071)


def test_start_scripts_check_a_status_address_without_network(client, monkeypatch):
    # Die Windows-Startskripte prüfen mit 1 s Zeitlimit, ob der Server läuft. /api/status fragt im EODHD-Modus jedes Mal
    # EODHD übers Netz – bei langsamer Antwort galt ein laufender Server als aus (zweiter Start, Fenster erst nach
    # Minuten). Geprüft wird jetzt /api/realtime/status: ohne Abruf bei der Datenquelle.
    calls: list[str] = []
    prov = client.app.state.terminal.p

    async def slow_status():
        calls.append("status")
        return {}

    monkeypatch.setattr(prov, "status", slow_status)
    assert client.get("/api/realtime/status").status_code == 200
    assert calls == []
    for name in ("Market Terminal starten.vbs", "werkzeuge/Terminal oeffnen.vbs"):
        text = (ROOT / name).read_bytes().decode("ascii")
        assert "/api/realtime/status" in text and '/api/status"' not in text
        assert "\r\n" in text and text.count("\n") == text.count("\r\n")  # Windows-Zeilenenden bleiben


def test_persona_dossier_and_demo_text_keep_tiny_per_share_values():
    # Pennystock (z. B. Londoner Kurs 0,85 Pence → 0,0085 Pfund): Mappe und Demo-Text zeigten Kurs 0,01 und Wert 0,0
    from app.ai.valuation_coach import demo_comment, dossier
    from app.intrinsic.models import IntrinsicResult, IvDistribution

    res = IntrinsicResult(ticker="PNY.LSE", name="Penny plc", currency="GBP", price=0.0085, value_per_share=0.0042,
                          value_gap=0.0042 / 0.0085 - 1, distribution=IvDistribution(runs=10, p10=0.0031, p50=0.0041, p90=0.0057))
    d = dossier(res)
    assert d["kurs"] == pytest.approx(0.0085) and d["wert_je_aktie"] == pytest.approx(0.0042)
    assert d["bandbreite_je_aktie"]["p10"] == pytest.approx(0.0031)
    text = next(s.text for s in demo_comment(res) if s.title == "Wert gegen Preis")
    assert "Wert je Aktie 0,004200 GBP" in text and "Kurs von 0,008500 GBP" in text and "0,003100 (P10)" in text  # wie fmtPrice
    # normale Kurse unverändert mit zwei Nachkommastellen
    big = IntrinsicResult(ticker="X.US", name="X", currency="USD", price=193.83047, value_per_share=121.76328)
    assert dossier(big)["kurs"] == 193.83 and dossier(big)["wert_je_aktie"] == 121.76
    assert "Wert je Aktie 121,76 USD gegen einen Kurs von 193,83 USD" in next(s.text for s in demo_comment(big) if s.title == "Wert gegen Preis")


def test_dcf_start_growth_with_a_gap_in_annual_revenue():
    # Umsatz des Vorjahres fehlt: vorher rückte das vorletzte Jahr nach – zwei Jahre Wachstum (100/80 = +25 %) galten
    # als eines. Jetzt 3-Jahres-Schnitt je Jahr an seiner Stelle: (100/70)^(1/3) − 1 ≈ 12,6 %
    inp = _inputs()
    for row in inp.annual.income:
        if row.key == "totalRevenue":
            row.values = [100, None, 80, 70]
    res = build(inp, Params(), {})
    g = {x.key: x.default for x in res.levers}["growth_next"]
    assert g == pytest.approx((100 / 70) ** (1 / 3) - 1, abs=1e-9)
    # negativer Umsatz im Geschäftsjahr (Datenfehler) bei positiven Quartalen: keine komplexe Zahl, kein Fehler 500
    q = _fin("quarterly", ["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31"],
             {"totalRevenue": [30, 28, 27, 26], "operatingIncome": [3, 3, 3, 3]},
             {"cash": [21], "shortLongTermDebtTotal": [29], "totalStockholderEquity": [52]})
    inp2 = _inputs(q)
    for row in inp2.annual.income:
        if row.key == "totalRevenue":
            row.values = [-5, 90, 80, 70]
    assert build(inp2, Params(), {}).state == "ok"
