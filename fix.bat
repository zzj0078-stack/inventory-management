@echo off
setlocal
set ROOT=%~dp0

call "%ROOT%tools\find-python.bat"
if errorlevel 1 (
    pause
    exit /b 1
)

:menu
cls
echo ========================================
echo   Data Fix Tools
echo ========================================
echo.
echo   [1] Time offset     UTC to local (+8h)
echo   [2] Tax mode        recompute as tax-inclusive
echo   [3] Return status   recompute partial/full return
echo   [4] Balance check   diagnose receivables / payables
echo   [0] Exit
echo.
set /p CHOICE=Select: 

if "%CHOICE%"=="1" (
    call :runfix "Time offset" "diagnose_time.py" "fix_time_offset.py"
    goto menu
)
if "%CHOICE%"=="2" (
    call :runfix "Tax mode" "" "fix_tax_amounts.py"
    goto menu
)
if "%CHOICE%"=="3" (
    call :runfix "Return status" "" "fix_return_status.py"
    goto menu
)
if "%CHOICE%"=="4" (
    echo.
    "%PY%" "%ROOT%backend\diagnose_balance.py"
    echo.
    pause
    goto menu
)
if "%CHOICE%"=="0" exit /b 0
goto menu

REM ---------------------------------------------------------------
REM  :runfix  <title> <diagnose script or ""> <fix script>
REM ---------------------------------------------------------------
:runfix
echo.
echo --- %~1 ---
echo.
echo Stopping backend on port 3041 only ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3041 -PythonPath "%PY%"
timeout /t 1 /nobreak >nul

echo.
echo Backing up database ...
"%PY%" "%ROOT%backend\backup_db.py"

if not "%~2"=="" (
    echo.
    echo ---- current state ----
    "%PY%" "%ROOT%backend\%~2"
)

echo.
echo ---- preview ----
"%PY%" "%ROOT%backend\%~3"

echo.
set /p CONFIRM=Type YES to apply: 
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled - no changes made.
    echo.
    echo Restarting backend ...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start_backend.ps1" -WorkDir "%ROOT%backend" -Python "%PY%" -LogDir "%ROOT%backend\logs"
    pause
    exit /b 1
)

echo.
echo ---- applying ----
"%PY%" "%ROOT%backend\%~3" --apply

echo.
echo Restarting backend ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start_backend.ps1" -WorkDir "%ROOT%backend" -Python "%PY%" -LogDir "%ROOT%backend\logs"
timeout /t 4 /nobreak >nul
echo.
echo Done.
pause
exit /b 0
