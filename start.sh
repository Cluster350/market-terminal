#!/usr/bin/env bash
# Startet das Market Terminal lokal: http://127.0.0.1:8000
# Voraussetzungen: Python 3.11+, Node.js 18+
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "› Python-Umgebung anlegen"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi

if [ ! -f frontend/dist/index.html ] || [ "${REBUILD:-0}" = "1" ]; then
  echo "› Frontend bauen"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi

if [ ! -f .env ]; then
  echo "› Keine .env gefunden – Demo-Modus mit synthetischen Daten."
  echo "  Für echte Daten: cp .env.example .env und EODHD_API_KEY eintragen."
fi

echo "› Terminal läuft auf http://127.0.0.1:${PORT:-8000}"
cd backend && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
