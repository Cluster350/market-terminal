@echo off
rem Installiert das Zusatzpaket fuer das Notebook im Terminal (Funktion NB): JupyterLab, pandas, Diagramme.
setlocal
cd /d "%~dp0.."
if not exist "backend\.venv\Scripts\python.exe" (
  echo  Bitte zuerst "Market Terminal starten" im Hauptordner einmal doppelklicken.
  pause
  exit /b 1
)
echo.
echo  Notebook (Jupyter) installieren
echo  -------------------------------
echo  Laedt JupyterLab, pandas und matplotlib aus dem Internet (einmalig etwa 300 MB).
echo  Das kann je nach Verbindung einige Minuten dauern.
echo.
backend\.venv\Scripts\python -m pip install --disable-pip-version-check -r backend\requirements-notebook.txt || goto :fehler
echo.
echo  Fertig. Im Terminal den Befehl NB eingeben und "Notebook starten" klicken.
echo  Laeuft das Terminal gerade: einmal "Market Terminal beenden" und dann wieder starten.
echo.
pause
exit /b 0

:fehler
echo.
echo  Installation nicht abgeschlossen. Internetverbindung pruefen und erneut versuchen.
echo.
pause
exit /b 1
