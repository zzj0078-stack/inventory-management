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
echo   Initialize Database (clean)
echo ========================================
echo.
echo   This will PERMANENTLY:
echo     1. DELETE backend\inventory.db   (all data lost)
echo     2. DELETE backend\uploads\*      (all uploaded images)
echo     3. Recreate tables
echo     4. Create 82 permissions + 8 roles
echo     5. Create ONE user only: admin / admin123
echo.
echo   NO demo data will be created.
echo   To add demo data later, run create_test_data.py
echo.
set /p CONFIRM=Type YES to continue: 
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo [1/4] Stopping services (ports 3040/3041 + orphan python) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3040,3041 -PythonPath "%PY%"
timeout /t 1 /nobreak >nul

cd /d "%ROOT%backend"

echo.
echo [2/4] Deleting old database and uploaded files ...
for %%F in (inventory.db inventory.db-shm inventory.db-wal) do (
    if exist "%%F" (
        del /f /q "%%F" >nul 2>&1
        echo   deleted: %%F
    )
)

if exist "uploads" (
    rmdir /s /q "uploads" >nul 2>&1
    if exist "uploads" (
        echo   [WARN] could not fully remove uploads\ - some files may be locked
    ) else (
        echo   deleted: uploads\ ^(all uploaded images^)
    )
) else (
    echo   uploads\ not found, skipped
)

echo [3/4] Initializing database ...
"%PY%" init_db.py
if errorlevel 1 (
    echo.
    echo [ERROR] init_db.py failed - see message above
    pause
    exit /b 1
)

echo.
echo [4/4] Starting backend ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start_backend.ps1" -WorkDir "%ROOT%backend" -Python "%PY%" -LogDir "%ROOT%backend\logs"
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo   Done
echo   Login : admin / admin123
echo   URL   : http://localhost:3041
echo ========================================
echo.
call "%ROOT%tools\countdown.bat" 3 "Closing in"
pause
endlocal
