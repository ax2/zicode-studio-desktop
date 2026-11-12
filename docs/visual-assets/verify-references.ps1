param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample
)
$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Sample = (Resolve-Path -LiteralPath $Sample).Path
$root = (New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot "../../.cache/task-scratch/visual-assets-references-$([guid]::NewGuid())")).FullName
$source = (New-Item -ItemType Directory -Path (Join-Path $root 'source')).FullName
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'active')).FullName
$hash = (Get-FileHash -LiteralPath $Sample).Hash
Copy-Item -LiteralPath $Sample -Destination (Join-Path $source '原件.png')
Copy-Item -LiteralPath $Sample -Destination (Join-Path $source '副本.png')
[IO.File]::WriteAllText((Join-Path $source 'bad.png'), 'bad image')

function Invoke-RefProbe([string]$Profile, [string[]]$Arguments, [int]$ExitCode = 0) {
    $output = & $Probe $Profile @Arguments 2>&1
    if ($LASTEXITCODE -ne $ExitCode) {
        throw "Unexpected exit $LASTEXITCODE for $Arguments ($output). Evidence directory: $root"
    }
    $output
}
function Assert-ReferenceError([string]$Profile, [string]$Expected) {
    $status = Invoke-RefProbe $Profile @('reference-status', '1') 1
    if (($status -join '') -ne $Expected) { throw "Expected $Expected, received $status. Evidence directory: $root" }
}

$items = Invoke-RefProbe $profile @('reference-import', $source, '原件.png', 'bad.png', '副本.png') | ConvertFrom-Json
$library = Join-Path $profile 'visual-assets'
if (($items.status -join ',') -ne 'imported,failed,imported' -or
    $items[2].duplicateOf.id -ne 1 -or @(Get-ChildItem -LiteralPath $library -Filter '*.blob').Count -ne 0) {
    throw "Reference batch or duplicate result mismatch. Evidence directory: $root"
}
$status = Invoke-RefProbe $profile @('reference-status', '1') | ConvertFrom-Json
if ($status.sha256 -ne $hash) { throw "Persisted grant did not reopen the selected original. Evidence directory: $root" }
$preview = Invoke-RefProbe $profile @('reference-preview', '1') | ConvertFrom-Json
$png = [Convert]::FromBase64String($preview.base64)
if ($preview.mimeType -ne 'image/png' -or $png.Length -lt 33 -or
    $png.Length -gt 512KB -or [Convert]::ToHexString($png[0..7]) -ne '89504E470D0A1A0A') {
    throw "Referenced thumbnail was invalid. Evidence directory: $root"
}
$timings = Invoke-RefProbe $profile @('reference-preview-repeat', '1') | ConvertFrom-Json
$previewHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($png))
if ($timings.warmMs.Count -ne 8 -or $timings.previewSHA256 -ne $previewHash) {
    throw "Repeated referenced thumbnail changed. Evidence directory: $root"
}
$timings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'preview-timing.json')

$original = Join-Path $source '原件.png'
$moved = Join-Path $source 'temporarily-missing.png'
Move-Item -LiteralPath $original -Destination $moved
try {
    Assert-ReferenceError $profile 'reference_source_missing'
    $backup = (New-Item -ItemType Directory -Path (Join-Path $root 'reference-backup')).FullName
    $snapshot = Invoke-RefProbe $profile @('backup', $backup)
} finally {
    Move-Item -LiteralPath $moved -Destination $original
}
$manifest = Get-Content -LiteralPath (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne 2 -or $manifest.blobCount -ne 0 -or $manifest.assetCount -ne 2 -or
    (Test-Path -LiteralPath (Join-Path $snapshot 'visual-assets-authorizations.sqlite'))) {
    throw "Reference-only snapshot inventory mismatch. Evidence directory: $root"
}
$restored = (New-Item -ItemType Directory -Path (Join-Path $root 'restored')).FullName
Invoke-RefProbe $restored @('restore', $snapshot) | Out-Null
Assert-ReferenceError $restored 'reference_not_authorized'
if ((Invoke-RefProbe $restored @('list') | ConvertFrom-Json).assets.Count -ne 2 -or
    (Test-Path -LiteralPath (Join-Path $restored 'visual-assets-authorizations.sqlite'))) {
    throw "Restore failed to preserve references independently of grants. Evidence directory: $root"
}
$unavailable = Invoke-RefProbe $restored @('reference-preview', '1') 1
if (($unavailable -join '') -ne 'reference_not_authorized') {
    throw "Preview did not report the missing grant. Evidence directory: $root"
}
$newSource = (New-Item -ItemType Directory -Path (Join-Path $root 'reauthorized-source')).FullName
$newOriginal = Join-Path $newSource '原件.png'
[IO.File]::WriteAllText($newOriginal, 'different bytes')
$mismatch = Invoke-RefProbe $restored @('reference-reauthorize', '1', $newSource) 1
if (($mismatch -join '') -ne 'reference_content_changed') {
    throw "Reauthorization accepted different content. Evidence directory: $root"
}
Assert-ReferenceError $restored 'reference_not_authorized'
Copy-Item -LiteralPath $Sample -Destination $newOriginal -Force
Invoke-RefProbe $restored @('reference-reauthorize', '1', $newSource) | Out-Null
$relocated = Invoke-RefProbe $restored @('reference-preview', '1') | ConvertFrom-Json
$sibling = Invoke-RefProbe $restored @('reference-status', '2') 1
if ($relocated.base64 -ne $preview.base64 -or ($sibling -join '') -ne 'reference_not_authorized') {
    throw "Reauthorization failed to reconnect only the selected asset. Evidence directory: $root"
}

