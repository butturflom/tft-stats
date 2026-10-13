@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Installation d'Electron pour TFT Stats : environ 160 Mo a telecharger, une seule fois.
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto echec
call npx --no install-electron
if errorlevel 1 goto echec
echo.
echo Electron est installe : "TFT Stats" s'ouvrira desormais dans ses propres fenetres.
echo Si l'application est deja ouverte, elle proposera de fermer l'ancienne au prochain lancement.
pause
exit /b 0
:echec
echo.
echo Echec de l'installation. Verifie que Node.js est installe et que la connexion internet marche, puis relance ce fichier.
pause
exit /b 1
