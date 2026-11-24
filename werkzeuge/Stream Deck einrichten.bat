@echo off
rem Installiert das Stream-Deck-Plugin "Market Terminal" (Live-Tasten und Fernsteuerung, nur lesend).
setlocal
cd /d "%~dp0.."
set "PAKET=streamdeck\dist\Market Terminal.streamDeckPlugin"
if not exist "%PAKET%" (
  echo  Das Plugin-Paket fehlt: %PAKET%
  pause
  exit /b 1
)
echo  Stream-Deck-Plugin fuer das Market Terminal
echo  -------------------------------------------
echo  Voraussetzung: die Stream-Deck-Software von Elgato (Version 6.5 oder neuer) ist installiert.
echo.
echo  Gleich oeffnet sich die Stream-Deck-Software und fragt, ob das Plugin installiert werden soll.
echo  Danach in der Stream-Deck-Software rechts die Gruppe "Market Terminal" suchen und die Aktion
echo  "Terminal-Taste" auf jede der 15 Tasten ziehen - jede Taste belegt sich nach ihrer Position selbst.
echo.
start "" "%PAKET%"
echo  Fertig. Das Terminal muss laufen, damit die Tasten Daten zeigen.
pause
