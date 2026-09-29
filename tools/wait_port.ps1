# Wait until a TCP port starts listening.
# Exits 0 when ready, 1 on timeout.
#
# Usage:
#   powershell -File tools\wait_port.ps1 -Port 3041 -TimeoutSec 60
param(
    [int]$Port = 3041,
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'SilentlyContinue'
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$dots = 0

while ((Get-Date) -lt $deadline) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $Port)
        if ($client.Connected) {
            $client.Close()
            if ($dots -gt 0) { Write-Host '' }
            exit 0
        }
    } catch {
        # not up yet
    } finally {
        if ($client) { $client.Close() }
    }

    Write-Host -NoNewline '.'
    $dots++
    Start-Sleep -Milliseconds 400
}

if ($dots -gt 0) { Write-Host '' }
exit 1
