' Legt das Symbol "Market Terminal" (MT, orange auf schwarz) auf dem Desktop an und im Startmenue
' den Ordner "Market Terminal" mit "Market Terminal" und "Market Terminal beenden".
' Doppelklick: neu anlegen, z. B. nach dem Verschieben oder Aktualisieren des Ordners.
' Beim ersten Start ruft "Market Terminal starten" diese Datei mit /still auf (ohne Meldung).
Option Explicit
Dim sh, fso, root, still, desk, menu, icon, failed
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
still = (WScript.Arguments.Count > 0)
icon = root & "\Market Terminal.ico,0"

On Error Resume Next
desk = sh.SpecialFolders("Desktop")
menu = sh.SpecialFolders("Programs") & "\Market Terminal"
If Not fso.FolderExists(menu) Then fso.CreateFolder menu
Link desk & "\Market Terminal.lnk", root & "\Market Terminal starten.vbs", icon, "Market Terminal starten"
Link menu & "\Market Terminal.lnk", root & "\Market Terminal starten.vbs", icon, "Market Terminal starten"
Link menu & "\Market Terminal beenden.lnk", root & "\Market Terminal beenden.bat", _
  sh.ExpandEnvironmentStrings("%SystemRoot%\System32\shell32.dll") & ",27", "Market Terminal beenden"
' Merker: Beim naechsten Start nicht erneut anlegen (ein geloeschtes Symbol bleibt geloescht)
fso.CreateTextFile(root & "\.symbol-angelegt", True).Close
failed = (Err.Number <> 0)
On Error GoTo 0

If Not still Then
  If failed Then
    MsgBox "Das Symbol konnte nicht angelegt werden. Starten geht weiter mit ""Market Terminal starten"" im Ordner " & root, 48, "Market Terminal"
  Else
    MsgBox "Das Symbol ""Market Terminal"" liegt jetzt auf dem Desktop und im Startmenue (Ordner ""Market Terminal"").", 64, "Market Terminal"
  End If
End If

Sub Link(path, target, iconPath, desc)
  Dim l
  Set l = sh.CreateShortcut(path)
  If LCase(fso.GetExtensionName(target)) = "vbs" Then
    l.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
    l.Arguments = """" & target & """"
  Else
    l.TargetPath = target
    l.Arguments = ""
  End If
  l.WorkingDirectory = root
  l.IconLocation = iconPath
  l.Description = desc
  l.Save
End Sub
