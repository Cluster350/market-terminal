@echo off
rem Prueft, ob der KI-Helfer bereit ist: LM Studio (Server, Modell, JSON, Werkzeuge) oder Claude (LLM_MODE=claude).
setlocal
cd /d "%~dp0.."
if not exist "backend\.venv\Scripts\python.exe" (
  echo  Bitte zuerst "Market Terminal starten" im Hauptordner einmal doppelklicken.
  pause
  exit /b 1
)
echo  Die KI-Anbindung wird geprueft. Das kann beim ersten Mal ein bis zwei Minuten dauern ...
echo.
cd backend
.venv\Scripts\python -m scripts.verify_llm
echo.
pause
