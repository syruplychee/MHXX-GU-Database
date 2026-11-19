@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24+ is required. https://nodejs.org/
  pause
  exit /b 1
)
start "" /b cmd /c "timeout /t 2 >nul & start "" http://127.0.0.1:8787/"
node server\server.js
pause
