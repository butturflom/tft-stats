@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Le dossier de l'appli passe par la variable TFT_DIR et non dans le texte de la commande PowerShell :
rem une apostrophe dans son nom (C:\Users\O'Brien\...) casserait sinon la commande.
set "TFT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; $w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ $s=$w.CreateShortcut($d+'\TFT Stats.lnk'); $s.TargetPath=$env:WINDIR+'\System32\wscript.exe'; $s.Arguments=$q+$env:TFT_DIR+'TFT Stats.vbs'+$q; $s.WorkingDirectory=$env:TFT_DIR; $s.IconLocation=$env:WINDIR+'\System32\shell32.dll,13'; $s.Description='TFT Stats'; $s.Save() }"
if errorlevel 1 (echo Echec de la creation du raccourci.) else (echo Raccourci "TFT Stats" cree sur le Bureau et dans le menu Demarrer.)
pause
