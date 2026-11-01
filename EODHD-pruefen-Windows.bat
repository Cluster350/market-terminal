@echo off
rem Prueft mit dem eigenen EODHD-Schluessel (aus .env), ob alle Datenarten ankommen.
setlocal
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo  Bitte zuerst "Start-Windows.bat" einmal ausfuehren.
  pause
  exit /b 1
)
cd backend
.venv\Scripts\python -m scripts.verify_eodhd
echo.
pause
