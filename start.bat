@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=

where node >nul 2>nul
if errorlevel 1 (
  echo [MineHarbor] Node.js 20+ is required. https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [MineHarbor] Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [MineHarbor] npm install failed.
    pause
    exit /b 1
  )
)

if not exist "out\main\index.js" (
  echo [MineHarbor] Building...
  call npm run build
  if errorlevel 1 (
    echo [MineHarbor] Build failed.
    pause
    exit /b 1
  )
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
endlocal