$interrupted = (New-Item -ItemType Directory -Path (Join-Path $root 'interrupted')).FullName
$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'reference-staged'
try { Invoke-RefProbe $interrupted @('reference-import', $source, '原件.png') 86 | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
if ((Invoke-RefProbe $interrupted @('list') | ConvertFrom-Json).assets.Count -ne 0 -or
    @(Get-ChildItem -LiteralPath (Join-Path $interrupted 'visual-assets') -Filter 'pending.reference.*').Count -ne 0) {
    throw "An interrupted reference left staged content or a visible asset. Evidence directory: $root"
}

$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'published'
try { Invoke-RefProbe $profile @('import', $Sample) 86 | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
if ((Invoke-RefProbe $profile @('list') | ConvertFrom-Json).assets.Count -ne 2 -or
    @(Get-ChildItem -LiteralPath $library -Filter '*.blob').Count -ne 0) {
    throw "Interrupted promotion published an uncommitted original. Evidence directory: $root"
}
Invoke-RefProbe $profile @('import', $Sample) | Out-Null
$mixedBackup = (New-Item -ItemType Directory -Path (Join-Path $root 'mixed-backup')).FullName
$backupJob = Invoke-RefProbe $profile @('backup-default', $mixedBackup) | ConvertFrom-Json
$destinations = @(Get-ChildItem -LiteralPath $mixedBackup -Directory -Filter 'visual-assets-backup-*')
if ($backupJob.state -ne 'completed' -or $destinations.Count -ne 1) {
    throw "Mixed library background backup failed. Evidence directory: $root"
}
$mixedSnapshot = Join-Path $destinations[0].FullName 'snapshot'
$mixed = Get-Content -LiteralPath (Join-Path $mixedSnapshot 'manifest.json') -Raw | ConvertFrom-Json
$mixedRestored = (New-Item -ItemType Directory -Path (Join-Path $root 'mixed-restored')).FullName
Invoke-RefProbe $mixedRestored @('list') | Out-Null
$restoreJob = Invoke-RefProbe $mixedRestored @('restore-default', $mixedSnapshot) | ConvertFrom-Json
Assert-ReferenceError $mixedRestored 'reference_not_authorized'
$mixedPreview = Invoke-RefProbe $mixedRestored @('reference-preview', '1') 1
if (($mixedPreview -join '') -ne 'reference_not_authorized') {
    throw "A managed copy bypassed the reference preview authorization. Evidence directory: $root"
}
$managed = Join-Path $mixedRestored "visual-assets/$($hash.ToLowerInvariant()).blob"
if ($restoreJob.state -ne 'completed' -or $mixed.version -ne 2 -or $mixed.blobCount -ne 1 -or $mixed.assetCount -ne 3 -or
    (Get-FileHash -LiteralPath $managed).Hash -ne $hash -or
    (Get-FileHash -LiteralPath $original).Hash -ne $hash) {
    throw "Mixed snapshot failed to restore the managed original. Evidence directory: $root"
}
Write-Output "Passed. Evidence directory: $root"
