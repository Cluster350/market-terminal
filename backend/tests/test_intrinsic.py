"""Innerer Wert (Funktion DCF, Methode nach Damodaran): Rechenkern, Parameter, Aktualisierung, Schnittstelle."""

import asyncio
import datetime as dt
import json
import math
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from app.intrinsic import calc, damodaran_data
from app.intrinsic.calc import Base, Levers
from app.intrinsic.params import Params, apply_loaded, country_code, is_financial, load_params
from app.main import create_app
from app.providers.demo import DemoProvider

UTC = dt.timezone.utc


# --- F&E aktivieren ---------------------------------------------------------------------------------------------


def test_rd_capitalization_like_damodaran_five_year_life():
    # laufendes Jahr 100 % nicht abgeschrieben, Vorjahr 80 %, davor 60 %, 40 %, 20 % (wie in der Persona-Datei)
    rd = calc.capitalize_rd([100, 90, 80, 70, 60, 50], life=5)
    assert rd is not None
    assert rd.asset == pytest.approx(100 + 90 * 0.8 + 80 * 0.6 + 70 * 0.4 + 60 * 0.2)  # 260
    assert rd.amortization == pytest.approx((90 + 80 + 70 + 60 + 50) / 5)  # 70
    assert rd.adjustment == pytest.approx(30)  # F&E zurück, Abschreibung ab
    assert rd.estimated == 0


def test_rd_missing_years_are_extrapolated_and_flagged():
    rd = calc.capitalize_rd([121, 110, 100], life=5)
    assert rd is not None and rd.estimated == 3
    assert rd.history[3] == pytest.approx(100 / 1.1, rel=1e-9)  # mit beobachtetem Wachstum (10 %) zurückgerechnet
    assert calc.capitalize_rd([], 5) is None
    assert calc.capitalize_rd([0, 10], 5) is None


# --- Kapitalkosten --------------------------------------------------------------------------------------------


def test_relever_hamada():
    assert calc.relever(1.0, 0.5, 0.25) == pytest.approx(1.375)


def test_cost_of_capital_build_up():
    p = Params()
    coc = calc.cost_of_capital(riskfree=0.04, erp=0.05, crp=0.01, beta_u=1.0, market_cap=800.0, debt=200.0, ebit=100.0,
                               interest=10.0, tax_marginal=0.25, rating_for=p.rating_for)
    assert coc.beta_l == pytest.approx(1 + 0.75 * 0.25)
    assert coc.cost_equity == pytest.approx(0.04 + coc.beta_l * 0.05 + 0.01)
    assert coc.rating == "AAA" and coc.coverage == pytest.approx(10)
    assert coc.cost_debt_after == pytest.approx((0.04 + 0.0059) * 0.75)
    assert coc.weight_debt == pytest.approx(0.2)
    assert coc.wacc == pytest.approx(0.8 * coc.cost_equity + 0.2 * coc.cost_debt_after)
    assert coc.wacc_terminal == pytest.approx(0.04 + 0.05 + 0.01)
    # schwache Zinsdeckung → schlechtes Rating, hoher Aufschlag
    weak = calc.cost_of_capital(riskfree=0.04, erp=0.05, crp=0.0, beta_u=1.0, market_cap=100.0, debt=100.0, ebit=10.0,
                                interest=10.0, tax_marginal=0.25, rating_for=p.rating_for)
    assert weak.rating == "CCC" and weak.spread > 0.05


# --- DCF ------------------------------------------------------------------------------------------------------


def _base(**kw) -> Base:
    d = dict(revenue=100.0, margin=0.2, tax_effective=0.25, tax_marginal=0.25, invested_capital=100.0, cash=0.0, debt=0.0,
             shares=1.0, riskfree=0.04)
    d.update(kw)
    return Base(**d)


def _lev(**kw) -> Levers:
    d = dict(growth_next=0.0, growth_2_5=0.0, target_margin=0.2, margin_year=5, sales_to_capital=1.0, wacc=0.1,
             wacc_terminal=0.1, growth_terminal=0.0, roic_terminal=0.1)
    d.update(kw)
    return Levers(**d)


def test_no_growth_is_a_perpetuity():
    # ohne Wachstum: Wert = NOPAT ÷ Kapitalkosten = 100 × 20 % × 75 % ÷ 10 % = 150
    out = calc.dcf(_base(), _lev())
    assert out.operating_value == pytest.approx(150.0, rel=1e-9)
    assert out.value_per_share == pytest.approx(150.0, rel=1e-9)


