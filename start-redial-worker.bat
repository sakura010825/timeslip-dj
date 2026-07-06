@echo off
REM ============================================================
REM  ReDial on-demand generation: dev server + worker launcher
REM  Double-click to start generation on this PC.
REM  Keep the opened windows open and keep the PC awake.
REM  Stop: close the opened windows.
REM ============================================================

cd /d "%~dp0"

echo.
echo  Starting ReDial dev server and generation worker...
echo  Keep the windows that open. Do NOT let the PC sleep.
echo.

REM 1) dev server (port 3000) in its own window
start "ReDial dev server - keep open" cmd /k "npm run dev"

REM Wait until the dev server actually responds before starting the worker
echo  Waiting for the dev server (http://localhost:3000)...
set /a tries=0
:waitloop
timeout /t 3 /nobreak >nul
set /a tries+=1
powershell -NoProfile -Command "try{[void](Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 3); exit 0}catch{exit 1}"
if not errorlevel 1 goto ready
if %tries% geq 40 goto giveup
goto waitloop

:ready
echo  Dev server is ready. Starting worker...
start "ReDial worker - keep open" cmd /k "node scripts/generation-worker.mjs"
echo.
echo  === Started ===
echo  Two windows are open: "dev server" and "worker".
echo  While they stay open and the PC is awake, friend
echo  requests are generated automatically within minutes.
echo  You can close THIS window.
goto end

:giveup
echo.
echo  [!] The dev server did not respond after ~2 minutes.
echo      Check the "dev server" window for errors and try again.

:end
echo.
pause
