@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TFT Stats
echo TFT Stats tourne tant que cette fenetre reste ouverte.
node app.mjs
pause