def test_growth_at_cost_of_capital_adds_no_value():
    # Wachstum mit Rendite auf neues Kapital = Kapitalkosten ist wertneutral (Damodarans Kernsatz). Reinvestition
    # eines Jahres finanziert das Wachstum des Folgejahres; das Wachstum im ersten Jahr stammt aus bereits getätigten
    # Investitionen – darum ist der neutrale Wert 150 × 1,03 (der Wert des schon finanzierten ersten Jahres).
    base = _base()
    s2c = 0.1 / (0.2 * 0.75)  # Umsatz/Kapital so, dass Rendite auf neues Kapital = 10 %
    v = calc.dcf(base, _lev(growth_next=0.03, growth_2_5=0.03, growth_terminal=0.03, sales_to_capital=s2c)).value_per_share
    assert v == pytest.approx(150.0 * 1.03, rel=1e-9)
    # doppeltes Wachstum zu denselben Bedingungen: weiterhin nur der Wert des ersten Jahres
    v2 = calc.dcf(base, _lev(growth_next=0.03, growth_2_5=0.03, growth_terminal=0.03, sales_to_capital=s2c, wacc=0.1)).value_per_share
    assert v2 == pytest.approx(v)
    # über den Kapitalkosten schafft Wachstum Wert, darunter vernichtet es Wert
    better = calc.dcf(base, _lev(growth_next=0.03, growth_2_5=0.03, growth_terminal=0.03, sales_to_capital=s2c * 2,
                                 roic_terminal=0.2)).value_per_share
    worse = calc.dcf(base, _lev(growth_next=0.03, growth_2_5=0.03, growth_terminal=0.03, sales_to_capital=s2c / 2,
                                roic_terminal=0.05)).value_per_share
    assert better > 150 * 1.03 > worse


def test_terminal_growth_capped_at_riskfree_and_errors():
    out = calc.dcf(_base(riskfree=0.03), _lev(growth_terminal=0.06))
    assert any("risikolosen Zins" in w for w in out.warnings)
    with pytest.raises(calc.DcfError):
        calc.dcf(_base(riskfree=0.2), _lev(growth_terminal=0.1, wacc_terminal=0.1))
    with pytest.raises(calc.DcfError):
        calc.dcf(_base(), _lev(sales_to_capital=0))


def test_margin_converges_and_cash_debt_bridge():
    out = calc.dcf(_base(margin=0.05, cash=30.0, debt=50.0, shares=2.0), _lev(target_margin=0.25, margin_year=5))
    assert out.rows[0].margin == pytest.approx(0.25 - 0.20 * 4 / 5)
    assert out.rows[4].margin == pytest.approx(0.25) and out.rows[9].margin == pytest.approx(0.25)
    assert out.equity_value == pytest.approx(out.operating_value - 50 + 30)
    assert out.value_per_share == pytest.approx(out.equity_value / 2)


def test_losses_build_up_tax_shield():
    out = calc.dcf(_base(margin=-0.1, nol=50.0), _lev(target_margin=0.2, margin_year=3))
    assert out.rows[0].ebit < 0 and out.rows[0].fcff == pytest.approx(out.rows[0].ebit)  # keine Steuer auf Verlust
    # erster Gewinnjahrgang: Verlustvorträge zuerst verbraucht → Steuersatz wirkt erst danach
    first_profit = next(r for r in out.rows if r.ebit > 0)
    assert first_profit.ebit_after_tax > first_profit.ebit * (1 - first_profit.tax_rate)


def test_failure_probability_blends_with_distress_value():
    base = _base()
    v0 = calc.dcf(base, _lev()).operating_value
    out = calc.dcf(base, _lev(failure_prob=0.4, failure_proceeds=0.5))
    assert out.operating_value_adj == pytest.approx(v0 * 0.6 + 0.4 * 0.5 * 100)


def test_reverse_dcf_round_trip():
    base = _base()
    lev = _lev(growth_next=0.08, growth_2_5=0.08, growth_terminal=0.03, sales_to_capital=1.5, roic_terminal=0.12)
    price = calc.dcf(base, lev).value_per_share
    assert calc.implied_growth(base, lev, price) == pytest.approx(0.08, abs=1e-6)
    m = calc.implied_margin(base, lev, price)
    assert m == pytest.approx(0.2, abs=1e-6)
    assert calc.implied_growth(base, lev, 1e9) is None  # unerreichbar


