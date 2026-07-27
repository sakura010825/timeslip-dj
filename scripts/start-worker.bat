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

echo [1/4] Cleaning up the previous run (windows, workers, port %PORT%) ...
rem  Kill leftover launcher windows first, THEN their node processes.
rem  Order matters: the windows auto-restart their child after 5s, so killing the
rem  node process first just makes the window spawn a new one.
rem
rem  Why this exists (measured 2026-07-27): without it, every run of this file ADDS
rem  a worker instead of replacing one. Three generation-worker processes were alive
rem  at once (started 07-22, 07-24, 07-27), two of them running old code. They all
rem  upsert the SAME worker_heartbeat row, so a stuck worker is masked by the others
rem  and the health signal silently becomes meaningless. Duplicate workers also each
rem  claim their own job, so several 20-30min generations can run on one PC at once.
rem  Match the cmd HOSTS by command line, not by window title. Measured 2026-07-27:
rem  taskkill /FI "WINDOWTITLE eq ..." matched nothing for these console windows, so
rem  only the node children died - and each surviving :loop respawned a new child 5s
rem  later. Killing the child alone makes the problem WORSE, not better.
rem  /T takes the child node down with the host in one shot.
rem
rem  NOTE: Name='cmd.exe' AND ProcessId -ne $PID are BOTH required. The command line of
rem  the powershell below literally contains the string "_run-worker", so a plain
rem  -like match finds ITSELF and dies with "The process cannot terminate itself"
rem  before reaching the real targets (hit for real on 2026-07-27).
powershell -NoProfile -Command "$me=$PID; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.ProcessId -ne $me -and ($_.CommandLine -like '*_run-worker*' -or $_.CommandLine -like '*_run-dev*') } | ForEach-Object { taskkill /F /T /PID $_.ProcessId }" >nul 2>&1
rem  Then sweep any generation-worker started outside the launcher (by hand, etc).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*generation-worker*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
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
