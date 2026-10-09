@echo off
title VaultAccess
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

echo Starting VaultAccess at http://localhost:3000
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
