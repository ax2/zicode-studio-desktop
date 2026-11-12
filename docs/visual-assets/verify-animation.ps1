param(
    [Parameter(Mandatory)][string]$Probe,
    [string]$Godot
)

$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
if ($Godot) { $Godot = (Resolve-Path -LiteralPath $Godot).Path }
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$run = Join-Path $repo ".cache/task-scratch/visual-assets-animation-$([guid]::NewGuid())"
$profile = Join-Path $run 'profile'
$source = Join-Path $run 'source'
New-Item -ItemType Directory -Path $profile, $source | Out-Null

function Invoke-Probe {
    param([string[]]$Arguments, [switch]$ExpectFailure, [string]$ProfilePath = $profile)
    $output = & $Probe $ProfilePath @Arguments 2>&1
    if (($LASTEXITCODE -eq 0) -eq $ExpectFailure.IsPresent) {
        throw "Unexpected probe exit $LASTEXITCODE for $($Arguments[0]): $output"
    }
    return ($output -join "`n")
}

function Get-Hash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-Inventory([string]$Path) {
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File | Sort-Object FullName)
    return @($files | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($Path, $_.FullName).Replace('\', '/')
        "$relative $(Get-Hash $_.FullName)"
    })
}

function Assert-Pixel {
    param([string]$File, [int]$X, [int]$Y, [Drawing.Color]$Color)
    $image = [Drawing.Bitmap]::new($File)
    try {
        if ($image.Width -ne 5 -or $image.Height -ne 4 -or
            $image.GetPixel($X, $Y).ToArgb() -ne $Color.ToArgb()) {
            throw "Unexpected dimensions or pixel at ($X,$Y) in $File"
        }
    } finally {
        $image.Dispose()
    }
}

Add-Type -AssemblyName System.Drawing
$atlas = Join-Path $source 'atlas.png'
$redFrame = Join-Path $source 'red.png'
$blueFrame = Join-Path $source 'blue.png'
$red = [Drawing.Color]::FromArgb(123, 240, 20, 11)
$blue = [Drawing.Color]::FromArgb(181, 19, 127, 255)
$transparent = [Drawing.Color]::FromArgb(0, 0, 0, 0)
$pixelFormat = [Drawing.Imaging.PixelFormat]::Format32bppArgb
$image = [Drawing.Bitmap]::new(5, 3, $pixelFormat)
try {
    $image.SetPixel(0, 0, $red)
    $image.SetPixel(2, 1, $blue)
    $image.Save($atlas, [Drawing.Imaging.ImageFormat]::Png)
    $redImage = $image.Clone([Drawing.Rectangle]::new(0, 0, 2, 3), $pixelFormat)
    try { $redImage.Save($redFrame, [Drawing.Imaging.ImageFormat]::Png) }
    finally { $redImage.Dispose() }
    $blueImage = $image.Clone([Drawing.Rectangle]::new(2, 1, 3, 2), $pixelFormat)
    try { $blueImage.Save($blueFrame, [Drawing.Imaging.ImageFormat]::Png) }
    finally { $blueImage.Dispose() }
} finally {
    $image.Dispose()
}
$atlasHash = Get-Hash $atlas
$recipe = Join-Path $run 'recipe.json'
$badRecipe = Join-Path $run 'bad-recipe.json'
$recipeJson = @'
{
  "looped": false,
  "frames": [
    { "x": 0, "y": 0, "width": 2, "height": 3, "durationMs": 120, "anchorX": 2, "anchorY": 1 },
    { "x": 2, "y": 1, "width": 3, "height": 2, "durationMs": 245, "anchorX": 0, "anchorY": 2 }
  ]
}
'@
$recipeJson | Set-Content -LiteralPath $recipe -Encoding utf8
$recipeJson.Replace('"x": 2', '"x": 4294967295') |
    Set-Content -LiteralPath $badRecipe -Encoding utf8
