# Start the vite dev server with NO visible window.
#
# Usage:
#   powershell -File tools\start_vite.ps1 -WorkDir <frontend> -LogFile <log file>
param(
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$LogFile,
    [int]$Port = 3040
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $WorkDir)) { throw "workdir not found: $WorkDir" }

$logDir = Split-Path -Parent $LogFile
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$errLog = [System.IO.Path]::ChangeExtension($LogFile, '.err.log')

# npx.cmd must be resolved through cmd, otherwise Start-Process cannot run it directly
Start-Process -FilePath 'cmd.exe' `
              -ArgumentList '/c', 'npx vite --port ' + $Port `
              -WorkingDirectory $WorkDir `
              -RedirectStandardOutput $LogFile `
              -RedirectStandardError $errLog `
              -WindowStyle Hidden

Write-Host "  vite started (hidden) on port $Port"
Write-Host "  log: $LogFile"
