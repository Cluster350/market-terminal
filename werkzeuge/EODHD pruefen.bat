@echo off
rem Prueft mit dem eigenen EODHD-Schluessel (aus .env), ob alle Datenarten ankommen.
setlocal
cd /d "%~dp0.."
if not exist "backend\.venv\Scripts\python.exe" (
  echo  Bitte zuerst "Market Terminal starten" im Hauptordner einmal doppelklicken.
  pause
  exit /b 1
)
cd backend
.venv\Scripts\python -m scripts.verify_eodhd
echo.
pause