$managed = Invoke-Probe -Arguments @('import', $atlas)
$reference = Invoke-Probe -Arguments @('reference-import', $source, 'atlas.png') | ConvertFrom-Json
$listed = Invoke-Probe -Arguments @('list') | ConvertFrom-Json
if ($listed.assets.Count -ne 2 -or $reference.status -ne 'imported' -or
    $reference.assetId -ne $listed.assets[1].id) {
    throw 'Expected one managed and one referenced copy of the atlas'
}
$referenceId = [string]$reference.assetId
$first = Join-Path $run 'managed'
$repeat = Join-Path $run 'repeat'
$referenced = Join-Path $run 'referenced'
$manifest = Invoke-Probe -Arguments @('animation-export', $managed, '1', $recipe, $first) |
    ConvertFrom-Json
Invoke-Probe -Arguments @('animation-export', $managed, '1', $recipe, $repeat) | Out-Null
Invoke-Probe -Arguments @('animation-export', $referenceId, '1', $recipe, $referenced) | Out-Null
$inventory = Get-Inventory $first
if ($inventory.Count -ne 7 -or
    (Compare-Object $inventory (Get-Inventory $repeat)) -or
    (Compare-Object $inventory (Get-Inventory $referenced))) {
    throw 'Repeated and referenced exports must be byte-identical'
}
if ($manifest.atlasSha256 -ne $atlasHash -or $manifest.canvas.originX -ne 2 -or
    $manifest.canvas.originY -ne 2 -or $manifest.recipe.frames[1].durationMs -ne 245) {
    throw 'Unexpected export manifest'
}
foreach ($file in $manifest.fileSha256.PSObject.Properties) {
    if ((Get-Hash (Join-Path $first $file.Name)) -ne $file.Value) {
        throw "Export hash differs from manifest for $($file.Name)"
    }
}
$firstPng = Join-Path $first 'frames/frame-001.png'
$secondPng = Join-Path $first 'frames/frame-002.png'
Assert-Pixel $firstPng 0 1 $red
Assert-Pixel $firstPng 2 0 $transparent
Assert-Pixel $secondPng 0 1 $transparent
Assert-Pixel $secondPng 2 0 $blue

$rejected = Join-Path $run 'rejected'
$existing = Join-Path $run 'existing'
New-Item -ItemType Directory -Path $existing | Out-Null
Invoke-Probe -Arguments @('animation-export', $managed, '1', $badRecipe, $rejected) -ExpectFailure |
    Out-Null
Invoke-Probe -Arguments @('animation-export', $managed, '1', $recipe, $existing) -ExpectFailure |
    Out-Null
Invoke-Probe -Arguments @('animation-export', $managed, '1', $recipe, $first) -ExpectFailure |
    Out-Null
if ((Test-Path -LiteralPath $rejected) -or
    (Get-ChildItem -LiteralPath $existing -Force) -or
    (Get-ChildItem -LiteralPath $run -Filter '.zicode-animation-*' -Force) -or
    (Compare-Object $inventory (Get-Inventory $first)) -or
    (Get-Hash $atlas) -ne $atlasHash) {
    throw 'A rejected export changed the destination, left a stage or changed the source'
}

