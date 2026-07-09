@echo off
chcp 65001 >nul
setlocal enableextensions
rem ============================================================
rem  ReDial generation worker launcher (T0-4)
rem  design: redial/docs/OPS_WORKER_RESILIENCE_2026-07.md section 2 (plan A)
rem
rem  Flow: preflight -> kill orphan :3000 -> start dev window (self-restart)
rem        -> wait until dev is LISTENING -> start worker window (self-restart).
rem  dev and worker each run in their own auto-restarting window.
rem  Register this file in Task Scheduler "At log on".
rem  Kills :3000 first on every run, so a double launch is safe.
rem  NOTE: keep this file ASCII-only. Multibyte text + chcp 65001 makes
rem  cmd.exe misparse batch lines. Japanese belongs in node output, not here.
rem ============================================================
cd /d "%~dp0.."
set "PORT=3000"

echo === ReDial worker launcher ===
echo repo: %CD%
echo.

where node >nul 2>&1 || (echo [ERROR] node not found on PATH. Enable nvm4w. & pause & exit /b 1)
where npm  >nul 2>&1 || (echo [ERROR] npm not found on PATH. & pause & exit /b 1)
if not exist "scripts\generation-worker.mjs" (echo [ERROR] scripts\generation-worker.mjs not found. Run from timeslip-dj root. & pause & exit /b 1)
if not exist ".env.local" (echo [ERROR] .env.local not found. & pause & exit /b 1)

echo [1/4] Killing orphan process on port %PORT% ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo     kill PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo [2/4] Starting dev server window (self-restart) ...
start "redial-dev" cmd /k "scripts\_run-dev.bat"

echo [3/4] Waiting for dev to LISTEN (up to 120s) ...
set /a _tries=0
:waitdev
netstat -ano | findstr :%PORT% | findstr LISTENING >nul 2>&1 && goto devready
set /a _tries+=1
if %_tries% geq 40 (echo     [WARN] dev not listening yet. Worker will start anyway; generation succeeds once dev recovers. Check the dev window. & goto startworker)
timeout /t 3 /nobreak >nul
goto waitdev
:devready
echo     dev OK (http://localhost:%PORT% is LISTENING)

:startworker
echo [4/4] Starting generation worker window (self-restart) ...
start "redial-worker" cmd /k "scripts\_run-worker.bat"

echo.
echo === Done ===
echo dev and worker now run in their own windows (auto-restart 5s on crash).
echo Health: https://redial.vercel.app/api/health should return workerAlive:true .
echo You can close this launcher window.
echo.
timeout /t 8 /nobreak >nul
endlocal
