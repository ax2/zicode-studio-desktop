param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Corpus,
    [Parameter(Mandatory)][string]$Inventory,
    [string]$Query = ''
)
$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Corpus = (Resolve-Path -LiteralPath $Corpus).Path
$Inventory = (Resolve-Path -LiteralPath $Inventory).Path
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($workspace))
$freeBefore = $drive.AvailableFreeSpace
$root = (New-Item -ItemType Directory -Path (
    Join-Path $workspace ".cache/task-scratch/visual-assets-corpus-$([guid]::NewGuid())"
)).FullName

function Assert-RegularPath([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Corpus contains a reparse point at $Path"
    }
    $item
}

for ($parent = [IO.DirectoryInfo]::new($Corpus); $null -ne $parent; $parent = $parent.Parent) {
    Assert-RegularPath $parent.FullName | Out-Null
}
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$inputs = @(foreach ($line in Get-Content -LiteralPath $Inventory -Encoding utf8) {
    $parts = $line -split '[\\/]'
    if ([IO.Path]::IsPathRooted($line) -or $parts -contains '' -or $parts -contains '..' -or
        $parts -contains '.' -or $line.Contains(':')) { throw "Invalid corpus path $line" }
    $path = $Corpus
    foreach ($part in $parts) {
        $path = Join-Path $path $part
        $entry = Assert-RegularPath $path
    }
    if ($entry.PSIsContainer -or $entry.Extension -notin '.png','.jpg','.jpeg','.webp' -or
        !$seen.Add($entry.FullName)) { throw "Invalid or repeated corpus file $line" }
    [pscustomobject]@{
        relative = [IO.Path]::GetRelativePath($Corpus, $entry.FullName)
        path = $entry.FullName
        bytes = $entry.Length
        sha256 = (Get-FileHash -LiteralPath $entry.FullName).Hash
    }
})
if ($inputs.Count -eq 0) { throw 'The corpus inventory is empty' }
$inputs | Select-Object relative,bytes,sha256 |
    ConvertTo-Json -AsArray -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'inventory.json')

