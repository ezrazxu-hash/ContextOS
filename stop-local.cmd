@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?" goto usage

set "BACKEND_PORT=18000"
set "STUDIO_PORT=5173"

call :stop_port "%BACKEND_PORT%"
call :stop_port "%STUDIO_PORT%"

echo.
echo ContextOS local services stopped.
goto :eof

:stop_port
set "PORT=%~1"
set "FOUND="

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "PID=%%P"
  if not "!PID!"=="0" (
    set "FOUND=1"
    echo Stopping PID !PID! on port %PORT%...
    taskkill /PID !PID! /F >nul 2>nul
    if errorlevel 1 (
      echo Failed to stop PID !PID! on port %PORT%.
    ) else (
      echo Stopped PID !PID! on port %PORT%.
    )
  )
)

if not defined FOUND echo No process listening on port %PORT%.
exit /b 0

:usage
echo Usage: stop-local.cmd
echo Stops processes listening on ports 18000 and 5173.
