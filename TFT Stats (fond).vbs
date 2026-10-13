' Lance TFT Stats en arriere-plan (sans ouvrir la fenetre), utilise au demarrage de Windows.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node app.mjs --fond", 0, False
