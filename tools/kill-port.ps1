# Stop only this project's processes.
#
# 1) Processes listening on the given ports (3040 / 3041).
# 2) Orphan python processes launched by this project's interpreter
#    (e.g. a backend that crashed before binding, still holding inventory.db).
#
# Never touches other node.exe / python.exe, so DSH and unrelated apps keep running.
param(
    [string]$Ports = '3040,3041',
    [string]$PythonPath = ''
)

$ErrorActionPreference = 'SilentlyContinue'

# NOTE: when invoked via "powershell -File", an [int[]] parameter receives
# "3040,3041" glued into a single number (30403041). So accept a string here
# and split it ourselves.
$portList = @()
foreach ($piece in ($Ports -split '[,;\s]+')) {
    if ($piece -match '^\d+$') { $portList += [int]$piece }
}
$portList = @($portList | Select-Object -Unique)

if ($portList.Count -eq 0) {
    Write-Host "  [WARN] no valid port parsed from '$Ports'"
}

function Get-PortOwners([int]$port) {
    $owners = @()
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        if ($conns) { $owners += ($conns | Select-Object -ExpandProperty OwningProcess) }
    } catch {
        $lines = netstat -ano | Select-String ":$port\s" | Select-String "LISTENING"
        foreach ($l in $lines) {
            $parts = ($l.ToString().Trim() -split '\s+')
            $last = $parts[$parts.Length - 1]
            if ($last -match '^\d+$') { $owners += [int]$last }
        }
    }
    return ($owners | Where-Object { $_ -and $_ -gt 0 } | Select-Object -Unique)
}

$killed = @{}

# ---- 1. by port ----
foreach ($p in $portList) {
    $pids = Get-PortOwners $p
    if (-not $pids) {
        Write-Host "  port $p : free"
        continue
    }
    foreach ($procId in $pids) {
        $name = 'unknown'
        try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            $killed[$procId] = $true
            Write-Host "  port $p : killed pid $procId ($name)"
        } catch {
            Write-Host "  port $p : FAILED to kill pid $procId ($name)"
        }
    }
}

# ---- 2. orphan python from this project's interpreter ----
if ($PythonPath) {
    $norm = $PythonPath.Trim('"')
    $orphans = Get-Process python, pythonw -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and ($_.Path -ieq $norm) }

    if (-not $orphans) {
        Write-Host "  orphan python : none"
    } else {
        foreach ($proc in $orphans) {
            if ($killed[$proc.Id]) { continue }
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                Write-Host "  orphan python : killed pid $($proc.Id) (started $($proc.StartTime.ToString('HH:mm:ss')))"
            } catch {
                Write-Host "  orphan python : FAILED pid $($proc.Id)"
            }
        }
    }
}

Start-Sleep -Milliseconds 800
