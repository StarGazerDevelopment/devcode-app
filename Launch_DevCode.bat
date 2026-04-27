@echo off
title DevCode
echo ==============================================
echo        Starting DevCode IDE...
echo ==============================================
echo.

:: Navigate to the devcode directory relative to this script
cd /d "%~dp0devcode"

:: Check if node_modules exists, run install if not
if not exist node_modules (
    echo Installing dependencies...
    npm install
)

:: Launch the application
echo Launching the application...
npm run dev

pause