def test_simulation_reproducible_and_ordered():
    base, lev = _base(), _lev(growth_next=0.06, growth_2_5=0.05, growth_terminal=0.03, roic_terminal=0.12, sales_to_capital=1.5)
    a = calc.simulate(base, lev, price=150.0, runs=600, seed=3)
    b = calc.simulate(base, lev, price=150.0, runs=600, seed=3)
    assert a.p50 == b.p50 and a.runs == 600
    assert a.p10 < a.p25 < a.p50 < a.p75 < a.p90
    assert 0.0 <= (a.share_above_price or 0) <= 1.0
    assert sum(n for _, _, n in a.bins) <= 600


def test_lifecycle():
    assert calc.lifecycle(0.35, -0.1) == "jung"
    assert calc.lifecycle(0.02, -0.1) == "umbau"
    assert calc.lifecycle(0.25, 0.2) == "hochwachstum"
    assert calc.lifecycle(0.10, 0.2) == "reifes_wachstum"
    assert calc.lifecycle(0.03, 0.2) == "reif"
    assert calc.lifecycle(-0.05, 0.2) == "rueckgang"


# --- Parameter ------------------------------------------------------------------------------------------------


def test_params_mapping_and_financials():
    p = Params()
    assert p.industry_for("Technology", "Semiconductor Equipment & Materials").key == "Semiconductor Equip"
    assert p.industry_for("Technology", "Semiconductors").key == "Semiconductor"
    assert p.industry_for("Healthcare", "Drug Manufacturers—General").key == "Drugs (Pharmaceutical)"
    assert p.industry_for("Technology", "Something New").name.startswith("Technologie")
    assert p.industry_for(None, None).key == "Total Market"
    assert is_financial("Financial Services", "Banks—Regional") and is_financial("Industrials", "Insurance Brokers")
    assert not is_financial("Technology", "Software—Application")
    assert country_code("Germany", "XETRA") == "DE" and country_code(None, "PA") == "FR" and country_code("USA", "US") == "US"
    assert p.rating_for(30).rating == "AAA" and p.rating_for(0.1).rating == "D" and p.rating_for(None).rating == "BBB"


def test_apply_loaded_only_takes_plausible_values(tmp_path):
    data = {"source": "Test", "loaded_at": "2026-01-05T00:00:00+00:00", "erp": 0.051, "crp": {"DE": 0.001, "FR": 5.0},
            "industries": {"Semiconductor": {"beta_u": 1.5, "margin": 0.31, "sales_to_capital": 99}}}
    (tmp_path / "damodaran.json").write_text(json.dumps(data), encoding="utf-8")
    p = load_params(tmp_path)
    assert p.erp == pytest.approx(0.051) and "Test" in p.erp_source
    assert p.countries["DE"].crp == pytest.approx(0.001)
    assert p.countries["FR"].crp == Params().countries["FR"].crp  # 500 % ist unplausibel → bleibt
    semi = p.industry_for("Technology", "Semiconductors")
    assert semi.beta_u == pytest.approx(1.5) and semi.margin == pytest.approx(0.31)
    assert semi.sales_to_capital == Params().industry_for("Technology", "Semiconductors").sales_to_capital
    assert p.loaded_at == "2026-01-05T00:00:00+00:00"
    (tmp_path / "damodaran.json").write_text("kaputt", encoding="utf-8")
    assert load_params(tmp_path).erp == Params().erp


# --- Aktualisierung aus Damodarans Tabellen ----------------------------------------------------------------------

BETAS = """<html><table><tr><td>Industry Name</td><td>Number of firms</td><td>Beta</td><td>Unlevered beta</td>
<td>Unlevered beta corrected for cash</td></tr><tr><td>Semiconductor</td><td>68</td><td>1.47</td><td>1.40</td><td>1.45</td></tr>
<tr><td>Machinery</td><td>110</td><td>1.00</td><td>0.92</td><td>0.95</td></tr></table></html>"""
MARGINS = """<table><tr><th>Industry Name</th><th>Number of firms</th><th>Pre-tax Unadjusted Operating Margin</th>
<th>Pre-tax Lease &amp; R&amp;D adj Margin</th></tr><tr><td>Semiconductor</td><td>68</td><td>28.50%</td><td>33.10%</td></tr></table>"""
CAPEX = """<table><tr><td>Industry Name</td><td>Sales/ Invested Capital</td></tr><tr><td>Semiconductor</td><td>0.85</td></tr></table>"""
CRP = """<table><tr><td>Country</td><td>Moody's rating</td><td>Total Equity Risk Premium</td><td>Country Risk Premium</td></tr>
<tr><td>Germany</td><td>Aaa</td><td>4.60%</td><td>0.00%</td></tr><tr><td>Italy</td><td>Baa3</td><td>7.50%</td><td>2.90%</td></tr>
<tr><td>Atlantis</td><td>Aa1</td><td>5.00%</td><td>0.40%</td></tr></table>"""
ERP = """<table><tr><td>Year</td><td>Earnings Yield</td><td>Implied Premium (FCFE)</td></tr>
<tr><td>2024</td><td>4.5%</td><td>4.33%</td></tr><tr><td>2025</td><td>4.6%</td><td>4.41%</td></tr></table>"""


