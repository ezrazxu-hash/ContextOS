@echo off
setlocal EnableExtensions EnableDelayedExpansion

if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?" goto usage

set "BACKEND_PORT=18000"
set "STUDIO_PORT=5173"

set "ROOT=%~dp0"
cd /d "%ROOT%"

if exist "backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
    set "ENV_NAME=%%A"
    if not "!ENV_NAME!"=="" if not "!ENV_NAME:~0,1!"=="#" set "%%A=%%B"
  )
)

set "CONTEXTOS_STUDIO_API_BASE_URL=http://localhost:%BACKEND_PORT%"
set "CONTEXTOS_STUDIO_SSE_BASE_URL=http://localhost:%BACKEND_PORT%"
set "CONTEXTOS_STUDIO_WS_BASE_URL="
set "CONTEXTOS_STUDIO_PORT=%STUDIO_PORT%"

echo Starting ContextOS backend on http://127.0.0.1:%BACKEND_PORT%
start "ContextOS Backend" /D "%ROOT%" cmd /k "set PYTHONPATH=backend/src&& python -m contextos.api --host 127.0.0.1 --port %BACKEND_PORT%"

echo Starting ContextOS Studio on http://localhost:%STUDIO_PORT%
start "ContextOS Studio" /D "%ROOT%" cmd /k "npm --prefix studio run dev:real"

echo.
echo Backend: http://127.0.0.1:%BACKEND_PORT%
echo Studio:  http://localhost:%STUDIO_PORT%
echo.
echo Usage: start-local.cmd
goto :eof

:usage
echo Usage: start-local.cmd
echo Backend port: 18000
echo Studio port: 5173
