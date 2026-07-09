@echo off
chcp 65001 >nul
rem ============================================================
rem  生成ワーカー窓（T0-4・start-worker.bat から起動される）
rem  Supabase generations の queued を拾って無人生成する常駐プロセス。
rem  クラッシュ/例外死したら5秒後に自動再起動する。停止は窓で Ctrl+C。
rem  ワーカーは .env.local を自己ロードする（--env-file 不要）。
rem ============================================================
title redial-worker (auto-restart)
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"

:loop
echo [%date% %time%] worker start >> "logs\worker.log"
echo ------------------------------------------------------------
echo [%date% %time%] 生成ワーカーを起動します
echo ------------------------------------------------------------
node scripts\generation-worker.mjs
echo [%date% %time%] worker exited code=%errorlevel% >> "logs\worker.log"
echo.
echo [%date% %time%] worker が終了しました（code=%errorlevel%）。5秒後に再起動します。
echo （完全に止めたい場合はこの窓を閉じるか Ctrl+C）
timeout /t 5 /nobreak >nul
goto loop
