param(
    [Parameter(Mandatory)][string]$Run,
    [Parameter(Mandatory)][string]$AtlasIntent,
    [Parameter(Mandatory)][string]$SequenceIntent,
    [Parameter(Mandatory)][string]$ReferenceExport,
    [Parameter(Mandatory)][string]$ReferenceSequence,
    [Parameter(Mandatory)][scriptblock]$ProbeCommand
)

$ErrorActionPreference = 'Stop'
$parent = Join-Path $Run 'portable-exports'
New-Item -ItemType Directory -Path $parent | Out-Null

function Invoke-PngJob([string]$Intent, [string]$InterruptAt) {
    if (!$InterruptAt) {
        return (& $ProbeCommand -Arguments @('animation-job', $parent, $Intent) | ConvertFrom-Json)
    }
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $InterruptAt
    try { & $ProbeCommand -Arguments @('animation-job', $parent, $Intent) -ExpectFailure | Out-Null }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
}

function Get-Hash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-PngManifest([string]$Destination) {
    return (Get-Content -LiteralPath (Join-Path $Destination 'manifest.json') -Raw | ConvertFrom-Json)
}

function Confirm-PngFiles($Job) {
    if ($Job.state -ne 'completed' -or (Split-Path -Leaf $Job.destination) -notlike 'png-animation-*') {
        throw 'The portable job did not publish to a PNG sequence folder'
    }
    $manifest = Read-PngManifest $Job.destination
    $expectedFiles = @('frames/frame-001.png', 'frames/frame-002.png')
    $expectedRoot = @('frames', 'manifest.json')
    if ($manifest.schemaVersion -ne 1 -or $manifest.format -ne 'pngSequence' -or
        $manifest.PSObject.Properties['engine'] -or $manifest.recipe.looped -or
        ($manifest.recipe.frames.durationMs -join ',') -ne '120,245' -or
        ($manifest.recipe.frames.anchorX -join ',') -ne '2,0' -or
        ($manifest.recipe.frames.anchorY -join ',') -ne '1,2' -or
        ($manifest.frameFiles -join ',') -ne ($expectedFiles -join ',') -or
        $manifest.canvas.width -ne 5 -or $manifest.canvas.height -ne 4 -or
        $manifest.canvas.originX -ne 2 -or $manifest.canvas.originY -ne 2 -or
        (Compare-Object $expectedRoot @(Get-ChildItem -LiteralPath $Job.destination -Force -Name)) -or
        @(Get-ChildItem -LiteralPath (Join-Path $Job.destination 'frames') -Force).Count -ne 2) {
        throw 'The portable manifest or package layout changed the saved frames'
    }
    foreach ($file in $expectedFiles) {
        $actual = Get-Hash (Join-Path $Job.destination $file)
        if ($actual -ne (Get-Hash (Join-Path $ReferenceExport $file)) -or
            $actual -ne $manifest.fileSha256.PSObject.Properties[$file].Value) {
            throw "Portable frame differs from the reference: $file"
        }
    }
    return $manifest
}

$atlasPng = Join-Path $Run 'atlas-png.json'
$sequencePng = Join-Path $Run 'sequence-png.json'
$atlas = Get-Content -LiteralPath $AtlasIntent -Raw | ConvertFrom-Json -AsHashtable
$sequence = Get-Content -LiteralPath $SequenceIntent -Raw | ConvertFrom-Json -AsHashtable
$atlas.format = 'pngSequence'
$sequence.format = 'pngSequence'
$atlas | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $atlasPng -Encoding utf8
$sequence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $sequencePng -Encoding utf8

$first = Invoke-PngJob $atlasPng
$atlasManifest = Confirm-PngFiles $first
$sequenceJob = Invoke-PngJob $sequencePng
$sequenceManifest = Confirm-PngFiles $sequenceJob
$legacy = Read-PngManifest $ReferenceExport
$legacySequence = Read-PngManifest $ReferenceSequence
if ($atlasManifest.atlasSha256 -ne $legacy.atlasSha256 -or
    ($sequenceManifest.frameSourceSha256 -join ',') -ne ($legacySequence.frameSourceSha256 -join ',')) {
    throw 'The portable manifest lost source provenance'
}

Invoke-PngJob $atlasPng 'animation-ready'
$interrupted = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
if ($interrupted.state -ne 'interrupted' -or (Test-Path -LiteralPath $interrupted.destination)) {
    throw 'The portable job was published before the injected interruption'
}
$review = & $ProbeCommand -Arguments @('animation-retry-plan', $interrupted.id, $parent) | ConvertFrom-Json
$retry = & $ProbeCommand -Arguments @('animation-retry', $interrupted.id, $parent) | ConvertFrom-Json
Confirm-PngFiles $retry | Out-Null
if ($review.intent.format -ne 'pngSequence' -or $retry.destination -ne $interrupted.destination -or
    (Get-Hash (Join-Path $retry.destination 'manifest.json')) -ne (Get-Hash (Join-Path $first.destination 'manifest.json'))) {
    throw 'Retry changed the format, original destination or deterministic manifest'
}

Invoke-PngJob $sequencePng 'animation-published'
$recovered = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
Confirm-PngFiles $recovered | Out-Null

$prior = @(Get-ChildItem -LiteralPath $parent -Directory -Name -Filter 'png-animation-*')
Invoke-PngJob $sequencePng 'animation-published'
$published = @(Get-ChildItem -LiteralPath $parent -Directory -Filter 'png-animation-*' |
    Where-Object { $_.Name -notin $prior })
if ($published.Count -ne 1) { throw 'No published PNG sequence was left by the injected fault' }
$unexpected = Join-Path $published[0].FullName 'unexpected.txt'
'extra file' | Set-Content -LiteralPath $unexpected
$extra = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
if ($extra.state -ne 'interrupted') { throw 'A PNG sequence with an extra file was reconciled' }
Remove-Item -LiteralPath $unexpected
$changedFrame = Join-Path $published[0].FullName 'frames/frame-001.png'
Add-Content -LiteralPath $changedFrame -Value 'fixture edit'
$changed = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
if ($changed.state -ne 'interrupted') { throw 'A modified PNG frame was reconciled' }
Copy-Item -LiteralPath (Join-Path $ReferenceExport 'frames/frame-001.png') -Destination $changedFrame -Force
$repaired = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
Confirm-PngFiles $repaired | Out-Null

$project = Join-Path $Run 'portable-install-rejection'
New-Item -ItemType Directory -Path $project | Out-Null
'config_version=5' | Set-Content -LiteralPath (Join-Path $project 'project.godot')
& $ProbeCommand -Arguments @('animation-install', $project, 'portable', $atlasPng, 'new') -ExpectFailure | Out-Null
if (Test-Path -LiteralPath (Join-Path $project 'zicode-animation-portable')) {
    throw 'A portable job installed to a Godot project'
}

[ordered]@{
    atlasMatchesReference=$true
    sequenceMatchesReference=$true
    manifestSha256=(Get-Hash (Join-Path $first.destination 'manifest.json'))
    retriedInOriginalFolder=$true
    reconciledAfterPublication=$true
    unexpectedFilesRejected=$true
    modifiedFrameRejectedUntilRestored=$true
    pngInstallationRejected=$true
}
