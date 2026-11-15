@echo off
setlocal
title Reset demonstration data
cd /d "%~dp0"

echo ============================================================
echo  WARNING: This permanently deletes ALL application data and
echo  regenerates the SYNTHETIC demonstration dataset.
echo  Never run this against a database containing real records.
echo ============================================================
echo.
set /p CONFIRM=Type RESET (in capitals) to continue, or press Enter to cancel: 
if not "%CONFIRM%"=="RESET" (
  echo Cancelled. No data was changed.
  pause & exit /b 0
)

call npx drizzle-kit push
if errorlevel 1 ( echo [ERROR] Schema update failed. & pause & exit /b 1 )
call npx tsx scripts/seed.ts --reset
if errorlevel 1 ( echo [ERROR] Reset failed. See messages above. & pause & exit /b 1 )
echo.
echo Demonstration data regenerated. Demo accounts are listed in README.md.
pause
