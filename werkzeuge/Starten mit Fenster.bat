@echo off
rem Market Terminal mit sichtbarem Fenster starten (zeigt alle Meldungen, gut zur Fehlersuche).
rem Normalerweise startet man ueber "Market Terminal starten" im Hauptordner bzw. das Desktop-Symbol.
rem Beim ersten Start werden Python-Pakete und die Oberflaeche eingerichtet (einige Minuten).
setlocal
cd /d "%~dp0.."
title Market Terminal
rem Im Hintergrund gestartet ("Market Terminal starten.vbs"): nicht auf Tastendruck warten,
rem sondern bei Fehlern das Protokoll im Editor zeigen
set "PAUSE=pause"
if defined MT_HIDDEN set "PAUSE=rem"

rem --- Python suchen: py-Starter, python im PATH und uebliche Installationsordner ---
set "PY="
for %%C in ("py -3.13" "py -3.12" "py -3.11" "py -3.14" "py -3" "py" "python" "python3") do (
  if not defined PY (
    %%~C -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=%%~C"
  )
)
if not defined PY (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*" "%USERPROFILE%\anaconda3" "%USERPROFILE%\miniconda3" "%ProgramData%\anaconda3" "%ProgramData%\miniconda3" "%LOCALAPPDATA%\anaconda3") do (
    if not defined PY if exist "%%~D\python.exe" (
      "%%~D\python.exe" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set PY="%%~D\python.exe"
    )
  )
)
if not defined PY (
  echo.
  echo  Python 3.11 oder neuer wurde nicht gefunden. Gefunden wurde:
  py --version 2>nul
  python --version 2>nul
  where python 2>nul
  echo.
  echo  Steht oben eine Version unter 3.11 oder gar nichts:
  echo  1. https://www.python.org/downloads/ oeffnen und die aktuelle Version installieren.
  echo  2. Im Installer unten "Add python.exe to PATH" anhaken.
  echo  3. Danach diese Datei erneut doppelklicken.
  echo  Steht oben 3.11 oder neuer, bitte ein Foto dieses Fensters schicken.
  echo.
  %PAUSE%
  exit /b 1
)
echo  ^> Python gefunden: %PY%

rem --- Oberflaeche neu bauen? (fehlt oder stammt von einer aelteren Version) ---
set "NEEDBUILD="
if not exist "frontend\dist\index.html" set "NEEDBUILD=1"
if not defined NEEDBUILD (
  fc /b "frontend\public\BUILD-VERSION" "frontend\dist\BUILD-VERSION" >nul 2>nul
  if errorlevel 1 set "NEEDBUILD=1"
)

rem --- Node.js pruefen (nur zum Bauen der Oberflaeche noetig) ---
if defined NEEDBUILD (
  where npm >nul 2>nul
  if errorlevel 1 (
    if exist "frontend\dist\index.html" (
      echo  Hinweis: Neue Oberflaeche gefunden, aber Node.js fehlt. Es startet die bisherige Oberflaeche.
      echo  Fuer die neue Version Node.js LTS von https://nodejs.org/ installieren und erneut starten.
      set "NEEDBUILD="
    ) else (
      echo.
      echo  Node.js wurde nicht gefunden ^(wird einmalig zum Einrichten gebraucht^).
      echo  1. https://nodejs.org/ oeffnen und die LTS-Version installieren.
      echo  2. Danach diese Datei erneut doppelklicken.
      echo.
      %PAUSE%
      exit /b 1
    )
  )
)

rem --- Python-Umgebung einrichten (und nach einem Update die Pakete nachziehen) ---
set "NEEDPIP="
if not exist "backend\.venv\Scripts\python.exe" (
  echo  ^> Python-Umgebung einrichten ...
  %PY% -m venv backend\.venv || goto :fehler
  set "NEEDPIP=1"
)
fc /b "backend\requirements.txt" "backend\.venv\requirements.installed" >nul 2>nul
if errorlevel 1 set "NEEDPIP=1"
if defined NEEDPIP (
  echo  ^> Python-Pakete installieren ...
  backend\.venv\Scripts\python -m pip install --disable-pip-version-check -q -r backend\requirements.txt || goto :fehler
  copy /y "backend\requirements.txt" "backend\.venv\requirements.installed" >nul
)

rem --- Oberflaeche bauen ---
if defined NEEDBUILD (
  echo  ^> Oberflaeche bauen ^(dauert ein paar Minuten^) ...
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
echo  Das Terminal-Fenster oeffnet sich gleich. Zum Beenden dieses Fenster schliessen.
echo  KI-Helfer: LM Studio starten ^(Developer, Start Server^), dann nutzt das Terminal es automatisch.
echo.
rem Oberflaeche oeffnen, sobald der Server antwortet (eigenes App-Fenster, sonst Standardbrowser)
start "" wscript //nologo "%~dp0Terminal oeffnen.vbs"
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
if errorlevel 1 if defined MT_HIDDEN start "" notepad "%~dp0..\market-terminal.log"
goto :eof

:fehler
echo.
echo  Beim Einrichten ist ein Fehler aufgetreten (siehe Meldungen oben).
echo  Internetverbindung pruefen und die Datei erneut starten.
if defined MT_HIDDEN start "" notepad "%~dp0..\market-terminal.log"
%PAUSE%
exit /b 1
