@echo off
setlocal EnableExtensions

if /i "%~1"=="--help" goto usage
if /i "%~1"=="/?" goto usage

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
exit /b %ERRORLEVEL%

:usage
echo Usage: start-local.cmd
echo Backend: http://127.0.0.1:18000
echo Studio:  http://localhost:5173
echo Logs:    logs\
