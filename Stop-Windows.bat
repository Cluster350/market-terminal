@echo off
rem Market Terminal beenden - auch wenn es unsichtbar im Hintergrund laeuft
rem (gestartet mit Start-Windows-Hintergrund.vbs).
setlocal
set "FOUND="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":8000 .*LISTENING"') do (
  taskkill /PID %%P /T /F >nul 2>nul && set "FOUND=1"
)
echo.
if defined FOUND (
  echo  Market Terminal wurde beendet. Kursalarme werden jetzt nicht mehr geprueft.
) else (
  echo  Market Terminal lief nicht.
)
timeout /t 4 >nul
