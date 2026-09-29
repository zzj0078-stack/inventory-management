@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  Push this project to GitHub
REM
REM  Usage:
REM    1. Double-click this file
REM    2. Paste your repo URL when asked, e.g.
REM       https://github.com/yourname/inventory-system.git
REM    3. When git asks for credentials:
REM         Username = your GitHub username
REM         Password = Personal Access Token (NOT your login password)
REM ============================================================

cd /d "%~dp0"

echo.
echo ============================================================
echo   Push to GitHub
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
    echo [ERROR] git not found. Install Git for Windows first:
    echo         https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo [1/5] Safety check...
set LEAK=0
for /f "delims=" %%f in ('git ls-files') do (
    echo %%f | findstr /R /C:"^backend/\.env$" /C:"\.db$" /C:"\.db-shm$" /C:"\.db-wal$" /C:"node_modules" /C:"^backend/backups/" >nul 2>nul
    if not errorlevel 1 (
        echo       [DANGER] sensitive file is tracked: %%f
        set LEAK=1
    )
)
if "!LEAK!"=="1" (
    echo.
    echo [ABORT] Tracked sensitive files detected. Push cancelled.
    echo         Run: git rm --cached ^<file listed above^>
    echo.
    pause
    exit /b 1
)
echo       OK: no .env / database / node_modules / backups tracked

echo [2/5] Configure remote...
git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo.
    echo   No remote configured yet.
    echo   Paste your GitHub repo URL below and press Enter.
    echo   Example: https://github.com/yourname/inventory-system.git
    echo.
    set /p REPO_URL=  Repo URL: 
    if "!REPO_URL!"=="" (
        echo [ERROR] Empty URL, cancelled.
        echo.
        pause
        exit /b 1
    )
    git remote add origin "!REPO_URL!"
    echo       origin added: !REPO_URL!
) else (
    for /f "delims=" %%u in ('git remote get-url origin') do set CUR=%%u
    echo       origin already set: !CUR!
    echo.
    set /p CHANGE=  Change remote URL? (y/N): 
    if /i "!CHANGE!"=="y" (
        set /p REPO_URL=  New repo URL: 
        if not "!REPO_URL!"=="" (
            git remote set-url origin "!REPO_URL!"
            echo       origin updated: !REPO_URL!
        )
    )
)

echo [3/5] Check local changes...
set CNT=0
for /f %%c in ('git status --porcelain ^| find /c /v ""') do set CNT=%%c
if not "!CNT!"=="0" (
    echo       !CNT! changed item(s) found, committing...
    git add -A
    git commit -m "chore: update"
) else (
    echo       Working tree clean, nothing to commit
)

echo [4/5] Pushing...
echo.
echo       (this network is slow, please wait 1-3 minutes)
echo.
REM bypass broken/absent global proxy, force HTTP/1.1, tolerate slow links
git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 -c http.postBuffer=524288000 -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=180 push -u origin main --progress
if errorlevel 1 (
    echo.
    echo ------------------------------------------------------------
    echo [PUSH FAILED] Common causes:
    echo.
    echo   1. You typed your GitHub login password instead of a token.
    echo      Fix: create a Personal Access Token
    echo           GitHub - Settings - Developer settings
    echo           - Personal access tokens - Tokens (classic)
    echo           - Generate new token, check the "repo" scope
    echo.
    echo   2. Remote repo is not empty (you ticked README/.gitignore).
    echo      Fix: git pull origin main --allow-unrelated-histories
    echo           resolve conflicts, then push again
    echo.
    echo   3. Wrong repo URL / no permission
    echo ------------------------------------------------------------
    echo.
    pause
    exit /b 1
)

echo.
echo [5/5] Done.
echo.
git remote -v
echo.
git log --oneline -3
echo.
echo ============================================================
echo   PUSH SUCCEEDED
echo ============================================================
echo.
pause
