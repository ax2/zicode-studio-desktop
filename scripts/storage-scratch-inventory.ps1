param(
    [ValidateRange(1, 100)]
    [int]$Top = 20
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.cache/task-scratch'))
$projectPrefix = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $scratchRoot.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Scratch inventory must stay inside this project.'
}
if ((Test-Path -LiteralPath $scratchRoot) -and
    ((Get-Item -LiteralPath $scratchRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Scratch inventory will not follow a linked root.'
}

$rows = [Collections.Generic.List[object]]::new()
$totalBytes = [long]0
$totalFiles = 0
$totalUnknown = 0
if (Test-Path -LiteralPath $scratchRoot) {
    foreach ($entry in (Get-ChildItem -LiteralPath $scratchRoot -Force)) {
        $bytes = [long]0
        $files = 0
        $unknown = 0
        $stack = [Collections.Generic.Stack[string]]::new()
        $stack.Push($entry.FullName)
        while ($stack.Count -gt 0) {
            $current = $stack.Pop()
            try {
                $item = Get-Item -LiteralPath $current -Force
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    $unknown++
                } elseif ($item.PSIsContainer) {
                    foreach ($child in (Get-ChildItem -LiteralPath $current -Force)) {
                        $stack.Push($child.FullName)
                    }
                } else {
                    $bytes += $item.Length
                    $files++
                }
            } catch {
                $unknown++
            }
        }
        $totalBytes += $bytes
        $totalFiles += $files
        $totalUnknown += $unknown
        $rows.Add([pscustomobject]@{
            Name = $entry.Name
            Path = $entry.FullName
            LogicalBytes = $bytes
            Files = $files
            UnknownEntries = $unknown
            OwnerJsonPresent = ($entry.PSIsContainer -and (Test-Path -LiteralPath (Join-Path $entry.FullName 'owner.json')))
        })
    }
}

$sorted = @($rows | Sort-Object LogicalBytes -Descending)
[pscustomobject]@{
    Project = $projectRoot
    Root = $scratchRoot
    ReadOnly = $true
    ReferencesChecked = $false
    TotalEntries = $rows.Count
    TotalLogicalBytes = $totalBytes
    TotalFiles = $totalFiles
    UnknownEntries = $totalUnknown
    TopEntries = @($sorted | Select-Object -First $Top)
} | ConvertTo-Json -Depth 5
if ($totalUnknown -gt 0) { exit 2 }
