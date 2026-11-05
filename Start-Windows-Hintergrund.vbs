' Market Terminal ohne schwarzes Fenster starten (Doppelklick).
' - Laeuft das Terminal schon, oeffnet sich nur der Browser.
' - Beim ersten Start und nach einem Update (Einrichtung noetig) erscheint das normale Fenster,
'   damit Fortschritt und eventuelle Fehler sichtbar sind.
' - Sonst laeuft alles unsichtbar; das Protokoll steht in market-terminal.log.
' Beenden: Stop-Windows.bat doppelklicken.
Option Explicit
Dim sh, fso, dir
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

If Running() Then
  sh.Run "http://127.0.0.1:8000", 1, False
  WScript.Quit
End If

If NeedsSetup() Then
  sh.Run """" & dir & "\Start-Windows.bat""", 1, False
Else
  sh.Environment("Process")("MT_HIDDEN") = "1"
  sh.Run "cmd /c """"" & dir & "\Start-Windows.bat"" > """ & dir & "\market-terminal.log"" 2>&1""", 0, False
End If

Function Running()
  Dim http
  Running = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", "http://127.0.0.1:8000/api/status", False
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
