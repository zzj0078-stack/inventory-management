@echo off
setlocal
set ROOT=%~dp0

REM ---------- locate python ----------
call "%ROOT%tools\find-python.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

echo ========================================
echo   Stop Inventory System
echo   only ports 3040 / 3041 are affected
echo ========================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3040,3041 -PythonPath "%PY%"

echo.
echo Other Node / Python applications are NOT touched.
endlocal