$backupParent = Join-Path $run 'backup'
$restored = Join-Path $run 'restored'
New-Item -ItemType Directory -Path $backupParent, $restored | Out-Null
$job = Invoke-Probe -Arguments @('backup-with-references', $backupParent) | ConvertFrom-Json
$snapshot = @(Get-ChildItem -LiteralPath $backupParent -Directory -Filter 'visual-assets-backup-*')
if ($job.state -ne 'completed' -or $snapshot.Count -ne 1) {
    throw 'The backup did not archive the source'
}
$archived = Join-Path $run 'archived'
$offline = Join-Path $run 'offline'
$moved = Join-Path $source 'temporarily-offline.png'
Move-Item -LiteralPath $atlas -Destination $moved
try {
    $exportOffline = @('animation-export', $referenceId, '1', $recipe, $offline)
    Invoke-Probe -Arguments $exportOffline -ExpectFailure | Out-Null
    $snapshotRoot = Join-Path $snapshot[0].FullName 'snapshot'
    Invoke-Probe -ProfilePath $restored -Arguments @('restore', $snapshotRoot) | Out-Null
    $exportArchived = @('animation-export', $referenceId, '1', $recipe, $archived)
    Invoke-Probe -ProfilePath $restored -Arguments $exportArchived | Out-Null
} finally {
    Move-Item -LiteralPath $moved -Destination $atlas
}
if ((Test-Path -LiteralPath $offline) -or
    (Compare-Object $inventory (Get-Inventory $archived)) -or (Get-Hash $atlas) -ne $atlasHash) {
    throw 'Offline reference handling changed the source or produced an incorrect package'
}

$redAsset = [long](Invoke-Probe -Arguments @('import', $redFrame))
$blueAsset = Invoke-Probe -Arguments @('reference-import', $source, 'blue.png') | ConvertFrom-Json
if ($blueAsset.status -ne 'imported') { throw 'Could not import the second sequence frame' }
$redHash = Get-Hash $redFrame
$blueHash = Get-Hash $blueFrame
$sequenceFrames = @(
    @{assetId=$redAsset; revision=1; durationMs=120; anchorX=2; anchorY=1},
    @{assetId=$blueAsset.assetId; revision=1; durationMs=245; anchorX=0; anchorY=2}
)
$sequenceRecipe = Join-Path $run 'sequence.json'
$sequence = Join-Path $run 'sequence'
$sequenceRepeat = Join-Path $run 'sequence-repeat'
@{looped=$false; frames=$sequenceFrames} | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $sequenceRecipe -Encoding utf8
$sequenceManifest = Invoke-Probe -Arguments @('animation-export-sequence', $sequenceRecipe, $sequence) |
    ConvertFrom-Json
Invoke-Probe -Arguments @('animation-export-sequence', $sequenceRecipe, $sequenceRepeat) | Out-Null
if ($sequenceManifest.schemaVersion -ne 2 -or
    ($sequenceManifest.frameSourceSha256 -join ',') -ne "$redHash,$blueHash" -or
    (Compare-Object (Get-Inventory $sequence) (Get-Inventory $sequenceRepeat))) {
    throw 'The sequence provenance or repeat export is incorrect'
}
foreach ($file in $manifest.fileSha256.PSObject.Properties) {
    if ((Get-Hash (Join-Path $sequence $file.Name)) -ne $file.Value) {
        throw "Independent frames differ from their atlas slices in $($file.Name)"
    }
}

$reordered = Join-Path $run 'sequence-reordered'
$reorderedRecipe = Join-Path $run 'sequence-reordered.json'
@{looped=$false; frames=@($sequenceFrames[1], $sequenceFrames[0], $sequenceFrames[1])} |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reorderedRecipe -Encoding utf8
$reorderedManifest = Invoke-Probe -Arguments @('animation-export-sequence', $reorderedRecipe, $reordered) |
    ConvertFrom-Json
if (($reorderedManifest.frameSourceSha256 -join ',') -ne "$blueHash,$redHash,$blueHash" -or
    ($reorderedManifest.recipe.frames.durationMs -join ',') -ne '245,120,245' -or
    (Get-Hash (Join-Path $reordered 'frames/frame-001.png')) -ne
    (Get-Hash (Join-Path $reordered 'frames/frame-003.png'))) {
    throw 'The sequence did not preserve order or repeated revisions'
}

$badSequence = Join-Path $run 'sequence-rejected'
$badSequenceRecipe = Join-Path $run 'sequence-rejected.json'
$sequenceFrames[1].revision = 2
@{looped=$false; frames=$sequenceFrames} | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $badSequenceRecipe -Encoding utf8
Invoke-Probe -Arguments @('animation-export-sequence', $badSequenceRecipe, $badSequence) -ExpectFailure |
    Out-Null
