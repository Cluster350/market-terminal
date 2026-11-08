@echo off
rem Installiert das Zusatzpaket fuer die Prognose mit Chronos-2 (PyTorch und Modell).
rem Ohne dieses Paket rechnet das Terminal mit der eingebauten Statistik.
setlocal
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo  Bitte zuerst "Start-Windows.bat" einmal ausfuehren.
  pause
  exit /b 1
)
echo.
echo  Prognose mit Chronos-2 installieren
echo  -----------------------------------
echo  Laedt PyTorch und Chronos-2 aus dem Internet (einmalig etwa 1-2 GB).
echo  Das kann je nach Verbindung einige Minuten dauern.
echo.
backend\.venv\Scripts\python -m pip install --disable-pip-version-check -r backend\requirements-forecast.txt || goto :fehler
echo.
echo  Modell herunterladen (ca. 0,5 GB) und kurz pruefen ...
cd backend
.venv\Scripts\python -m scripts.check_forecast || goto :fehler
echo.
echo  Fertig. Ab dem naechsten Start rechnet die Prognose mit Chronos-2.
echo  Laeuft das Terminal gerade: einmal Stop-Windows.bat und dann Start-Windows.bat.
echo.
pause
exit /b 0

:fehler
echo.
echo  Installation nicht abgeschlossen. Internetverbindung pruefen und erneut versuchen.
echo  Das Terminal rechnet bis dahin mit der eingebauten Statistik weiter.
echo.
pause
exit /b 1