function Invoke-MeasuredProbe([string]$Profile, [string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new($Probe)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [Text.Encoding]::UTF8
    $start.ArgumentList.Add($Profile)
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($start)
    try {
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        $peak = [long]0
        while (!$process.WaitForExit(10)) {
            try {
                $process.Refresh()
                $peak = [math]::Max($peak, $process.PeakWorkingSet64)
            } catch [InvalidOperationException] {
                # The process may exit between the wait and the memory observation.
            }
        }
        $timer.Stop()
        $text = $output.GetAwaiter().GetResult().Trim()
        $failure = $errors.GetAwaiter().GetResult().Trim()
        if ($process.ExitCode -ne 0) {
            throw "Probe failed for $($Arguments[0]) with exit $($process.ExitCode): $failure. Evidence: $root"
        }
        [pscustomobject]@{ text=$text; ms=$timer.Elapsed.TotalMilliseconds; peakProbeBytes=$peak }
    } finally {
        $process.Dispose()
    }
}

function Read-AssetScan([string]$Profile) {
    $result = Invoke-MeasuredProbe $Profile @('list-scan')
    [pscustomobject]@{ assets=@($result.text | ConvertFrom-Json); ms=$result.ms }
}

function Measure-Listing([string]$Profile, [object[]]$Assets, [string]$Query) {
    $positions = @(0, 50, ([math]::Floor($Assets.Count / 100) * 50),
        ([math]::Floor(($Assets.Count - 1) / 50) * 50)) |
        Where-Object { $_ -lt $Assets.Count } | Sort-Object -Unique
    foreach ($position in $positions) {
        $cursor = if ($position -eq 0) { 0 } else { $Assets[$position - 1].id }
        $page = (Invoke-MeasuredProbe $Profile @('list-timing',[string]$cursor,'')).text | ConvertFrom-Json
        $end = [math]::Min($position + 49, $Assets.Count - 1)
        $expectedIds = $Assets[$position..$end].id
        $next = if ($end + 1 -lt $Assets.Count) { $Assets[$end].id }
        if ($page.after -ne $cursor -or ($page.assets -join ',') -ne ($expectedIds -join ',') -or $page.next -ne $next) {
            throw "Timed page at offset $position differs from the full scan"
        }
        $page
    }
    if ($Query) {
        $filtered = (Invoke-MeasuredProbe $Profile @('list-timing','0',$Query)).text | ConvertFrom-Json
        $expectedMatches = @($Assets | Where-Object { $_.name.Contains($Query, [StringComparison]::Ordinal) } |
            Select-Object -First 51 -ExpandProperty id)
        $expectedIds = @($expectedMatches | Select-Object -First 50)
        $next = if ($expectedMatches.Count -gt 50) { $expectedMatches[49] }
        if (($filtered.assets -join ',') -ne ($expectedIds -join ',') -or $filtered.next -ne $next) {
            throw 'Query results differ from literal source names'
        }
        $filtered
    }
}

function Measure-Tree([string]$Path) {
    [long](Get-ChildItem -LiteralPath $Path -File -Force -Recurse | Measure-Object Length -Sum).Sum
}

$modes = foreach ($mode in 'reference','managed') {
    $profile = (New-Item -ItemType Directory -Path (Join-Path $root "$mode-active")).FullName
    $expected = [Collections.Generic.Dictionary[long,object]]::new()
    $rejected = [Collections.Generic.List[object]]::new()
    $batchMs = [Collections.Generic.List[double]]::new()
    $peak = [long]0
    for ($offset = 0; $offset -lt $inputs.Count; $offset += 16) {
        $batch = $inputs[$offset..([math]::Min($offset + 15, $inputs.Count - 1))]
        $arguments = if ($mode -eq 'reference') {
            @('reference-import', $Corpus) + @($batch.relative)
        } else {
            @('import-batch') + @($batch.path)
        }
        $result = Invoke-MeasuredProbe $profile $arguments
        $batchMs.Add($result.ms)
        $peak = [math]::Max($peak, $result.peakProbeBytes)
        $items = @($result.text | ConvertFrom-Json)
        if ($items.Count -ne $batch.Count) { throw 'Batch did not report every input' }
        for ($index = 0; $index -lt $items.Count; $index++) {
            $item = $items[$index]
            if ($item.position -ne $index) { throw 'Batch positions changed' }
            if ($item.status -eq 'imported') {
                $expected.Add([long]$item.assetId, $batch[$index])
            } else {
                $rejected.Add([pscustomobject]@{path=$batch[$index].relative;status=$item.status})
            }
        }
    }
    if (!$expected.Count) { throw "No usable images in $mode corpus" }
    $activeScan = Read-AssetScan $profile
    $active = $activeScan.assets
    if ($active.Count -ne $expected.Count) { throw "Unexpected persisted asset count for $mode" }
    foreach ($asset in $active) {
        $source = $expected[[long]$asset.id]
        if ($asset.digest -ne $source.sha256 -or $asset.name -ne [IO.Path]::GetFileName($source.path)) {
            throw "Persisted asset differs from source in $mode corpus"
        }
    }
    $timings = @(Measure-Listing $profile $active $Query)
    $backup = (New-Item -ItemType Directory -Path (Join-Path $root "$mode-backup")).FullName
    $operation = if ($mode -eq 'reference') { 'backup-with-references' } else { 'backup-default' }
    $backupResult = Invoke-MeasuredProbe $profile @($operation,$backup)
    $job = $backupResult.text | ConvertFrom-Json
    if ($job.state -ne 'completed') { throw 'Corpus backup did not complete' }
    $snapshot = Join-Path $job.destination 'snapshot'
    $manifest = Get-Content -LiteralPath (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
    $restored = (New-Item -ItemType Directory -Path (Join-Path $root "$mode-restored")).FullName
    $restoreResult = Invoke-MeasuredProbe $restored @('restore-default',$snapshot)
    if (($restoreResult.text | ConvertFrom-Json).state -ne 'completed') { throw 'Corpus restore did not complete' }
    $restoredScan = Read-AssetScan $restored
    $reopened = $restoredScan.assets
    if ($reopened.Count -ne $active.Count -or $manifest.assetCount -ne $active.Count) {
        throw 'Restored asset count differs from the backup'
    }
    for ($index = 0; $index -lt $active.Count; $index++) {
        $asset = $active[$index]
        $copy = $reopened[$index]
        if ($copy.id -ne $asset.id -or $copy.name -ne $asset.name -or $copy.digest -ne $asset.digest -or
            ($mode -eq 'reference' -and !$copy.archivedReference)) { throw 'Restored asset metadata differs' }
    }
    $digests = @($reopened.digest | Sort-Object -Unique)
    if ($manifest.blobCount -ne $digests.Count) { throw 'Backup original count differs from unique digests' }
    foreach ($digest in $digests) {
        $original = Join-Path $restored "visual-assets/$digest.blob"
        if ((Get-FileHash -LiteralPath $original).Hash -ne $digest) { throw 'Restored original changed' }
    }
    $importMs = ($batchMs | Measure-Object -Sum).Sum
    [ordered]@{
        mode=$mode; accepted=$active.Count; rejected=$rejected; uniqueOriginals=$digests.Count
        importMs=$importMs; acceptedPerSecond=$active.Count * 1000 / $importMs; importBatchMs=$batchMs
        importPeakProbeBytes=$(if ($peak) { $peak }); queries=$timings; snapshotVersion=$manifest.version
        activeTraversalMs=$activeScan.ms; restoredTraversalMs=$restoredScan.ms
        backupMs=$backupResult.ms; restoreMs=$restoreResult.ms; activeBytes=(Measure-Tree $profile)
        backupBytes=(Measure-Tree $backup); restoredBytes=(Measure-Tree $restored)
    }
}
foreach ($source in $inputs) {
    if ((Get-FileHash -LiteralPath $source.path).Hash -ne $source.sha256) { throw 'Corpus original changed' }
}
[ordered]@{
    images=$inputs.Count; corpusBytes=($inputs.bytes | Measure-Object -Sum).Sum
    formatCounts=@($inputs | Group-Object { [IO.Path]::GetExtension($_.path).ToLowerInvariant() } |
        Select-Object Name,Count)
    processor=$env:PROCESSOR_IDENTIFIER; logicalProcessors=[Environment]::ProcessorCount
    os=[Runtime.InteropServices.RuntimeInformation]::OSDescription; outputFileSystem=$drive.DriveFormat
    probeSHA256=(Get-FileHash -LiteralPath $Probe).Hash; measuredAt=[DateTimeOffset]::Now.ToString('o')
    importScope='Each batch starts an isolated Windows probe. Memory samples cover that process.'
    queryScope='First Catalog query and 32 repeats in one probe. OS cache state is uncontrolled.'
    freeBytesBefore=$freeBefore; freeBytesAfter=$drive.AvailableFreeSpace
    sourceDigestsVerified=$true; modes=@($modes)
} | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $root 'receipt.json')
Write-Output "Passed. Evidence directory: $root"
