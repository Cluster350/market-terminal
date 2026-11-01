#!/usr/bin/env bash
# Startet das Market Terminal lokal: http://127.0.0.1:8000
# Voraussetzungen: Python 3.11+, Node.js 18+
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  echo "› Python-Umgebung anlegen"
  python3 -m venv backend/.venv
fi
# Nach einem Update fehlende Pakete nachinstallieren
if ! cmp -s backend/requirements.txt backend/.venv/requirements.installed; then
  echo "› Python-Pakete installieren"
  backend/.venv/bin/pip install -q -r backend/requirements.txt
  cp backend/requirements.txt backend/.venv/requirements.installed
fi

# Oberfläche bauen, wenn sie fehlt oder von einer älteren Version stammt
if [ ! -f frontend/dist/index.html ] || ! cmp -s frontend/public/BUILD-VERSION frontend/dist/BUILD-VERSION || [ "${REBUILD:-0}" = "1" ]; then
  echo "› Frontend bauen"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi

if [ ! -f .env ]; then
  echo "› Keine .env gefunden – Demo-Modus mit synthetischen Daten."
  echo "  Für echte Daten: cp .env.example .env und EODHD_API_KEY eintragen."
fi

echo "› Terminal läuft auf http://127.0.0.1:${PORT:-8000}"
cd backend && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
