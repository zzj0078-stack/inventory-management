# Run "vite build --watch" with NO visible window.
# Rebuilds frontend/dist automatically whenever source files change,
# so port 3041 (single-port mode) always serves fresh files.
#
# Usage:
#   powershell -File tools\start_watch.ps1 -WorkDir <frontend> -LogFile <log file>
param(
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$LogFile
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $WorkDir)) { throw "workdir not found: $WorkDir" }

$logDir = Split-Path -Parent $LogFile
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$errLog = [System.IO.Path]::ChangeExtension($LogFile, '.err.log')

Start-Process -FilePath 'cmd.exe' `
              -ArgumentList '/c', 'npx vite build --watch' `
              -WorkingDirectory $WorkDir `
              -RedirectStandardOutput $LogFile `
              -RedirectStandardError $errLog `
              -WindowStyle Hidden

Write-Host "  vite build --watch started (hidden)"
Write-Host "  log: $LogFile"
