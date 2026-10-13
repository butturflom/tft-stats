' Lance TFT Stats sans fenetre noire. Pour fermer : onglet Reglages > Quitter l'application.
' Avec Electron (installer-electron.bat), l'appli s'ouvre dans ses propres fenetres ; sinon dans Edge.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
electron = dossier & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electron) Then
  ' Style 1 et non 0 : Windows appliquerait le style 0 (cache) a la premiere fenetre d'Electron
  sh.Run """" & electron & """ .", 1, False
Else
  sh.Run "node app.mjs", 0, False
End If
