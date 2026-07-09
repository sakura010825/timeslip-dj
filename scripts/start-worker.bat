@echo off
chcp 65001 >nul
setlocal enableextensions
rem ============================================================
rem  ReDial 生成ワーカー 常駐ランチャ（T0-4）
rem  docs/OPS_WORKER_RESILIENCE_2026-07.md §2 案A
rem
rem  流れ: 前提チェック → :3000 の孤児kill → dev窓(自己再起動) を起動 →
rem        dev の LISTENING を実測待ち → worker窓(自己再起動) を起動。
rem  dev と worker はそれぞれ別窓で常駐し、クラッシュしても各窓が自動再起動する。
rem  このランチャ窓は最後に閉じてOK（子窓は独立して残る）。
rem
rem  使い方:
rem   - 手動: このファイルをダブルクリック
rem   - 常駐: タスクスケジューラ「ログオン時」トリガーで本ファイルを指定
rem  ※ :3000 を必ず kill してから dev を上げるので、二重起動しても安全。
rem ============================================================
cd /d "%~dp0.."
set "PORT=3000"

echo === ReDial worker launcher ===
echo repo: %CD%
echo.

rem --- 前提チェック（失敗時は窓を残して原因を見せる） ---
where node >nul 2>&1 || (echo [ERROR] node が PATH にありません。nvm4w を有効化してください。& pause & exit /b 1)
where npm  >nul 2>&1 || (echo [ERROR] npm が PATH にありません。& pause & exit /b 1)
if not exist "scripts\generation-worker.mjs" (echo [ERROR] scripts\generation-worker.mjs が見つかりません。timeslip-dj 直下から起動してください。& pause & exit /b 1)
if not exist ".env.local" (echo [ERROR] .env.local が見つかりません。& pause & exit /b 1)

echo [1/4] ポート %PORT% の孤児プロセスを終了...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo     kill PID %%a
  taskkill /F /PID %%a >nul 2>&1
)

echo [2/4] dev サーバー窓を起動（自己再起動・別窓）...
start "redial-dev" cmd /k "scripts\_run-dev.bat"

echo [3/4] dev の LISTENING を待機（最大120秒）...
set /a _tries=0
:waitdev
netstat -ano | findstr :%PORT% | findstr LISTENING >nul 2>&1 && goto devready
set /a _tries+=1
if %_tries% geq 40 (
  echo     [WARN] dev がまだ LISTENING になりません。worker は起動しますが、
  echo            生成成功は dev 復帰後になります。dev 窓のエラーを確認してください。
  goto startworker
)
timeout /t 3 /nobreak >nul
goto waitdev
:devready
echo     dev OK（http://localhost:%PORT% が LISTENING）

:startworker
echo [4/4] 生成ワーカー窓を起動（自己再起動・別窓）...
start "redial-worker" cmd /k "scripts\_run-worker.bat"

echo.
echo === 起動完了 ===
echo dev と worker はそれぞれ別窓で常駐します（クラッシュ時は5秒後に自動再起動）。
echo 監視: https://redial.vercel.app/api/health が {"workerAlive":true} を返せば成功。
echo このランチャ窓は閉じてOKです。
echo.
timeout /t 8 /nobreak >nul
endlocal
