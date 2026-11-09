"""„Damodaran (KI-Persona)“ zur Funktion DCF: Mappe, Demo-Regeln, Sprachmodell-Weg (simuliert), Zahlenprüfung."""

import dataclasses
import datetime as dt
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import valuation_coach as vc
from app.config import settings
from app.main import create_app
from app.providers.demo import DemoProvider

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 28, 15, 0, tzinfo=UTC)


class FakeLM:
    """Antwortet wie LM Studio – je nach Aufgabe (Schema-Name) mit fester Antwort; merkt sich die Anfragen."""

    def __init__(self, comment_text: str = "Wert je Aktie liegt unter dem Kurs."):
        self.comment_text = comment_text
        self.requests: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "qwen3-8b"}]})
        body = json.loads(request.content)
        self.requests.append(body)
        name = (body.get("response_format") or {}).get("json_schema", {}).get("name", "")
        if name == "einordnung":
            content = json.dumps({"abschnitte": [{"titel": t, "text": self.comment_text} for t in vc.SECTION_TITLES]})
        elif name == "story_hebel":
            content = json.dumps({"hebel": {
                "umsatzwachstum_naechstes_jahr_pct": 25, "umsatzwachstum_jahre_2_bis_5_pct": 300,  # 300 % → begrenzt
                "zielmarge_pct": 35, "zielmarge_erreicht_in_jahr": 7, "umsatz_je_kapital": 1.2, "ausfallwahrscheinlichkeit_pct": 5},
                "begruendung": "KI-Chips treiben das Wachstum.", "drei_p": "möglich und plausibel, wahrscheinlich nur mit Belegen"})
        else:
            content = "<think>…</think>Der Kurs unterstellt ein Wachstum von 77,7 % pro Jahr."
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


def client_with(fake=None, mode="lmstudio") -> TestClient:
    cfg = dataclasses.replace(settings, llm_base_url="http://lmstudio.test/v1", llm_mode=mode)
    transport = httpx.MockTransport(fake) if fake else None
    return TestClient(create_app(DemoProvider(now_fn=lambda: NOW), cfg, llm_transport=transport))


def test_dossier_and_prompt():
    with client_with(mode="demo") as c:
        svc = c.app.state.intrinsic
        res = c.portal.call(svc.value, "QBIT.US")
    d = vc.dossier(res)
    assert d["firma"] and d["wert_je_aktie"] == round(res.value_per_share, 2)
    assert d["kapitalkosten"] and d["story_hebel"] and d["rueckwaerts_dcf"]
    # Prozentwerte als Prozentzahlen, Beträge in Milliarden (kurz für lokale Modelle)
    assert all(abs(j["umsatz_mrd"]) < 1e5 for j in d["jahre"])
    assert d["wachstumsqualitaet"]["kapitalkosten_pct"] > 1
    sp = vc.system_prompt()
    assert "NICHT Aswath Damodaran" in sp and "<dossier>" in sp and "VALUATION PERSONA" in sp
    assert "Keine Kauf- oder Verkaufsempfehlung" in sp


def test_clamp_levers_only_story_levers():
    out = vc.clamp_levers({"growth_2_5": 3.0, "margin_year": 7.4, "wacc": 0.01, "target_margin": float("nan"), "x": 1})
    assert out == {"growth_2_5": 1.0, "margin_year": 7.0}


def test_demo_modes():
    with client_with(mode="demo") as c:
        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "kommentar"}).json()
        assert r["engine"] == "demo" and [s["title"] for s in r["sections"]] == vc.SECTION_TITLES
        assert "nicht Aswath Damodaran" in r["disclaimer"] and r["name"] == vc.COACH_NAME
        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "story", "text": "Wird Marktführer, Marge steigt durch Preismacht"}).json()
        base = {lv["key"]: lv["value"] for lv in c.get("/api/intrinsic/QBIT.US").json()["levers"]}
        sug = r["suggestion"]["levers"]
        assert sug["growth_2_5"] == pytest.approx(base["growth_2_5"] + 0.06)
        assert sug["target_margin"] == pytest.approx(base["target_margin"] + 0.05)
        assert r["suggestion"]["valuePerShare"] > 0  # vom Rechenkern nachgerechnet
        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "frage", "text": "Was muss man glauben?"}).json()
        assert "Kurs" in r["answer"] and "Demo" in r["answer"]
        assert c.post("/api/ai/valuation/QBIT.US", json={"mode": "story", "text": " "}).status_code == 400
        bank = c.post("/api/ai/valuation/PNCL.US", json={"mode": "kommentar"})
        assert bank.status_code == 400 and "Banken" in bank.json()["error"]["message"]


def test_llm_modes_with_number_check():
    fake = FakeLM()
    with client_with(fake) as c:
        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "kommentar"}).json()
        assert r["engine"] == "lmstudio" and len(r["sections"]) == len(vc.SECTION_TITLES)
        assert r["unverified"] == []
        # die Mappe steht im Gespräch, die Persona-Regeln in der Systemanweisung
        msgs = fake.requests[-1]["messages"]
        assert msgs[0]["role"] == "system" and "<dossier>" in msgs[1]["content"]

        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "story", "text": "KI-Chips für alle"}).json()
        sug = r["suggestion"]
        assert sug["levers"]["growth_next"] == pytest.approx(0.25) and sug["levers"]["growth_2_5"] == pytest.approx(1.0)
        assert sug["levers"]["margin_year"] == 7 and sug["levers"]["failure_prob"] == pytest.approx(0.05)
        assert sug["valuePerShare"] > 0 and "plausibel" in sug["threeP"]

        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "frage", "text": "Was ist im Kurs eingepreist?",
                                                      "history": [{"role": "user", "content": "Hallo"}]}).json()
        assert "<think>" not in r["answer"] and "77,7" in r["unverified"]  # erfundene Zahl wird markiert


def test_llm_offline_gives_clear_error():
    def down(request):
        raise httpx.ConnectError("refused", request=request)

    with client_with(down) as c:
        r = c.post("/api/ai/valuation/QBIT.US", json={"mode": "kommentar"})
        assert r.status_code == 503


def test_ask_demo_uses_intrinsic_tool_and_suggests_dcf():
    with client_with(mode="demo") as c:
        r = c.post("/api/ai/ask", json={"question": "Was ist der innere Wert von QBIT US?"}).json()
        assert "innerer Wert" in r["answer"] and r["unverified"] == []
        assert any(s["fn"] == "DCF" and s["ticker"] == "QBIT.US" for s in r["suggestions"])
        r = c.post("/api/ai/ask", json={"question": "Ist Pinnacle Bancorp unterbewertet?", "ticker": "PNCL.US"}).json()
        assert "Banken" in r["answer"]
