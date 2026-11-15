@echo off
setlocal EnableDelayedExpansion
title AI Student Risk and Recommendation System
cd /d "%~dp0"

echo ============================================================
echo  AI Student Digital Learning Risk ^& Adaptive Recommendation
echo ============================================================
echo.

REM 1. Runtime checks
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 20 LTS or newer from https://nodejs.org
  echo         then open a new terminal and run this file again.
  pause & exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. It is installed with Node.js. Reinstall Node.js.
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node.js %%v
for /f "tokens=*" %%v in ('npm -v') do echo [OK] npm %%v

REM 2. Configuration
if not exist ".env" (
  if exist ".env.example" copy /y ".env.example" ".env" >nul
  echo [INFO] Created .env from .env.example. Check DATABASE_URL and DEMO_PASSWORD.
)

REM 3. Dependencies (installed only when missing)
if not exist "node_modules" (
  echo [INFO] Installing dependencies. This can take a few minutes...
  call npm install
  if errorlevel 1 ( echo [ERROR] npm install failed. & pause & exit /b 1 )
)

REM 4. Database schema (additive; never deletes existing data without prompting)
echo [INFO] Applying database schema with drizzle-kit push...
call npx drizzle-kit push
if errorlevel 1 (
  echo [ERROR] Could not apply the schema. Check that PostgreSQL is running and DATABASE_URL in .env is correct.
  pause & exit /b 1
)

REM 5. Optional seeding: only when requested with --seed, and only into an empty database
if /I "%~1"=="--seed" (
  echo [INFO] Seeding the SYNTHETIC demonstration dataset if the database is empty...
  call npx tsx scripts/seed.ts
  if errorlevel 1 ( echo [ERROR] Seeding failed. See the messages above. & pause & exit /b 1 )
)

REM 6. Production build (rebuilt when missing or when --rebuild is given)
if not exist ".next\BUILD_ID" set REBUILD=1
if /I "%~1"=="--rebuild" set REBUILD=1
if "%REBUILD%"=="1" (
  echo [INFO] Building the application...
  call npm run build
  if errorlevel 1 ( echo [ERROR] Build failed. & pause & exit /b 1 )
)

REM 7. Start the server (serves the UI and the REST API on port 3000)
set PORT=3000
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [WARN] Port 3000 is busy. Starting on port 3100 instead.
  set PORT=3100
)
echo.
echo  Application URL : http://localhost:%PORT%
echo  Health check    : http://localhost:%PORT%/api/health
echo  Demo accounts   : see README.md (section "Demo accounts")
echo.
echo  Press Ctrl+C in this window to stop the server.
echo.
call npx next start -p %PORT%
pause
