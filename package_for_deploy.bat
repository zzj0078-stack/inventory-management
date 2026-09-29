@echo off
setlocal enabledelayedexpansion
set ROOT=%~dp0
set OUT=%ROOT%dist_deploy
set STAMP=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%
set PKG=%OUT%\inventory-erp

echo ========================================
echo   Package for Linux deployment
echo ========================================
echo.

if not exist "%ROOT%backend\app\main.py" (
    echo [ERROR] backend not found
    pause
    exit /b 1
)

echo [1/5] Building frontend ...
pushd "%ROOT%frontend"
if not exist node_modules (
    echo   installing dependencies ...
    call npm install
    if errorlevel 1 ( echo [ERROR] npm install failed & popd & pause & exit /b 1 )
)
call npm run build
if errorlevel 1 ( echo [ERROR] build failed & popd & pause & exit /b 1 )
popd
echo   build ok

echo [2/5] Preparing output folder ...
if exist "%PKG%" rmdir /s /q "%PKG%"
mkdir "%PKG%\backend" 2>nul
mkdir "%PKG%\frontend" 2>nul
mkdir "%PKG%\deploy" 2>nul

echo [3/5] Copying backend ^(excluding db / cache / backups / logs / uploads^) ...
robocopy "%ROOT%backend" "%PKG%\backend" /E /XD __pycache__ backups logs packages uploads .pytest_cache /XF *.db *.db-shm *.db-wal *.log .env .time_fixed /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 ( echo [ERROR] robocopy backend failed & pause & exit /b 1 )

echo [4/5] Copying frontend dist + deploy scripts ...
robocopy "%ROOT%frontend\dist" "%PKG%\frontend\dist" /E /NFL /NDL /NJH /NJS /NP >nul
copy /y "%ROOT%deploy\*.sh"   "%PKG%\deploy\" >nul
copy /y "%ROOT%deploy\*.md"   "%PKG%\deploy\" >nul
copy /y "%ROOT%README.md"     "%PKG%\" >nul 2>&1

REM shell scripts MUST use LF line endings, otherwise bash fails with '\r' errors
powershell -NoProfile -Command "Get-ChildItem '%PKG%\deploy\*.sh' | ForEach-Object { $t = [IO.File]::ReadAllText($_.FullName) -replace \"`r`n\", \"`n\"; [IO.File]::WriteAllText($_.FullName, $t, (New-Object Text.UTF8Encoding($false))) }"

echo [5/5] Creating archive ...
pushd "%PKG%"
powershell -NoProfile -Command "Compress-Archive -Path '*' -DestinationPath '%OUT%\inventory-erp-%STAMP%.zip' -Force"
popd

echo.
echo ========================================
echo   Done
echo   Package : %OUT%\inventory-erp-%STAMP%.zip
echo.
echo   Upload and deploy:
echo     scp inventory-erp-%STAMP%.zip root@SERVER:/opt/
echo     cd /opt ^&^& unzip inventory-erp-%STAMP%.zip -d inventory-erp
echo     cd inventory-erp ^&^& sudo bash deploy/deploy.sh
echo ========================================
echo.
endlocal
pause
