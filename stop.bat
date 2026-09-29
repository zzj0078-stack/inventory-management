@echo off
setlocal
set ROOT=%~dp0

REM ---------- locate python (optional: only used to clean orphan processes) ----------
call "%ROOT%tools\find-python.bat" >nul 2>&1
REM If not found that is fine - stopping by port still works

echo ========================================
echo   Stop Inventory System
echo   only ports 3040 / 3041 are affected
echo ========================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3040,3041 -PythonPath "%PY%"

echo.
echo Other Node / Python applications are NOT touched.
endlocal
