@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$q=[char]34; $w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ $s=$w.CreateShortcut($d+'\TFT Stats.lnk'); $s.TargetPath=$env:WINDIR+'\System32\wscript.exe'; $s.Arguments=$q+'%~dp0TFT Stats.vbs'+$q; $s.WorkingDirectory='%~dp0'; $s.IconLocation=$env:WINDIR+'\System32\shell32.dll,13'; $s.Description='TFT Stats'; $s.Save() }"
if errorlevel 1 (echo Echec de la creation du raccourci.) else (echo Raccourci "TFT Stats" cree sur le Bureau et dans le menu Demarrer.)
pause