$sequenceFrames[1].revision = 1
$sequenceFrames[1].anchorX = 4
@{looped=$false; frames=$sequenceFrames} | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath $badSequenceRecipe -Encoding utf8
Invoke-Probe -Arguments @('animation-export-sequence', $badSequenceRecipe, $badSequence) -ExpectFailure |
    Out-Null
$sequenceFrames[1].anchorX = 0
if ((Test-Path -LiteralPath $badSequence) -or
    (Get-ChildItem -LiteralPath $run -Filter '.zicode-animation-*' -Force) -or
    (Get-Hash $redFrame) -ne $redHash -or (Get-Hash $blueFrame) -ne $blueHash) {
    throw 'An invalid sequence left output or changed the source'
}

$libraryId = Invoke-Probe -Arguments @('library-id')
$atlasPreviewIntent = Join-Path $run 'atlas-preview.json'
$sequencePreviewIntent = Join-Path $run 'sequence-preview.json'
@{
    libraryId=$libraryId
    source=@{kind='atlas';assetId=[long]$managed;revision=1}
    recipe=($recipeJson | ConvertFrom-Json)
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $atlasPreviewIntent -Encoding utf8
@{
    libraryId=$libraryId
    source=@{kind='sequence'}
    recipe=@{looped=$false;frames=$sequenceFrames}
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $sequencePreviewIntent -Encoding utf8
foreach ($intent in @($atlasPreviewIntent, $sequencePreviewIntent)) {
    $preview = Invoke-Probe -Arguments @('animation-preview', $intent) | ConvertFrom-Json
    if ($preview.looped -or $preview.width -ne 5 -or $preview.height -ne 4 -or
        ($preview.frames.durationMs -join ',') -ne '120,245') {
        throw 'The preview changed the clip canvas or timing'
    }
    for ($index = 0; $index -lt $preview.frames.Count; $index++) {
        $bytes = [Convert]::FromBase64String($preview.frames[$index].base64)
        $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
        $filename = 'frames/frame-{0:D3}.png' -f ($index + 1)
        if ($digest -ne (Get-Hash (Join-Path $first $filename))) {
            throw 'The preview changed an unscaled export frame'
        }
    }
}

$largeAtlas = Join-Path $repo 'public/icons/app-512.png'
$largeAsset = [long](Invoke-Probe -Arguments @('import', $largeAtlas))
$largeIntent = Join-Path $run 'large-preview.json'
$largeFrames = @(1..128 | ForEach-Object {
    $anchor = 256 * ($_ % 2)
    @{x=0;y=0;width=256;height=256;durationMs=17;anchorX=$anchor;anchorY=$anchor}
})
@{
    libraryId=$libraryId
    source=@{kind='atlas';assetId=$largeAsset;revision=1}
    recipe=@{looped=$true;frames=$largeFrames}
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $largeIntent -Encoding utf8
$largeJson = Invoke-Probe -Arguments @('animation-preview', $largeIntent)
$largePreview = $largeJson | ConvertFrom-Json
$previewRoot = Join-Path $profile 'visual-assets-animation-previews'
$wrongPreviewIntent = Join-Path $run 'wrong-library-preview.json'
(Get-Content -LiteralPath $atlasPreviewIntent -Raw).Replace($libraryId, [guid]::NewGuid().ToString()) |
    Set-Content -LiteralPath $wrongPreviewIntent -Encoding utf8
Invoke-Probe -Arguments @('animation-preview', $wrongPreviewIntent) -ExpectFailure | Out-Null
if (!$largePreview.looped -or $largePreview.frames.Count -ne 128 -or
    $largePreview.width -ne 64 -or $largePreview.height -ne 64 -or
    [Text.Encoding]::UTF8.GetByteCount($largeJson) -gt (4MB + 64KB) -or
    (Get-ChildItem -LiteralPath $previewRoot -Force)) {
    throw 'A long preview exceeded its budget, skipped frames or left temporary files'
}

$portable = & (Join-Path $PSScriptRoot 'verify-animation-png.ps1') -Run $run `
    -AtlasIntent $atlasPreviewIntent -SequenceIntent $sequencePreviewIntent `
    -ReferenceExport $first -ReferenceSequence $sequence -ProbeCommand ${function:Invoke-Probe}

$engineResult = $null
$managedInstall = $null
if ($Godot) {
    $engineData = Join-Path $run 'godot-user-data'
    New-Item -ItemType Directory -Path $engineData | Out-Null

    function Invoke-Godot([string[]]$Arguments) {
        $launch = [Diagnostics.ProcessStartInfo]::new($Godot)
        $launch.UseShellExecute = $false
        $launch.CreateNoWindow = $true
        $launch.RedirectStandardOutput = $true
        $launch.RedirectStandardError = $true
        $launch.Environment['APPDATA'] = $engineData
        $launch.Environment['LOCALAPPDATA'] = $engineData
        foreach ($argument in $Arguments) { $launch.ArgumentList.Add($argument) }
        $process = [Diagnostics.Process]::Start($launch)
        try {
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (!$process.WaitForExit(50000)) {
                $process.Kill($true)
                throw 'Godot acceptance process timed out'
            }
            return [pscustomobject]@{
                ExitCode = $process.ExitCode
                Output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
            }
        } finally {
            $process.Dispose()
        }
    }

    $version = Invoke-Godot @('--headless', '--version')
    if ($version.ExitCode -ne 0 -or $version.Output -notmatch '(?m)^4\.5\.1\.stable') {
        throw "Godot 4.5.1 stable required: $($version.Output)"
    }
    function Invoke-EngineCheck(
        [string]$Project, [string]$Label, [string]$Scene, [string]$Mode, [string[]]$Durations
    ) {
        $importLog = Join-Path $run "godot-$Label-import.log"
        $playLog = Join-Path $run "godot-$Label-play.log"
        $import = Invoke-Godot @('--headless', '--path', $Project, '--import')
        $import.Output | Set-Content -LiteralPath $importLog -Encoding utf8
        if ($import.ExitCode -ne 0 -or $import.Output -match '(?m)^(ERROR|SCRIPT ERROR):') {
            throw "Godot import failed. See $importLog"
        }
        $check = Join-Path $PSScriptRoot 'verify-animation.gd'
        $engineArguments = @('--headless', '--path', $Project, '--fixed-fps', '100',
                             '--quit-after', '200', '--script', $check, '--', $Scene, $Mode) +
                           $Durations
        $play = Invoke-Godot $engineArguments
        $play.Output | Set-Content -LiteralPath $playLog -Encoding utf8
        if ($play.ExitCode -ne 0 -or $play.Output -match '(?m)^(ERROR|SCRIPT ERROR):' -or
            $play.Output -notmatch 'animation playback verified') {
            throw "Godot playback failed. See $playLog"
        }
    }

    Invoke-EngineCheck $first 'standalone' 'res://preview.tscn' 'once' @('0.120', '0.245')
    $loopRecipe = Join-Path $run 'loop-recipe.json'
    $looped = Join-Path $run 'looped'
    @{looped=$true; frames=$sequenceFrames} | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $loopRecipe -Encoding utf8
    Invoke-Probe -Arguments @('animation-export-sequence', $loopRecipe, $looped) | Out-Null
    $consumer = Join-Path $run 'consumer'
    $relocated = Join-Path $consumer 'visuals/walk'
    $consumerScene = Join-Path $consumer 'consumer.tscn'
    $consumerProject = Join-Path $consumer 'project.godot'
    $consumerSceneResource = 'res://consumer.tscn'
    $relocatedFrames = Join-Path $relocated 'frames'
    New-Item -ItemType Directory -Path $relocatedFrames | Out-Null

    function Copy-ClipFixture([string]$From) {
        foreach ($resource in @('clip.tres', 'clip.tscn')) {
            Copy-Item -LiteralPath (Join-Path $From $resource) -Destination $relocated -Force
        }
        Get-ChildItem -LiteralPath (Join-Path $From 'frames') -File -Filter '*.png' |
            ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $relocatedFrames -Force }
    }

    Copy-ClipFixture $looped
    @'
[gd_scene load_steps=2 format=3]

[ext_resource type="PackedScene" path="res://visuals/walk/clip.tscn" id="1"]

[node name="Consumer" type="Node2D"]

[node name="Clip" parent="." instance=ExtResource("1")]
'@ | Set-Content -LiteralPath $consumerScene -Encoding utf8
    $consumerSettings = Get-Content -LiteralPath (Join-Path $looped 'project.godot') -Raw
    $consumerSettings.Replace('res://preview.tscn', $consumerSceneResource) |
        Set-Content -LiteralPath $consumerProject -Encoding utf8
    Invoke-EngineCheck $consumer 'relocated' $consumerSceneResource 'loop' @('0.120', '0.245')
    $consumerSceneHash = Get-Hash $consumerScene
    $consumerProjectHash = Get-Hash $consumerProject

    $updatedRecipe = Join-Path $run 'updated-recipe.json'
    $updated = Join-Path $run 'updated'
    @{looped=$true; frames=@($sequenceFrames[1], $sequenceFrames[0])} | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $updatedRecipe -Encoding utf8
    Invoke-Probe -Arguments @('animation-export-sequence', $updatedRecipe, $updated) | Out-Null
    # Only the generated resources inside this dedicated consumer fixture are replaced.
    Copy-ClipFixture $updated
    Invoke-EngineCheck $consumer 'reimported' $consumerSceneResource 'loop' @('0.245', '0.120')
    if ((Get-Hash $consumerScene) -ne $consumerSceneHash -or
        (Get-Hash $consumerProject) -ne $consumerProjectHash -or
        (Get-Hash (Join-Path $relocatedFrames 'frame-001.png')) -ne
        (Get-Hash (Join-Path $updated 'frames/frame-001.png'))) {
        throw 'Reimport changed the consumer project or left an earlier frame'
    }

    $installArguments = @{
        Run=$run; ConsumerProject=$consumerProject; ConsumerScene=$consumerScene
        ConsumerSceneResource=$consumerSceneResource; LibraryId=$libraryId; SequenceFrames=$sequenceFrames
        ReferencedFrame=$blueFrame
        ProbeCommand=${function:Invoke-Probe}; EngineCheck=${function:Invoke-EngineCheck}
    }
    $managedInstall = & (Join-Path $PSScriptRoot 'verify-animation-install.ps1') @installArguments
    $engineResult = $version.Output.Trim()
}

$receipt = [ordered]@{
    run = $run
    atlasSha256 = $atlasHash
    files = $inventory
    exportDeterministic = $true
    managedAndReferenceMatch = $true
    archivedReferenceMatchesOffline = $true
    pixelsVerified = $true
    invalidAndExistingDestinationsRejected = $true
    sequenceMatchesAtlasFrames = $true
    sequenceDeterministic = $true
    sequencePreservesOrderAndRepeatedRevisions = $true
    invalidSequenceRejected = $true
    unscaledPreviewMatchesExport = $true
    boundedPreviewFrames = $largePreview.frames.Count
    boundedPreviewWidth = $largePreview.width
    boundedPreviewHeight = $largePreview.height
    previewTemporaryFilesRemoved = $true
    previewLibraryMismatchRejected = $true
    portableExport = $portable
    godotVersion = $engineResult
    godotConsumerReferenceReimported = [bool]$engineResult
    godotManagedReferenceUpdated = [bool]$engineResult
    managedInstall = $managedInstall
}
$json = $receipt | ConvertTo-Json -Depth 5
$json | Set-Content -LiteralPath (Join-Path $run 'receipt.json') -Encoding utf8
$json
