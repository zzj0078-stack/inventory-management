# Start the backend with NO visible window.
# Uses Start-Process with output redirection (no VBScript engine required).
#
# Usage:
#   powershell -File tools\start_backend.ps1 -WorkDir <backend> -Python <python.exe> -LogDir <log dir>
param(
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$Python,
    [Parameter(Mandatory = $true)][string]$LogDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $WorkDir)) { throw "workdir not found: $WorkDir" }
if (-not (Test-Path $Python))  { throw "python not found: $Python" }
if (-not (Test-Path $LogDir))  { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$log = Join-Path $LogDir 'app.log'
$err = Join-Path $LogDir 'error.log'

# RedirectStandardOutput forces UseShellExecute=false, which also means no console window.
Start-Process -FilePath $Python `
              -ArgumentList 'run.py' `
              -WorkingDirectory $WorkDir `
              -RedirectStandardOutput $log `
              -RedirectStandardError $err `
              -WindowStyle Hidden

Write-Host "  backend started (hidden)"
Write-Host "  log: $log"
