@echo off
setlocal
set "BACKEND_PORT=%~1"
if "%BACKEND_PORT%"=="" set "BACKEND_PORT=8000"
cd /d "%~dp0.."
if exist "backend\.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("backend\.env") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
  )
)
set "PYTHONPATH=backend/src"
python -m contextos.api --host 127.0.0.1 --port %BACKEND_PORT%
