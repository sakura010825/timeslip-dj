@echo off
chcp 65001 >nul
rem ============================================================
rem  generation worker window (T0-4). Started by start-worker.bat.
rem  Auto-restarts 5s after a crash. Ctrl+C (or close window) to stop.
rem  The worker self-loads .env.local (no --env-file needed).
rem  Keep this file ASCII-only (multibyte + chcp 65001 misparses in cmd).
rem  chcp 65001 makes the worker's Japanese node output render correctly.
rem ============================================================
title redial-worker (auto-restart)
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

:loop
echo [%date% %time%] worker start >> "logs\worker.log"
echo ------------------------------------------------------------
echo [%date% %time%] Starting generation worker
echo ------------------------------------------------------------
node scripts\generation-worker.mjs
echo [%date% %time%] worker exited code=%errorlevel% >> "logs\worker.log"
echo.
echo [%date% %time%] worker exited (code=%errorlevel%). Restarting in 5s. Close window or Ctrl+C to stop.
timeout /t 5 /nobreak >nul
goto loop
