' Market Terminal starten (Doppelklick, oder das Desktop-Symbol "Market Terminal").
' - Laeuft das Terminal schon, oeffnet sich nur sein Fenster.
' - Beim ersten Start entsteht das Desktop-Symbol (MT, orange auf schwarz) und ein Eintrag im Startmenue.
' - Beim ersten Start und nach einem Update (Einrichtung noetig) erscheint das normale Fenster,
'   damit Fortschritt und eventuelle Fehler sichtbar sind.
' - Sonst laeuft alles unsichtbar; das Protokoll steht in market-terminal.log.
' Beenden: "Market Terminal beenden" doppelklicken (auch im Startmenue).
Option Explicit
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

Dim bat, tools
tools = dir & "\werkzeuge"
bat = tools & "\Starten mit Fenster.bat"

If Running() Then
  sh.Run "wscript //nologo """ & tools & "\Terminal oeffnen.vbs""", 1, False
  WScript.Quit
End If

' Erster Start: Desktop-Symbol und Startmenue-Eintrag anlegen (nur einmal; ein geloeschtes Symbol bleibt weg)
If Not fso.FileExists(dir & "\.symbol-angelegt") Then
  sh.Run "wscript //nologo """ & tools & "\Desktop-Symbol anlegen.vbs"" /still", 0, False
End If

If NeedsSetup() Then
  sh.Run """" & bat & """", 1, False
Else
  sh.Environment("Process")("MT_HIDDEN") = "1"
  sh.Run "cmd /c """"" & bat & """ > """ & dir & "\market-terminal.log"" 2>&1""", 0, False
End If

Function Running()
  Dim http
  Running = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  ' Adresse ohne Netzabruf: /api/status fragt im EODHD-Modus jedes Mal EODHD (kann laenger als 1 s dauern)
  http.Open "GET", "http://127.0.0.1:8000/api/realtime/status", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then Running = True
  End If
  On Error GoTo 0
End Function

Function ReadFile(p)
  ReadFile = ""
  If fso.FileExists(p) Then
    Dim f
    Set f = fso.OpenTextFile(p, 1)
    If Not f.AtEndOfStream Then ReadFile = f.ReadAll
    f.Close
  End If
End Function

Function NeedsSetup()
  NeedsSetup = True
  If Not fso.FileExists(dir & "\backend\.venv\Scripts\python.exe") Then Exit Function
  If Not fso.FileExists(dir & "\frontend\dist\index.html") Then Exit Function
  If Not fso.FileExists(dir & "\.env") Then Exit Function
  If ReadFile(dir & "\frontend\public\BUILD-VERSION") <> ReadFile(dir & "\frontend\dist\BUILD-VERSION") Then Exit Function
  If ReadFile(dir & "\backend\requirements.txt") <> ReadFile(dir & "\backend\.venv\requirements.installed") Then Exit Function
  NeedsSetup = False
End Function
