@echo off
chcp 65001 >nul
rem ============================================================
rem  dev server window (T0-4). Started by start-worker.bat.
rem  Auto-restarts 5s after a crash. Ctrl+C (or close window) to stop.
rem  Do NOT inherit ANTHROPIC_API_KEY (Next.js dev env-inheritance issue;
rem  an orphan dev makes ffmpeg fail with 0xC0000142).
rem  Keep this file ASCII-only (multibyte + chcp 65001 misparses in cmd).
rem ============================================================
title redial-dev (auto-restart)
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
set "ANTHROPIC_API_KEY="

:loop
echo [%date% %time%] dev start >> "logs\dev.log"
echo ------------------------------------------------------------
echo [%date% %time%] Starting dev server (localhost:3000)
echo ------------------------------------------------------------
call npm run dev
echo [%date% %time%] dev exited code=%errorlevel% >> "logs\dev.log"
echo.
echo [%date% %time%] dev exited (code=%errorlevel%). Restarting in 5s. Close window or Ctrl+C to stop.
timeout /t 5 /nobreak >nul
goto loop
