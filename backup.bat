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
echo   Database Backup
echo ========================================
"%PY%" "%ROOT%backend\backup_db.py"
echo.
echo --- existing backups ---
"%PY%" "%ROOT%backend\backup_db.py" --list
echo.
endlocal
pause
