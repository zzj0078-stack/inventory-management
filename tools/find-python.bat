@echo off
REM ============================================================
REM  Locate a usable Python interpreter and export it as PY.
REM
REM  Usage (from another script):
REM      call "%ROOT%tools\find-python.bat"
REM      if errorlevel 1 ( pause & exit /b 1 )
REM      "%PY%" run.py
REM
REM  Resolution order:
REM    1. %INVENTORY_PYTHON%  (explicit override)
REM    2. project virtualenv  (backend\.venv or .venv)
REM    3. python on PATH      (skips the Windows Store stub)
REM    4. common install dirs
REM    5. py launcher         (py -3) - last resort, can trigger a download
REM
REM  NOTE: no setlocal here - PY must survive in the caller's scope.
REM ============================================================

set "PY="

REM ---- 1. explicit override ----
if defined INVENTORY_PYTHON (
    if exist "%INVENTORY_PYTHON%" (
        set "PY=%INVENTORY_PYTHON%"
        exit /b 0
    )
    echo [WARN] INVENTORY_PYTHON is set but not found: %INVENTORY_PYTHON%
)

REM ---- 2. project virtualenv ----
if exist "%~dp0..\backend\.venv\Scripts\python.exe" (
    set "PY=%~dp0..\backend\.venv\Scripts\python.exe"
    exit /b 0
)
if exist "%~dp0..\.venv\Scripts\python.exe" (
    set "PY=%~dp0..\.venv\Scripts\python.exe"
    exit /b 0
)

REM ---- 3. python on PATH (verify it actually runs) ----
REM      Checked BEFORE the py launcher: on machines where the WindowsApps
REM      "py" stub is present but no Python is registered, running "py -3"
REM      triggers an interactive Python download prompt.
for /f "delims=" %%i in ('where python 2^>nul') do (
    "%%i" --version >nul 2>&1 && (
        set "PY=%%i"
        exit /b 0
    )
)

REM ---- 4. common install locations ----
for %%d in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
    "C:\Python310\python.exe"
    "C:\Python39\python.exe"
    "D:\Python312\python.exe"
    "D:\Python311\python.exe"
    "D:\Harness\Py312\python.exe"
) do (
    if exist %%d (
        set "PY=%%~d"
        exit /b 0
    )
)

REM ---- 5. py launcher (last resort, may trigger a download prompt) ----
for /f "delims=" %%i in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do (
    if exist "%%i" (
        set "PY=%%i"
        exit /b 0
    )
)

echo.
echo [ERROR] Python not found on this machine.
echo.
echo   Fix by either:
echo     1) Install Python 3.9+ from https://www.python.org/downloads/
echo        and tick "Add python.exe to PATH" during setup
echo     2) Or point this project at an existing interpreter:
echo           setx INVENTORY_PYTHON "C:\Path\to\python.exe"
echo        then reopen the terminal.
echo.
exit /b 1