def test_damodaran_parsers():
    assert damodaran_data.parse_betas(BETAS) == {"Semiconductor": 1.45, "Machinery": 0.95}
    assert damodaran_data.parse_margins(MARGINS) == {"Semiconductor": pytest.approx(0.331)}
    assert damodaran_data.parse_sales_to_capital(CAPEX) == {"Semiconductor": 0.85}
    crp = damodaran_data.parse_crp(CRP)
    assert crp["DE"] == 0.0 and crp["IT"] == pytest.approx(0.029) and crp["Atlantis"] == pytest.approx(0.004)
    assert damodaran_data.parse_erp(ERP) == pytest.approx(0.0441)
    assert damodaran_data.parse_number("(1.5%)") == pytest.approx(-0.015)
    assert damodaran_data.parse_number("n/a") is None


def test_damodaran_update_with_mock_transport(tmp_path):
    pages = {"histimpl.html": ERP, "ctryprem.html": CRP, "Betas.html": BETAS, "margin.html": MARGINS, "capex.html": CAPEX}

    def handler(req: httpx.Request) -> httpx.Response:
        name = req.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, text=pages[name]) if name in pages else httpx.Response(404)

    ok, msg = asyncio.run(damodaran_data.update(tmp_path, httpx.MockTransport(handler)))
    assert ok and "4,41 %" in msg
    p = load_params(tmp_path)
    assert p.erp == pytest.approx(0.0441) and p.countries["IT"].crp == pytest.approx(0.029)
    assert p.industry_for("Technology", "Semiconductors").beta_u == pytest.approx(1.45)
    assert not damodaran_data.needs_update(tmp_path)

    def down(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline")

    ok2, msg2 = asyncio.run(damodaran_data.update(tmp_path / "neu", httpx.MockTransport(down)))
    assert not ok2 and "nicht erreichbar" in msg2


# --- Schnittstelle mit Demo-Daten ---------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os

    os.environ["PORTFOLIO_DIR"] = str(tmp_path_factory.mktemp("pf"))
    with TestClient(create_app(DemoProvider(now_fn=lambda: dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)))) as c:
        yield c


def test_api_value_and_levers(client):
    r = client.get("/api/intrinsic/QBIT.US").json()
    assert r["state"] == "ok" and r["valuePerShare"] > 0 and r["price"] > 0
    assert r["lifecycle"]["key"] in calc.LIFECYCLE
    keys = {lv["key"] for lv in r["levers"]}
    assert {"growthNext", "growth25", "targetMargin", "salesToCapital", "wacc", "growthTerminal"} <= {k.replace("_", "") for k in keys} or "growth_next" in keys
    assert len(r["years"]) == 10 and r["distribution"]["runs"] > 0
    assert r["reverse"]["growth"] is not None
    assert any("F&E" in a["label"] for a in r["adjustments"])
    # Hebel ändern: mehr Wachstum (bei Rendite über den Kapitalkosten) → höherer Wert
    up = client.post("/api/intrinsic/QBIT.US", json={"levers": {"growth_2_5": 0.2}, "simulate": False}).json()
    assert up["valuePerShare"] > r["valuePerShare"] and up["distribution"] is None
    # Endwachstum über dem risikolosen Zins wird begrenzt und gemeldet
    capped = client.post("/api/intrinsic/QBIT.US", json={"levers": {"growth_terminal": 0.09}, "simulate": False}).json()
    assert any("risikolosen Zins" in w for w in capped["warnings"])


def test_api_financials_excluded_and_unknown(client):
    r = client.get("/api/intrinsic/PNCL.US").json()
    assert r["state"] == "not_applicable" and "Banken" in r["message"]
    r = client.get("/api/intrinsic/GSPC.INDX").json()
    assert r["state"] == "no_data"


def test_api_params_status(client):
    r = client.get("/api/intrinsic/params").json()
    assert r["erp"] == pytest.approx(Params().erp) and r["loaded_at"] is None and "Richtwert" in r["erp_source"]
