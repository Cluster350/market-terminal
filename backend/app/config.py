"""Konfiguration aus Umgebungsvariablen (siehe .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """Liest eine .env-Datei im Projekt- oder Backend-Ordner, ohne Zusatzpaket."""
    here = Path(__file__).resolve().parent
    for candidate in (here.parent / ".env", here.parent.parent / ".env"):
        if not candidate.is_file():
            continue
        for raw in candidate.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # "demo" = synthetische Daten ohne Netz, "eodhd" = echte EODHD-API
    data_mode: str = field(default_factory=lambda: os.environ.get("DATA_MODE", "").strip().lower())
    eodhd_api_key: str = field(default_factory=lambda: os.environ.get("EODHD_API_KEY", "").strip())
    eodhd_base_url: str = field(
        default_factory=lambda: os.environ.get("EODHD_BASE_URL", "https://eodhd.com/api").rstrip("/")
    )
    daily_call_budget: int = field(default_factory=lambda: _int("EODHD_DAILY_BUDGET", 100_000))
    max_concurrency: int = field(default_factory=lambda: _int("EODHD_MAX_CONCURRENCY", 8))
    request_timeout: int = field(default_factory=lambda: _int("EODHD_TIMEOUT_SECONDS", 20))
    history_years: int = field(default_factory=lambda: _int("HISTORY_YEARS", 10))
    static_dir: str = field(
        default_factory=lambda: os.environ.get(
            "STATIC_DIR", str(Path(__file__).resolve().parents[2] / "frontend" / "dist")
        )
    )

    # KI-Helfer: "auto" nutzt LM Studio, wenn erreichbar, sonst im Demo-Modus die regelbasierte
    # Demo-KI; "lmstudio" nur LM Studio, "demo" immer Demo-KI, "off" aus
    llm_mode: str = field(default_factory=lambda: os.environ.get("LLM_MODE", "auto").strip().lower() or "auto")
    llm_base_url: str = field(
        default_factory=lambda: os.environ.get("LLM_BASE_URL", "http://localhost:1234/v1").strip().rstrip("/")
    )
    llm_model: str = field(default_factory=lambda: os.environ.get("LLM_MODEL", "").strip())
    llm_api_key: str = field(default_factory=lambda: os.environ.get("LLM_API_KEY", "").strip())
    llm_timeout: int = field(default_factory=lambda: _int("LLM_TIMEOUT_SECONDS", 180))
    llm_max_concurrency: int = field(default_factory=lambda: max(1, _int("LLM_MAX_CONCURRENCY", 1)))
    llm_max_steps: int = field(default_factory=lambda: max(1, _int("LLM_MAX_STEPS", 6)))

    # Depot: eine JSON-Datei je Datenquelle im Benutzerordner, damit sie neue Programmversionen
    # (neuer Ordner aus der ZIP-Datei) übersteht
    portfolio_dir: str = field(
        default_factory=lambda: os.environ.get("PORTFOLIO_DIR", "").strip() or str(Path.home() / ".market-terminal")
    )

    # Kursalarme: Prüfabstand in Sekunden (0 = automatisch: Demo 15 s, EODHD 60 s)
    alert_interval: int = field(default_factory=lambda: max(0, _int("ALERT_INTERVAL_SECONDS", 0)))

    @property
    def mode(self) -> str:
        """Ohne Key läuft das Terminal immer im Demo-Modus."""
        if self.data_mode in ("demo", "eodhd"):
            if self.data_mode == "eodhd" and not self.eodhd_api_key:
                return "demo"
            return self.data_mode
        return "eodhd" if self.eodhd_api_key else "demo"


settings = Settings()
