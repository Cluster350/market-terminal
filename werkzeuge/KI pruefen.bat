@echo off
rem Prueft, ob LM Studio fuer den KI-Helfer des Terminals bereit ist (Server, Modell, JSON, Werkzeuge).
setlocal
cd /d "%~dp0.."
if not exist "backend\.venv\Scripts\python.exe" (
  echo  Bitte zuerst "Market Terminal starten" im Hauptordner einmal doppelklicken.
  pause
  exit /b 1
)
echo  LM Studio wird geprueft. Das kann beim ersten Mal ein bis zwei Minuten dauern ...
echo.
cd backend
.venv\Scripts\python -m scripts.verify_llm
echo.
pause
