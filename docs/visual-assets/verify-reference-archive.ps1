param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample
)
$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Sample = (Resolve-Path -LiteralPath $Sample).Path
$root = (New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot "../../.cache/task-scratch/visual-assets-reference-archive-$([guid]::NewGuid())")).FullName
$source = (New-Item -ItemType Directory -Path (Join-Path $root 'source')).FullName
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'active')).FullName
$original = Join-Path $source '原件.png'
$second = Join-Path $source '副本.png'
Copy-Item -LiteralPath $Sample -Destination $original
Copy-Item -LiteralPath $Sample -Destination $second
$hash = (Get-FileHash -LiteralPath $Sample).Hash

function Invoke-ArchiveProbe([string]$Profile, [string[]]$Arguments, [int]$ExitCode = 0) {
    $output = & $Probe $Profile @Arguments 2>&1
    if ($LASTEXITCODE -ne $ExitCode) {
        throw "Unexpected exit $LASTEXITCODE for $Arguments ($output). Evidence directory: $root"
    }
    $output
}
function New-ArchiveFolder([string]$Name) {
    (New-Item -ItemType Directory -Path (Join-Path $root $Name)).FullName
}

$imported = Invoke-ArchiveProbe $profile @('reference-import', $source, '原件.png', '副本.png') | ConvertFrom-Json
if (($imported.status -join ',') -ne 'imported,imported') { throw "Reference import failed. Evidence directory: $root" }
$livePreview = Invoke-ArchiveProbe $profile @('reference-preview', '1') | ConvertFrom-Json
$moved = Join-Path $source 'temporarily-missing.png'
Move-Item -LiteralPath $second -Destination $moved
try {
    $failure = Invoke-ArchiveProbe $profile @('backup-with-references', (New-ArchiveFolder 'failed')) 1
    $job = Invoke-ArchiveProbe $profile @('job-status') | ConvertFrom-Json
    if (($failure -join '') -ne 'reference_source_missing' -or $job.state -ne 'failed' -or
        $job.phase -ne 'copying-referenced-originals' -or !$job.includeReferencedOriginals -or
        (Test-Path -LiteralPath (Join-Path $job.destination 'snapshot'))) {
        throw "A missing reference did not leave the backup unpublished. Evidence directory: $root"
    }
} finally {
    Move-Item -LiteralPath $moved -Destination $second
}

$backup = New-ArchiveFolder 'archive-backup'
$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'snapshot-published'
try { Invoke-ArchiveProbe $profile @('backup-with-references', $backup) 86 | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
$job = Invoke-ArchiveProbe $profile @('job-status') | ConvertFrom-Json
$snapshot = Join-Path $job.destination 'snapshot'
$manifest = Get-Content -LiteralPath (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
$library = Join-Path $profile 'visual-assets'
$active = Invoke-ArchiveProbe $profile @('list') | ConvertFrom-Json
if ($job.state -ne 'completed' -or !$job.includeReferencedOriginals -or $manifest.version -ne 3 -or
    $manifest.assetCount -ne 2 -or $manifest.blobCount -ne 1 -or
    (Get-FileHash -LiteralPath (Join-Path $snapshot "$($hash.ToLowerInvariant()).blob")).Hash -ne $hash -or
    @(Get-ChildItem -LiteralPath $library -Filter '*.blob').Count -ne 0 -or
    @($active.assets | Where-Object archivedReference -eq $true).Count -ne 0 -or
    (Test-Path -LiteralPath (Join-Path $snapshot 'visual-assets-authorizations.sqlite'))) {
    throw "Published archive inventory or active library changed. Evidence directory: $root"
}

$restored = New-ArchiveFolder 'restored'
$retired = Join-Path $root 'source-offline'
$source = (Resolve-Path -LiteralPath $source).Path
if ($source -ne (Join-Path $root 'source')) { throw 'Unexpected isolated source path' }
Move-Item -LiteralPath $source -Destination $retired
try {
    $restore = Invoke-ArchiveProbe $restored @('restore-default', $snapshot) | ConvertFrom-Json
    $page = Invoke-ArchiveProbe $restored @('list') | ConvertFrom-Json
    $firstPreview = Invoke-ArchiveProbe $restored @('reference-preview', '1') | ConvertFrom-Json
    $secondPreview = Invoke-ArchiveProbe $restored @('reference-preview', '2') | ConvertFrom-Json
    $sourceStatus = Invoke-ArchiveProbe $restored @('reference-status', '1') 1
    if ($restore.state -ne 'completed' -or @($page.assets | Where-Object archivedReference -eq $true).Count -ne 2 -or
        $firstPreview.base64 -ne $livePreview.base64 -or $secondPreview.base64 -ne $livePreview.base64 -or
        ($sourceStatus -join '') -ne 'reference_not_authorized' -or
        (Test-Path -LiteralPath (Join-Path $restored 'visual-assets-authorizations.sqlite'))) {
        throw "Offline restore or archived preview mismatch. Evidence directory: $root"
    }
    $again = Invoke-ArchiveProbe $restored @('backup-default', (New-ArchiveFolder 'archived-rebackup')) | ConvertFrom-Json
    $againManifest = Get-Content -LiteralPath (Join-Path $again.destination 'snapshot/manifest.json') -Raw | ConvertFrom-Json
    if ($again.state -ne 'completed' -or $againManifest.version -ne 3 -or $againManifest.blobCount -ne 1) {
        throw "Archived original was lost in a later backup. Evidence directory: $root"
    }
} finally {
    Move-Item -LiteralPath $retired -Destination $source
}
if ((Get-FileHash -LiteralPath $original).Hash -ne $hash -or (Get-FileHash -LiteralPath $second).Hash -ne $hash) {
    throw "Archive verification changed a source original. Evidence directory: $root"
}
Write-Output "Passed. Evidence directory: $root"
