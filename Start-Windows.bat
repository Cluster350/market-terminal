@echo off
rem Market Terminal starten (Windows): Doppelklick genuegt.
rem Beim ersten Start werden Python-Pakete und die Oberflaeche eingerichtet (einige Minuten).
setlocal
cd /d "%~dp0"
title Market Terminal

rem --- Python suchen (py-Starter von python.org oder python im PATH) ---
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo.
  echo  Python 3.11 oder neuer wurde nicht gefunden.
  echo  1. https://www.python.org/downloads/ oeffnen und Python installieren.
  echo  2. Im Installer unten "Add python.exe to PATH" anhaken.
  echo  3. Danach diese Datei erneut doppelklicken.
  echo.
  pause
  exit /b 1
)

rem --- Node.js pruefen (nur fuer den ersten Start noetig) ---
if not exist "frontend\dist\index.html" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  Node.js wurde nicht gefunden ^(wird einmalig zum Einrichten gebraucht^).
    echo  1. https://nodejs.org/ oeffnen und die LTS-Version installieren.
    echo  2. Danach diese Datei erneut doppelklicken.
    echo.
    pause
    exit /b 1
  )
)

rem --- Python-Umgebung einrichten ---
if not exist "backend\.venv\Scripts\python.exe" (
  echo  ^> Python-Umgebung einrichten ...
  %PY% -m venv backend\.venv || goto :fehler
  backend\.venv\Scripts\python -m pip install --disable-pip-version-check -q -r backend\requirements.txt || goto :fehler
)

rem --- Oberflaeche bauen ---
if not exist "frontend\dist\index.html" (
  echo  ^> Oberflaeche bauen ^(einmalig, dauert ein paar Minuten^) ...
  pushd frontend
  call npm install --no-audit --no-fund || (popd & goto :fehler)
  call npm run build || (popd & goto :fehler)
  popd
)

rem --- Einstellungen: .env anlegen (ohne Schluessel = Demo-Modus) ---
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo  Hinweis: Ohne EODHD-Schluessel laeuft das Terminal mit Demo-Daten.
  echo  Fuer echte Kurse: die Datei .env mit dem Editor oeffnen und hinter
  echo  EODHD_API_KEY= den Schluessel eintragen, speichern, Terminal neu starten.
)

echo.
echo  Market Terminal laeuft auf http://127.0.0.1:8000
echo  Der Browser oeffnet sich gleich. Zum Beenden dieses Fenster schliessen.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:8000"
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:fehler
echo.
echo  Beim Einrichten ist ein Fehler aufgetreten (siehe Meldungen oben).
echo  Internetverbindung pruefen und die Datei erneut starten.
pause
exit /b 1
