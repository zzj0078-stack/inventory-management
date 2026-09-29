@echo off
REM Countdown timer.
REM Usage: call tools\countdown.bat <seconds> [message]
setlocal enabledelayedexpansion

set /a LEFT=%~1
if not defined LEFT set LEFT=0
set MSG=%~2
if "%MSG%"=="" set MSG=Closing in

:cd_loop
if !LEFT! LEQ 0 goto cd_end
echo   %MSG% !LEFT! ...
timeout /t 1 /nobreak >nul
set /a LEFT-=1
goto cd_loop

:cd_end
endlocal
