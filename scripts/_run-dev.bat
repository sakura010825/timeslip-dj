@echo off
chcp 65001 >nul
rem ============================================================
rem  dev サーバー窓（T0-4・start-worker.bat から起動される）
rem  クラッシュしたら5秒後に自動再起動する。停止は窓で Ctrl+C。
rem  ANTHROPIC_API_KEY は継承させない（Next.js dev の env継承問題対策・
rem  孤児 dev で ffmpeg 0xC0000142 が出る既知問題を避ける）。
rem ============================================================
title redial-dev (auto-restart)
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
set "ANTHROPIC_API_KEY="

:loop
echo [%date% %time%] dev start >> "logs\dev.log"
echo ------------------------------------------------------------
echo [%date% %time%] dev サーバーを起動します（localhost:3000）
echo ------------------------------------------------------------
call npm run dev
echo [%date% %time%] dev exited code=%errorlevel% >> "logs\dev.log"
echo.
echo [%date% %time%] dev が終了しました（code=%errorlevel%）。5秒後に再起動します。
echo （完全に止めたい場合はこの窓を閉じるか Ctrl+C）
timeout /t 5 /nobreak >nul
goto loop
