param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample,
    [switch]$IncludeReferenceJunction
)
$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Sample = (Resolve-Path -LiteralPath $Sample).Path
$root = Join-Path $PSScriptRoot "../../.cache/task-scratch/visual-assets-$([guid]::NewGuid())"
$root = (New-Item -ItemType Directory -Path $root).FullName
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'profile')).FullName
$library = Join-Path $profile 'visual-assets'

function Invoke-Probe([string[]]$Arguments, [int]$ExpectedExit = 0) {
    $output = & $Probe $profile @Arguments
    if ($LASTEXITCODE -ne $ExpectedExit) {
        throw "Unexpected exit $LASTEXITCODE for $Arguments. Evidence directory: $root"
    }
    $output
}

$hash = (Get-FileHash -LiteralPath $Sample).Hash
foreach ($phase in 'intent', 'staged', 'original-published', 'published', 'committed') {
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $phase
    try { Invoke-Probe @('import', $Sample) 86 }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $page = Invoke-Probe @('list') | ConvertFrom-Json
    $expected = [int]($phase -eq 'committed')
    if ($page.assets.Count -ne $expected -or
        @(Get-ChildItem $library -Filter '*.blob').Count -ne $expected -or
        @(Get-ChildItem $library -Filter '*.png').Count -ne $expected -or
        @(Get-ChildItem $library -Filter '*.tmp').Count -ne 0) {
        throw "Recovery mismatch after $phase. Evidence directory: $root"
    }
}
$bad = Join-Path $root 'bad.png'
[IO.File]::WriteAllText($bad, 'invalid image')
Invoke-Probe @('import', $bad) 1
$oversized = Join-Path $root 'oversized.png'
$file = [IO.File]::Create($oversized)
try { $file.SetLength(24MB + 1) } finally { $file.Dispose() }
Invoke-Probe @('import', $oversized) 1
Remove-Item -LiteralPath $oversized
Add-Type -AssemblyName System.Drawing
$tooWide = Join-Path $root 'too-wide.png'
$bitmap = [Drawing.Bitmap]::new(4097, 1)
try { $bitmap.Save($tooWide, [Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
Invoke-Probe @('import', $tooWide) 1
if ((Invoke-Probe @('duplicates-list', '0') | ConvertFrom-Json).assets.Count -ne 0) {
    throw "A single asset appeared as its own duplicate. Evidence directory: $root"
}
1..50 | ForEach-Object { Invoke-Probe @('import', $Sample) | Out-Null }
$firstJson = Invoke-Probe @('list')
$first = $firstJson | ConvertFrom-Json
$last = Invoke-Probe @('list', [string]$first.next) | ConvertFrom-Json
if ((Invoke-Probe @('duplicates-list', '0')) -ne $firstJson -or
    (Invoke-Probe @('duplicates-list', [string]$first.next) | ConvertFrom-Json).assets[0].id -ne $last.assets[0].id) {
    throw "Persistent duplicate pagination mismatch. Evidence directory: $root"
}
if ($first.assets.Count -ne 50 -or $last.assets.Count -ne 1 -or
    $last.assets[0].id -le $first.next -or $null -ne $last.next -or
    @(Get-ChildItem $library -Filter '*.blob').Count -ne 1 -or
    @(Get-ChildItem $library -Filter '*.png').Count -ne 1 -or
    (Get-FileHash (Join-Path $library "$($hash.ToLowerInvariant()).blob")).Hash -ne $hash -or
    (Get-FileHash -LiteralPath $Sample).Hash -ne $hash) {
    throw "Pagination, deduplication or integrity mismatch. Evidence directory: $root"
}
$preview = [Drawing.Image]::FromFile((Join-Path $library "$($hash.ToLowerInvariant()).png"))
try {
    if ($preview.Width -gt 256 -or $preview.Height -gt 256) {
        throw "Thumbnail dimensions exceeded. Evidence directory: $root"
    }
} finally { $preview.Dispose() }

# Snapshot creation pins the database while copying the referenced originals.
$sourceProfile = $profile
foreach ($phase in 'snapshot-catalog', 'snapshot-blobs', 'snapshot-ready', 'snapshot-published') {
    $destination = (New-Item -ItemType Directory -Path (Join-Path $root $phase)).FullName
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $phase
    try { Invoke-Probe @('backup', $destination) 86 }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $published = Test-Path -LiteralPath (Join-Path $destination 'snapshot')
    if ($published -ne ($phase -eq 'snapshot-published') -or (Invoke-Probe @('list')) -ne $firstJson) {
        throw "Snapshot publication mismatch after $phase. Evidence directory: $root"
    }
}
$destination = (New-Item -ItemType Directory -Path (Join-Path $root 'backup')).FullName
$snapshot = Invoke-Probe @('backup', $destination)
foreach ($phase in 'restore-blobs', 'restore-ready', 'restore-published') {
    $profile = (New-Item -ItemType Directory -Path (Join-Path $root $phase)).FullName
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $phase
    try { Invoke-Probe @('restore', $snapshot) 86 }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $published = Test-Path -LiteralPath (Join-Path $profile 'visual-assets')
    if ($published -ne ($phase -eq 'restore-published')) {
        throw "Restore publication mismatch after $phase. Evidence directory: $root"
    }
    if (-not $published) {
        Invoke-Probe @('list') 1
        Invoke-Probe @('restore', $snapshot) | Out-Null
    }
    if ((Invoke-Probe @('list')) -ne $firstJson) {
        throw "Restore retry mismatch after $phase. Evidence directory: $root"
    }
}
$restored = (New-Item -ItemType Directory -Path (Join-Path $root 'restored')).FullName
$profile = $restored
Invoke-Probe @('restore', $snapshot) | Out-Null
$restoredFirst = Invoke-Probe @('list')
if ($restoredFirst -ne $firstJson) {
    throw "Restored catalog mismatch. Evidence directory: $root"
}
if ((Get-FileHash (Join-Path $restored "visual-assets/$($hash.ToLowerInvariant()).blob")).Hash -ne $hash) {
    throw "Restored original mismatch. Evidence directory: $root"
}
Invoke-Probe @('restore', $snapshot) 1
$preview = [Drawing.Image]::FromFile((Join-Path $restored "visual-assets/$($hash.ToLowerInvariant()).png"))
try {
    if ($preview.Width -gt 256 -or $preview.Height -gt 256) { throw 'Restored thumbnail dimensions exceeded' }
} finally { $preview.Dispose() }
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'product-restore')).FullName
Invoke-Probe @('list') | Out-Null
$emptyCatalog = (Get-FileHash -LiteralPath (Join-Path $profile 'visual-assets/catalog.sqlite')).Hash
$job = Invoke-Probe @('restore-default', $snapshot) | ConvertFrom-Json
$archives = @(Get-ChildItem -LiteralPath $profile -Directory -Filter 'previous-empty-library-*')
if ($job.operation -ne 'restore' -or $job.state -ne 'completed' -or $archives.Count -ne 1 -or
    (Get-FileHash -LiteralPath (Join-Path $archives[0].FullName 'catalog.sqlite')).Hash -ne $emptyCatalog -or
    (Invoke-Probe @('list')) -ne $firstJson) {
    throw "Default library restore mismatch. Evidence directory: $root"
}
$liveCatalog = (Get-FileHash -LiteralPath (Join-Path $profile 'visual-assets/catalog.sqlite')).Hash
Invoke-Probe @('restore-default', $snapshot) 1
if ((Get-FileHash -LiteralPath (Join-Path $profile 'visual-assets/catalog.sqlite')).Hash -ne $liveCatalog) {
    throw "Rejected restore changed the current catalog. Evidence directory: $root"
}
foreach ($phase in 'default-restore-ready', 'default-restore-archived', 'default-restore-installed') {
    $profile = (New-Item -ItemType Directory -Path (Join-Path $root $phase)).FullName
    $emptyPage = Invoke-Probe @('list')
    $catalog = Join-Path $profile 'visual-assets/catalog.sqlite'
    $emptyHash = (Get-FileHash -LiteralPath $catalog).Hash
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $phase
    try { Invoke-Probe @('restore-default', $snapshot) 86 }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $installed = $phase -eq 'default-restore-installed'
    if ((Test-Path -LiteralPath $catalog) -eq ($phase -eq 'default-restore-archived')) {
        throw "Unexpected catalog location before restart after $phase. Evidence directory: $root"
    }
    # Opening the gallery first must reconcile before lazy catalog initialization.
    $page = Invoke-Probe @('list')
    $job = Invoke-Probe @('job-status') | ConvertFrom-Json
    $expectedState = if ($installed) { 'completed' } else { 'interrupted' }
    $expectedPage = if ($installed) { $firstJson } else { $emptyPage }
    if ($job.state -ne $expectedState -or $page -ne $expectedPage -or
        (-not $installed -and (Get-FileHash -LiteralPath $catalog).Hash -ne $emptyHash)) {
        throw "Default restore restart mismatch after $phase. Evidence directory: $root"
    }
    $staged = Join-Path $profile "pending-library-$($job.id)"
    $archive = Join-Path $profile "previous-empty-library-$($job.id)"
    if ((Test-Path -LiteralPath $staged) -eq $installed -or
        (Test-Path -LiteralPath $archive) -ne $installed) {
        throw "Restore retained directories mismatch after $phase. Evidence directory: $root"
    }
}
$profile = $sourceProfile
foreach ($scenario in 'before-publish', 'published', 'unavailable', 'tampered') {
    $parent = (New-Item -ItemType Directory -Path (Join-Path $root "product-backup-$scenario")).FullName
    $phase = if ($scenario -eq 'before-publish') { 'snapshot-ready' } else { 'snapshot-published' }
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $phase
    try { Invoke-Probe @('backup-default', $parent) 86 }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $destinations = @(Get-ChildItem -LiteralPath $parent -Directory -Filter 'visual-assets-backup-*')
    if ($destinations.Count -ne 1) { throw "Unexpected backup folders. Evidence directory: $root" }
    $destination = $destinations[0].FullName
    $publishedSnapshot = Join-Path $destination 'snapshot'
    if ((Test-Path -LiteralPath $publishedSnapshot) -ne ($scenario -ne 'before-publish')) {
        throw "Backup publication boundary mismatch. Evidence directory: $root"
    }
    if ($scenario -eq 'tampered') {
        $original = Join-Path $publishedSnapshot "$($hash.ToLowerInvariant()).blob"
        $bytes = [IO.File]::ReadAllBytes($original)
        $bytes[0] = $bytes[0] -bxor 1
        [IO.File]::WriteAllBytes($original, $bytes)
    }
    if ($scenario -eq 'unavailable') {
        Rename-Item -LiteralPath $parent -NewName 'product-backup-unavailable-detached'
    }
    $job = Invoke-Probe @('job-status') | ConvertFrom-Json
    $expectedState = if ($scenario -eq 'published') { 'completed' } else { 'interrupted' }
    if ($job.state -ne $expectedState) {
        throw "Backup restart mismatch for $scenario. Evidence directory: $root"
    }
    if ($scenario -eq 'unavailable') {
        Rename-Item -LiteralPath (Join-Path $root 'product-backup-unavailable-detached') -NewName 'product-backup-unavailable'
        $rechecked = Invoke-Probe @('job-status') | ConvertFrom-Json
        if ($rechecked.id -ne $job.id -or $rechecked.state -ne 'completed') {
            throw "Backup availability retry mismatch. Evidence directory: $root"
        }
    }
}
if ((Invoke-Probe @('list')) -ne $firstJson -or (Get-FileHash -LiteralPath $Sample).Hash -ne $hash) {
    throw "Source changed during backup/restore. Evidence directory: $root"
}
$alternate = Join-Path $root '同一原件.png'
Copy-Item -LiteralPath $Sample -Destination $alternate
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'batch-mixed')).FullName
$items = Invoke-Probe @('import-batch', $Sample, $bad, $alternate) | ConvertFrom-Json
$batchPage = Invoke-Probe @('list') | ConvertFrom-Json
if (($items.status -join ',') -ne 'imported,failed,imported' -or
    $null -ne $items[0].duplicateOf -or $items[2].duplicateOf.id -ne $items[0].assetId -or
    $items[2].duplicateOf.name -ne [IO.Path]::GetFileName($Sample) -or
    $batchPage.assets.Count -ne 2 -or $batchPage.assets[1].name -ne '同一原件.png' -or
    @(Get-ChildItem -LiteralPath (Join-Path $profile 'visual-assets') -Filter '*.blob').Count -ne 1 -or
    (Get-FileHash -LiteralPath $alternate).Hash -ne $hash) {
    throw "Batch mixed results or deduplication mismatch. Evidence directory: $root"
}
foreach ($term in '原', '原件', '同一原件') {
    $searchPage = Invoke-Probe @('list', '0', $term) | ConvertFrom-Json
    if ($searchPage.assets.Count -ne 1 -or $searchPage.assets[0].name -ne '同一原件.png') {
        throw "Literal filename search failed for $term. Evidence directory: $root"
    }
}
if ((Invoke-Probe @('list', '0', '%') | ConvertFrom-Json).assets.Count -ne 0) {
    throw "Filename search treated percent as a wildcard. Evidence directory: $root"
}
Invoke-Probe @('list', '0', ('原' * 65)) 1
Invoke-Probe @('tag', '1', '主角候选') | Out-Null
$savedTags = Invoke-Probe @('tag', '2', ' 主角 ', '主角', '夜景') | ConvertFrom-Json
$tagged = Invoke-Probe @('tag-list', '0', '主角', '原件') | ConvertFrom-Json
if (($savedTags -join ',') -ne '主角,夜景' -or $tagged.assets.Count -ne 1 -or
    $tagged.assets[0].id -ne 2 -or ($tagged.assets[0].tags -join ',') -ne '主角,夜景' -or
    (Invoke-Probe @('tag-list', '0', '主角', 'sample') | ConvertFrom-Json).assets.Count -ne 0 -or
    (Invoke-Probe @('tag-list', '0', '主') | ConvertFrom-Json).assets.Count -ne 0) {
    throw "Exact tag and filename filtering mismatch. Evidence directory: $root"
}
Invoke-Probe @('tag', '2', ('长' * 33)) 1
$collection = (Invoke-Probe @('collection-edit', (@{kind='create';name='角色合集'} | ConvertTo-Json -Compress)) | ConvertFrom-Json).id
Invoke-Probe @('collection-edit', (@{kind='membership';id=$collection;assetId=2;member=$true} | ConvertTo-Json -Compress)) | Out-Null
Invoke-Probe @('collection-edit', (@{kind='rename';id=$collection;previous='角色合集';name='月光合集'} | ConvertTo-Json -Compress)) | Out-Null
$members = Invoke-Probe @('collection-list', '0', $collection, '原件', '主角') | ConvertFrom-Json
if ($members.assets.Count -ne 1 -or $members.assets[0].id -ne 2 -or $members.assets[0].collectionIds[0] -ne $collection) {
    throw "Collection, filename and tag filtering mismatch. Evidence directory: $root"
}
$searchBackup = (New-Item -ItemType Directory -Path (Join-Path $root 'search-backup')).FullName
$searchSnapshot = Invoke-Probe @('backup', $searchBackup)
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'search-restored')).FullName
Invoke-Probe @('restore-default', $searchSnapshot) | Out-Null
if ((Invoke-Probe @('list', '0', '原件') | ConvertFrom-Json).assets[0].name -ne '同一原件.png') {
    throw "Filename search failed after snapshot restore. Evidence directory: $root"
}
$restoredTag = Invoke-Probe @('tag-list', '0', '主角', '原件') | ConvertFrom-Json
if ($restoredTag.assets.Count -ne 1 -or ($restoredTag.assets[0].tags -join ',') -ne '主角,夜景') {
    throw "Tags did not survive snapshot restore. Evidence directory: $root"
}
$restoredCollections = Invoke-Probe @('collections') | ConvertFrom-Json
$restoredMembers = Invoke-Probe @('collection-list', '0', $collection, '原件', '主角') | ConvertFrom-Json
$restoredDuplicates = Invoke-Probe @('duplicates-list', '0', '原件', '主角', $collection) | ConvertFrom-Json
if ($restoredDuplicates.assets.Count -ne 1 -or $restoredDuplicates.assets[0].id -ne 2) {
    throw "Duplicate filters failed after snapshot restore. Evidence directory: $root"
}
Invoke-Probe @('duplicates-list', '0', ('长' * 65), '', '') 1
if ($restoredCollections.id -ne $collection -or $restoredCollections.name -ne '月光合集' -or $restoredMembers.assets.Count -ne 1) {
    throw "Collection or membership did not survive snapshot restore. Evidence directory: $root"
}
Invoke-Probe @('collection-edit', (@{kind='membership';id=$collection;assetId=2;member=$false} | ConvertTo-Json -Compress)) | Out-Null
if ((Invoke-Probe @('collection-list', '0', $collection) | ConvertFrom-Json).assets.Count -ne 0) {
    throw "Membership removal did not update the collection. Evidence directory: $root"
}
Invoke-Probe @('collection-edit', (@{kind='membership';id=$collection;assetId=2;member=$true} | ConvertTo-Json -Compress)) | Out-Null
Invoke-Probe @('collection-edit', (@{kind='delete';id=$collection;previous='月光合集'} | ConvertTo-Json -Compress)) | Out-Null
$remaining = Invoke-Probe @('list') | ConvertFrom-Json
if ($remaining.assets.Count -ne 2 -or $remaining.assets[1].collectionIds.Count -ne 0) {
    throw "Collection deletion changed the assets or left a membership. Evidence directory: $root"
}
Invoke-Probe @('tag', '2') | Out-Null
if ((Invoke-Probe @('tag-list', '0', '主角') | ConvertFrom-Json).assets.Count -ne 0) {
    throw "Tag removal did not update the filter. Evidence directory: $root"
}
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'collection-only')).FullName
Invoke-Probe @('collection-edit', (@{kind='create';name='保留空集合'} | ConvertTo-Json -Compress)) | Out-Null
Invoke-Probe @('restore-default', $searchSnapshot) 1
if ((Invoke-Probe @('collections') | ConvertFrom-Json).name -ne '保留空集合') {
    throw "Restore replaced an empty collection. Evidence directory: $root"
}
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'batch-limit')).FullName
Invoke-Probe (@('import-batch') + (@($Sample) * 17)) 1
if ((Invoke-Probe @('list') | ConvertFrom-Json).assets.Count -ne 0) {
    throw "Over-limit batch changed the library. Evidence directory: $root"
}
$profile = (New-Item -ItemType Directory -Path (Join-Path $root 'batch-interrupted')).FullName
$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'committed'
try { Invoke-Probe @('import-batch', $Sample, $alternate) 86 }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
if ((Invoke-Probe @('list') | ConvertFrom-Json).assets.Count -ne 1) {
    throw "Batch did not preserve the committed item after interruption. Evidence directory: $root"
}
Invoke-Probe @('import-batch', $alternate) | Out-Null
if ((Invoke-Probe @('list') | ConvertFrom-Json).assets.Count -ne 2) {
    throw "Retry of the remaining batch item failed. Evidence directory: $root"
}
$source = (New-Item -ItemType Directory -Path (Join-Path $root 'reference-source')).FullName
$subdir = (New-Item -ItemType Directory -Path (Join-Path $source '子目录')).FullName
$reference = Join-Path $subdir '原件.png'
Copy-Item -LiteralPath $Sample -Destination $reference
$read = Invoke-Probe @('reference-read', $source, '子目录\原件.png') | ConvertFrom-Json
if ($read.sha256 -ne $hash -or $read.bytes -ne (Get-Item -LiteralPath $Sample).Length) {
    throw "Reference read did not return the selected original. Evidence directory: $root"
}
$escape = & $Probe $profile 'reference-read' $source '..\原件.png' 2>&1
if ($LASTEXITCODE -ne 1 -or ($escape -join '') -ne 'reference_path_rejected') {
    throw "Reference read accepted a parent path. Evidence directory: $root"
}
if ($IncludeReferenceJunction) {
    $outside = (New-Item -ItemType Directory -Path (Join-Path $root 'reference-outside')).FullName
    $outsideFile = Join-Path $outside '原件.png'
    Copy-Item -LiteralPath $Sample -Destination $outsideFile
    $junction = (New-Item -ItemType Junction -Path (Join-Path $source 'linked') -Target $outside).FullName
    try {
        foreach ($attempt in @(@($source, 'linked\原件.png'), @($junction, '原件.png'))) {
            $rejected = & $Probe $profile 'reference-read' $attempt[0] $attempt[1] 2>&1
            if ($LASTEXITCODE -ne 1 -or ($rejected -join '') -ne 'reference_path_rejected') {
                throw "Reference path followed a junction. Evidence directory: $root"
            }
        }
    } finally {
        if ((Get-Item -LiteralPath $junction).LinkType -eq 'Junction') {
            [IO.Directory]::Delete($junction, $false)
        }
    }
    if ((Get-FileHash -LiteralPath $outsideFile).Hash -ne $hash) {
        throw "Reference read changed an external original. Evidence directory: $root"
    }
}
if ((Get-FileHash -LiteralPath $reference).Hash -ne $hash) {
    throw "Reference read changed an original. Evidence directory: $root"
}
Write-Output "Passed. Evidence directory: $root"
