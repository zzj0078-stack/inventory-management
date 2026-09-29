@echo off
setlocal
set ROOT=%~dp0

echo ========================================
echo   Clean build artifacts and caches
echo ========================================
echo.
echo   This removes:
echo     - frontend\dist           (rebuilt by go.bat / watch.bat)
echo     - frontend\*.log
echo     - backend\__pycache__     (auto regenerated)
echo     - backend\*.log
echo     - backend\packages        (empty leftover)
echo.
echo   This KEEPS:
echo     - inventory.db  (your data)
echo     - backend\backups
echo     - backend\uploads (product images)
echo     - node_modules
echo     - frontend\src
echo.
set /p CONFIRM=Type YES to clean: 
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo [1/3] Stopping services ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3040,3041
timeout /t 1 /nobreak >nul

echo [2/3] Removing build output ...
if exist "%ROOT%frontend\dist" rmdir /s /q "%ROOT%frontend\dist"
echo   frontend\dist removed

del /q "%ROOT%frontend\*.log" >nul 2>&1
echo   frontend logs removed

if exist "%ROOT%backend\packages" rmdir /s /q "%ROOT%backend\packages"
echo   backend\packages removed

echo [3/3] Removing caches ...
for /d /r "%ROOT%backend" %%D in (__pycache__) do (
    if exist "%%D" rmdir /s /q "%%D"
)
echo   backend __pycache__ removed

del /q "%ROOT%backend\logs\*.log" >nul 2>&1
echo   backend logs cleared

echo.
echo ========================================
echo   Done. Now run go.bat to rebuild.
echo ========================================
echo.
pause
endlocal
