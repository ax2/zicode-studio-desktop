param([string]$CargoTarget = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $CargoTarget) {
    if ($env:CARGO_TARGET_DIR) { $CargoTarget = $env:CARGO_TARGET_DIR }
    else { $CargoTarget = 'target' }
}
if (-not [IO.Path]::IsPathRooted($CargoTarget)) { $CargoTarget = Join-Path $projectRoot $CargoTarget }
$CargoTarget = [IO.Path]::GetFullPath($CargoTarget)
$scratch = Join-Path $projectRoot '.cache/task-scratch'
function Measure-Tree([string]$Path, [string]$Exclude = '') {
    $bytes = [long]0; $count = 0; $unknown = 0
    $queue = [Collections.Generic.Stack[IO.FileSystemInfo]]::new()
    $listing = [IO.EnumerationOptions]::new()
    $listing.AttributesToSkip = 0
    $listing.IgnoreInaccessible = $false
    if (Test-Path -LiteralPath $Path) {
        try { $queue.Push((Get-Item -LiteralPath $Path -Force)) } catch { $unknown++ }
    }
    while ($queue.Count -gt 0) {
        $item = $queue.Pop()
        if ($Exclude -and $item.FullName -eq $Exclude) { continue }
        try {
            # Directory listings already include file lengths. Refresh directories before entering them.
            $directory = $item -is [IO.DirectoryInfo]
            if ($directory) { $item.Refresh() }
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $unknown++; continue }
            if ($directory) {
                foreach ($child in $item.EnumerateFileSystemInfos('*', $listing)) { $queue.Push($child) }
            } else { $bytes += $item.Length; $count++ }
        } catch { $unknown++ }
    }
    [pscustomobject]@{Path=$Path;LogicalBytes=$bytes;Files=$count;UnknownEntries=$unknown}
}
$rows = @()
foreach ($candidate in @(
    @{Path=$CargoTarget;Limit=12GB;Exclude=''},
    @{Path=(Join-Path $projectRoot '.cache');Limit=1GB;Exclude=$scratch},
    @{Path=$scratch;Limit=512MB;Exclude=''},
    @{Path=(Join-Path $projectRoot 'site');Limit=128MB;Exclude=''}
)) {
    $row = Measure-Tree $candidate.Path $candidate.Exclude
    $row | Add-Member BudgetBytes $candidate.Limit
    $row | Add-Member OverBudget ($row.LogicalBytes -gt $candidate.Limit)
    $rows += $row
}
$volumes = @(); $volumeError = $false
foreach ($volumeRoot in (@([IO.Path]::GetPathRoot($projectRoot),[IO.Path]::GetPathRoot($CargoTarget)) | Select-Object -Unique)) {
    try {
        $drive = [IO.DriveInfo]::new($volumeRoot)
        $volumes += [pscustomobject]@{Root=$volumeRoot;FreeBytes=$drive.AvailableFreeSpace;BelowReserve=($drive.AvailableFreeSpace -lt 20GB)}
    } catch { $volumeError=$true }
}
[pscustomobject]@{Project=$projectRoot;ReadOnly=$true;BudgetsAdvisory=$true;Trees=$rows;Volumes=$volumes;VolumeError=$volumeError} | ConvertTo-Json -Depth 5
if ($volumeError -or ($rows | Where-Object UnknownEntries -gt 0)) { exit 2 }
# Reference cache sizes are telemetry, not a reason to interrupt useful development
# or delete caches. Low volume space still requires an explicit storage review.
if ($volumes | Where-Object BelowReserve) { exit 1 }
exit 0
