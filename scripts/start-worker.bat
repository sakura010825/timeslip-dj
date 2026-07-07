@echo off
rem ============================================================
rem  ReDial 生成ワーカー起動（T0-4・docs/OPS_WORKER_RESILIENCE_2026-07.md §2 案A）
rem
rem  ワーカーは timeslip-dj の dev サーバー(:3000)を必要とする。孤児 dev が残ると
rem  ffmpeg が 0xC0000142 で全滅する既知問題があるため、必ず「:3000をkill → dev起動 →
rem  待機 → worker起動」の順で回す。
rem
rem  使い方: このファイルをダブルクリック、またはタスクスケジューラで「ログオン時」に実行。
rem  ※ timeslip-dj のフォルダに置いて、そこから起動すること（相対パス前提）。
rem ============================================================
setlocal
cd /d "%~dp0.."

echo [1/3] ポート3000の孤児プロセスを終了...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo [2/3] dev サーバーを起動（別ウィンドウ・ANTHROPIC_API_KEYは継承させない）...
rem  env継承問題対策: 子プロセスで ANTHROPIC_API_KEY を空にしてから npm run dev
start "redial-dev" cmd /c "set ANTHROPIC_API_KEY=&& npm run dev"

echo     dev の起動を待機（25秒）...
timeout /t 25 /nobreak >nul

echo [3/3] 生成ワーカーを起動...
node scripts\generation-worker.mjs

endlocal
