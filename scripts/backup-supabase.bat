@echo off
chcp 65001 >nul
rem ============================================================
rem  Weekly Supabase logical backup (T0-4d)
rem  design: redial/docs/OPS_WORKER_RESILIENCE_2026-07.md section 4
rem  Most irreplaceable data: generations.episode jsonb (user runs, not
rem  regenerable). Exports each table to JSON via supabase-js.
rem  Output: C:\Users\user\dev\redial-backups\redial-backup-<stamp>\
rem  Runs weekly via Task Scheduler task "ReDial backup weekly".
rem  Double-click to run a manual backup any time.
rem  Keep this file ASCII-only (multibyte + chcp 65001 misparses in cmd).
rem ============================================================
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
echo [%date% %time%] backup start >> "logs\backup.log"
node scripts\backup-supabase.mjs --out C:\Users\user\dev\redial-backups >> "logs\backup.log" 2>&1
echo [%date% %time%] backup exit=%errorlevel% >> "logs\backup.log"
