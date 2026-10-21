@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "node_modules" call npm install --no-audit --no-fund
call npm run dev
pause
