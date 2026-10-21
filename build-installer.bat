@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
if not exist "node_modules" call npm install --no-audit --no-fund
call npm run build:installer
if errorlevel 1 (
  echo [MineHarbor] Installer build failed.
  pause
  exit /b 1
)
echo [MineHarbor] Setup output: release\MineHarbor-Setup-1.0.0.exe
explorer "%~dp0release"
pause
