' Lance TFT Stats en arriere-plan (sans ouvrir la fenetre), utilise au demarrage de Windows.
' Avec Electron (installer-electron.bat), ses fenetres remplacent Edge.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
electron = dossier & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  sh.Run """" & electron & """ . --fond", 1, False
Else
  sh.Run "node app.mjs --fond", 0, False
End If
