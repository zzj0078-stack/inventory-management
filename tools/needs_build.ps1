# Decide whether the frontend must be rebuilt.
# Prints "yes" or "no" and exits 0.
#
# Usage:
#   powershell -File tools\needs_build.ps1 -DistFile <dist\index.html> -Sources <path1,path2,...>
param(
    [Parameter(Mandatory = $true)][string]$DistFile,
    [Parameter(Mandatory = $true)][string]$Sources
)

$ErrorActionPreference = 'SilentlyContinue'

if (-not (Test-Path $DistFile)) {
    Write-Output 'yes'
    exit 0
}

$distTime = (Get-Item $DistFile).LastWriteTimeUtc
$newest = $null

foreach ($s in ($Sources -split ',')) {
    $s = $s.Trim()
    if (-not (Test-Path $s)) { continue }

    $item = Get-Item $s
    if ($item.PSIsContainer) {
        $f = Get-ChildItem $s -Recurse -File -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTimeUtc -Descending |
             Select-Object -First 1
    } else {
        $f = $item
    }

    if ($f -and ($newest -eq $null -or $f.LastWriteTimeUtc -gt $newest.LastWriteTimeUtc)) {
        $newest = $f
    }
}

if ($newest -and $newest.LastWriteTimeUtc -gt $distTime) {
    Write-Output 'yes'
} else {
    Write-Output 'no'
}
exit 0
