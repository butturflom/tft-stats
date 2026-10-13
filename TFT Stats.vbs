' Lance TFT Stats sans fenetre noire. Pour fermer : onglet Reglages > Quitter l'application.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node app.mjs", 0, False
