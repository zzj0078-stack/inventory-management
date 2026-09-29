@echo off
setlocal enabledelayedexpansion
set ROOT=%~dp0
set PORT=3041

echo ========================================
echo   Inventory System   http://localhost:%PORT%
echo ========================================

REM ---------- 0. locate python (no hard-coded path) ----------
call "%ROOT%tools\find-python.bat"
if errorlevel 1 (
    pause
    exit /b 1
)
echo   python : %PY%

REM ---------- 1. stop old services (this project only) ----------
echo [1/3] Stopping old services ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3040,%PORT% -PythonPath "%PY%"

REM ---------- 2. build frontend only when sources changed ----------
echo [2/3] Checking frontend ...
set NEED=no
if not exist "%ROOT%frontend\node_modules" set NEED=yes
if not exist "%ROOT%frontend\dist\index.html" set NEED=yes

if "!NEED!"=="no" (
    for /f %%R in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\needs_build.ps1" -DistFile "%ROOT%frontend\dist\index.html" -Sources "%ROOT%frontend\src,%ROOT%frontend\index.html,%ROOT%frontend\vite.config.js,%ROOT%frontend\package.json"') do set NEED=%%R
)

if "!NEED!"=="yes" (
    echo   sources changed - building ^(20-40s^) ...
    pushd "%ROOT%frontend"
    if not exist node_modules (
        echo   installing dependencies ...
        call npm install
        if errorlevel 1 ( echo [ERROR] npm install failed & popd & pause & exit /b 1 )
    )
    REM clean dist first: vite keeps old hashed files (emptyOutDir=false), they pile up
    if exist dist (
        echo   cleaning old dist ...
        rmdir /s /q dist
    )
    call npm run build
    if errorlevel 1 ( echo [ERROR] build failed & popd & pause & exit /b 1 )
    popd
    echo   build ok
) else (
    echo   up to date, build skipped
)

REM ---------- 3. init db (first run only) + start backend ----------
echo [3/3] Starting backend ...
if not exist "%ROOT%backend\inventory.db" (
    echo   first run - initializing database ...
    "%PY%" "%ROOT%backend\init_db.py"
    if errorlevel 1 ( echo [ERROR] init_db failed & pause & exit /b 1 )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start_backend.ps1" -WorkDir "%ROOT%backend" -Python "%PY%" -LogDir "%ROOT%backend\logs"

echo   waiting for port %PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\wait_port.ps1" -Port %PORT% -TimeoutSec 60
if errorlevel 1 (
    echo.
    echo [ERROR] backend did not start within 60s
    echo   check log: %ROOT%backend\logs\app.log
    pause
    exit /b 1
)
echo   backend ready

echo.
echo ========================================
echo   Ready : http://localhost:%PORT%
echo   API   : http://localhost:%PORT%/docs
echo   Login : admin / admin123
echo ========================================
echo.
call "%ROOT%tools\countdown.bat" 3 "Opening browser in"
start http://localhost:%PORT%
endlocal
