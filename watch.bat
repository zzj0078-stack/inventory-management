@echo off
setlocal
set ROOT=%~dp0
set PORT=3041

echo ========================================
echo   Inventory System - AUTO REBUILD mode
echo   http://localhost:%PORT%
echo ========================================
echo.
echo   Frontend rebuilds AUTOMATICALLY when you edit files.
echo   Just save the file, then refresh the browser (F5).
echo.

call "%ROOT%tools\find-python.bat"
if errorlevel 1 (
    pause
    exit /b 1
)
echo   python : %PY%

echo [1/4] Stopping old services ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\kill-port.ps1" -Ports 3040,%PORT% -PythonPath "%PY%"

if not exist "%ROOT%frontend\node_modules" (
    echo [WARN] node_modules missing, installing ...
    pushd "%ROOT%frontend"
    call npm install
    popd
)

echo [2/4] Initial build ...
pushd "%ROOT%frontend"
if exist dist (
    echo   cleaning old dist ...
    rmdir /s /q dist
)
call npm run build
if errorlevel 1 (
    echo [ERROR] build failed
    popd
    pause
    exit /b 1
)
popd
echo   build ok

echo [3/4] Starting backend ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start_backend.ps1" -WorkDir "%ROOT%backend" -Python "%PY%" -LogDir "%ROOT%backend\logs"

echo [4/4] Starting auto-rebuild watcher ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\start_watch.ps1" -WorkDir "%ROOT%frontend" -LogFile "%ROOT%frontend\vite-watch.log"

echo   waiting for port %PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%tools\wait_port.ps1" -Port %PORT% -TimeoutSec 60
if errorlevel 1 (
    echo [ERROR] backend did not start, check %ROOT%backend\logs\app.log
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Ready : http://localhost:%PORT%
echo   Login : admin / admin123
echo.
echo   Edit any frontend file, it rebuilds in 1-2s
echo   then press F5 in the browser
echo   Log   : frontend\vite-watch.log
echo ========================================
echo.
call "%ROOT%tools\countdown.bat" 3 "Opening browser in"
start http://localhost:%PORT%
endlocal
