' Oeffnet die Oberflaeche des Market Terminals, sobald der Server antwortet (bis zu 2 Minuten):
' als eigenes App-Fenster ohne Adressleiste mit MT-Symbol in der Taskleiste, wenn der Standardbrowser
' Microsoft Edge oder Google Chrome ist; sonst als normaler Tab im Standardbrowser.
' Lieber immer ein normaler Tab: in der Datei .env die Zeile MT_APP_FENSTER=0 eintragen.
Option Explicit
Const URL = "http://127.0.0.1:8000"
Dim sh, fso, root, i, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

For i = 1 To 120
  If Running() Then Exit For
  WScript.Sleep 1000
Next

exe = ""
If AppWindow() Then exe = Browser()
If exe <> "" Then
  sh.Run """" & exe & """ --app=" & URL, 1, False
Else
  sh.Run URL, 1, False
End If

Function Running()
  Dim http
  Running = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  ' Adresse ohne Netzabruf: /api/status fragt im EODHD-Modus jedes Mal EODHD (kann laenger als 1 s dauern)
  http.Open "GET", URL & "/api/realtime/status", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then Running = True
  End If
  On Error GoTo 0
End Function

' Steht in .env "MT_APP_FENSTER=0", dann normaler Browser statt App-Fenster
Function AppWindow()
  Dim f, line
  AppWindow = True
  If Not fso.FileExists(root & "\.env") Then Exit Function
  Set f = fso.OpenTextFile(root & "\.env", 1)
  Do While Not f.AtEndOfStream
    line = Replace(Trim(f.ReadLine), " ", "")
    If LCase(line) = "mt_app_fenster=0" Then AppWindow = False
  Loop
  f.Close
End Function

' App-Fenster im Standardbrowser, wenn das Edge oder Chrome ist (dort liegen Watchlist und Layouts);
' bei anderen Standardbrowsern leer -> normaler Tab. Ohne erkennbaren Standardbrowser: Edge.
Function Browser()
  Dim progId, names, n
  progId = ""
  On Error Resume Next
  progId = sh.RegRead("HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice\ProgId")
  On Error GoTo 0
  progId = LCase(progId)
  If InStr(progId, "chrome") > 0 Then
    names = Array("chrome.exe")
  ElseIf InStr(progId, "msedge") > 0 Or progId = "" Then
    names = Array("msedge.exe")
  Else
    Browser = ""
    Exit Function
  End If
  Browser = ""
  For Each n In names
    Browser = Find(n)
    If Browser <> "" Then Exit Function
  Next
End Function

' Programmpfad aus der Registrierung (App Paths), sonst uebliche Installationsordner
Function Find(exe)
  Dim k, p, paths
  Find = ""
  For Each k In Array("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & exe & "\", _
                      "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & exe & "\")
    p = ""
    On Error Resume Next
    p = sh.RegRead(k)
    On Error GoTo 0
    p = Replace(p, Chr(34), "")
    If p <> "" Then
      If fso.FileExists(p) Then
        Find = p
        Exit Function
      End If
    End If
  Next
  If exe = "msedge.exe" Then
    paths = Array("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")
  Else
    paths = Array("%ProgramFiles%\Google\Chrome\Application\chrome.exe", "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe", _
                  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
  End If
  For Each p In paths
    p = sh.ExpandEnvironmentStrings(p)
    If fso.FileExists(p) Then
      Find = p
      Exit Function
    End If
  Next
End Function
