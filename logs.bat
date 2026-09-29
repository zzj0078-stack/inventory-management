@echo off
setlocal
set ROOT=%~dp0
set BACKEND_LOG=%ROOT%backend\logs\app.log
set ERR_LOG=%ROOT%backend\logs\error.log
set VITE_LOG=%ROOT%frontend\vite.log
set WATCH_LOG=%ROOT%frontend\vite-watch.log

:menu
cls
call :showstatus
echo ========================================
echo   [1] Backend log   (last 80 lines)
echo   [2] Backend log   (live follow, Ctrl+C to stop)
echo   [3] Backend error log
echo   [4] Vite log      (dev / watch mode)
echo   [5] Open log folder
echo   [0] Exit
echo.
set /p CHOICE=Select: 

if "%CHOICE%"=="1" (
    if exist "%BACKEND_LOG%" ( powershell -NoProfile -Command "Get-Content -Path '%BACKEND_LOG%' -Tail 80" ) else ( echo No log yet. )
    pause
    goto menu
)
if "%CHOICE%"=="2" (
    if exist "%BACKEND_LOG%" ( powershell -NoProfile -Command "Get-Content -Path '%BACKEND_LOG%' -Wait -Tail 30" ) else ( echo No log yet. & pause )
    goto menu
)
if "%CHOICE%"=="3" (
    if exist "%ERR_LOG%" ( powershell -NoProfile -Command "Get-Content -Path '%ERR_LOG%' -Tail 80" ) else ( echo No error log. )
    pause
    goto menu
)
if "%CHOICE%"=="4" (
    if exist "%WATCH_LOG%" (
        powershell -NoProfile -Command "Get-Content -Path '%WATCH_LOG%' -Tail 60"
    ) else if exist "%VITE_LOG%" (
        powershell -NoProfile -Command "Get-Content -Path '%VITE_LOG%' -Tail 60"
    ) else (
        echo No vite log. Run watch.bat first.
    )
    pause
    goto menu
)
if "%CHOICE%"=="5" (
    if not exist "%ROOT%backend\logs" mkdir "%ROOT%backend\logs"
    start "" "%ROOT%backend\logs"
    goto menu
)
if "%CHOICE%"=="0" exit /b 0
goto menu

REM ---------------------------------------------------------------
:showstatus
echo ========================================
echo   Service Status
echo ========================================
powershell -NoProfile -Command "$r='%ROOT%'; foreach($p in 3040,3041){ $c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if($c){ $pr=Get-Process -Id $c[0].OwningProcess -ErrorAction SilentlyContinue; Write-Host ('  port ' + $p + '    : RUNNING  pid=' + $c[0].OwningProcess + ' ' + $pr.ProcessName) } else { Write-Host ('  port ' + $p + '    : stopped') } }; $db=Join-Path $r 'backend\inventory.db'; if(Test-Path $db){ $f=Get-Item $db; Write-Host ('  database   : ' + [math]::Round($f.Length/1KB,1) + ' KB   ' + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm')) } else { Write-Host '  database   : NOT FOUND' }; $i=Join-Path $r 'frontend\dist\index.html'; if(Test-Path $i){ Write-Host ('  dist built : ' + (Get-Item $i).LastWriteTime.ToString('yyyy-MM-dd HH:mm')) } else { Write-Host '  dist built : not built' }; $sd=Join-Path $r 'frontend\dist'; if(Test-Path $sd){ $sz=(Get-ChildItem $sd -Recurse -File | Measure-Object Length -Sum).Sum; Write-Host ('  dist size  : ' + [math]::Round($sz/1MB,1) + ' MB') }"
echo ========================================
echo.
goto :eof
