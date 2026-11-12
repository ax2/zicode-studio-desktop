param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample
)

$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Sample = (Resolve-Path -LiteralPath $Sample).Path
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$run = Join-Path $repo ".cache/task-scratch/visual-assets-animation-job-$([guid]::NewGuid())"
$profile = Join-Path $run 'profile'
New-Item -ItemType Directory -Path $profile | Out-Null

function Invoke-Probe([string[]]$Arguments, [int]$Expected = 0) {
    $output = & $Probe $profile @Arguments 2>&1
    if ($LASTEXITCODE -ne $Expected) {
        throw "Unexpected probe exit $LASTEXITCODE for $Arguments. See $run. $output"
    }
    return ($output -join "`n")
}

function Export-Interrupted([string]$Destination, [string]$Intent, [string]$Phase) {
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = $Phase
    try { Invoke-Probe @('animation-job', $Destination, $Intent) 86 | Out-Null }
    finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
}

function Get-Published([string]$Parent) {
    return Get-ChildItem -LiteralPath $Parent -Directory -Filter 'godot-animation-*'
}

function Get-AnimationStage([string]$Parent) {
    return Get-ChildItem -LiteralPath $Parent -Force -Directory -Filter '.zicode-animation-*'
}

$library = Invoke-Probe @('library-id')
$sourceHash = (Get-FileHash -LiteralPath $Sample).Hash
$asset = [long](Invoke-Probe @('import', $Sample))
$atlas = Join-Path $run 'atlas.json'
$sequence = Join-Path $run 'sequence.json'
$wrongLibrary = Join-Path $run 'wrong-library.json'
@{
    libraryId = $library
    source = @{kind='atlas'; assetId=$asset; revision=1}
    recipe = @{looped=$false; frames=@(@{x=0; y=0; width=1; height=1; durationMs=125; anchorX=0; anchorY=0})}
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $atlas -Encoding utf8
@{
    libraryId = $library
    source = @{kind='sequence'}
    recipe = @{looped=$true; frames=@(@{assetId=$asset; revision=1; durationMs=245; anchorX=0; anchorY=0})}
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $sequence -Encoding utf8
(Get-Content -LiteralPath $atlas -Raw).Replace($library, [guid]::NewGuid().ToString()) |
    Set-Content -LiteralPath $wrongLibrary -Encoding utf8

$completed = Join-Path $run 'completed'
$cancelled = Join-Path $run 'cancelled'
$beforeRename = Join-Path $run 'before-rename'
$afterRename = Join-Path $run 'after-rename'
$modified = Join-Path $run 'modified'
$wrong = Join-Path $run 'wrong-library'
$beforeInputs = Join-Path $run 'before-inputs'
$changedStage = Join-Path $run 'changed-stage'
$replacedStage = Join-Path $run 'replaced-stage'
$firstInstall = Join-Path $run 'first-install'
New-Item -ItemType Directory -Path $completed, $cancelled, $beforeRename, $afterRename, $modified, $wrong, $beforeInputs, $changedStage, $replacedStage, $firstInstall |
    Out-Null

$success = Invoke-Probe @('animation-job', $completed, $atlas) | ConvertFrom-Json
$published = @(Get-Published $completed)
if ($success.state -ne 'completed' -or $success.phase -ne 'animation-published' -or
    $success.operation -ne 'animation' -or $published.Count -ne 1 -or (Get-AnimationStage $completed)) {
    throw 'The atlas job did not publish'
}
$manifest = Get-Content -LiteralPath (Join-Path $published[0].FullName 'manifest.json') -Raw |
    ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.atlasSha256 -ne $sourceHash) {
    throw 'The atlas job rendered a different source'
}

$cancellation = Invoke-Probe @('animation-job-cancel', $cancelled, $atlas) | ConvertFrom-Json
if ($cancellation.state -ne 'cancelled' -or (Get-ChildItem -LiteralPath $cancelled -Force)) {
    throw 'Cancelling an animation job left output'
}

Export-Interrupted $beforeRename $atlas 'animation-ready'
$stage = @(Get-AnimationStage $beforeRename)
if ($stage.Count -ne 1 -or !(Test-Path -LiteralPath (Join-Path $stage[0].FullName 'project/manifest.json'))) {
    throw 'No rendered stage was left by the injected interruption'
}
$unpublished = Invoke-Probe @('job-status') | ConvertFrom-Json
if ($unpublished.state -ne 'interrupted' -or $unpublished.phase -ne 'animation-ready' -or
    (Get-Published $beforeRename) -or (Get-AnimationStage $beforeRename)) {
    throw 'An interrupted export was resumed or incorrectly reported complete'
}

Invoke-Probe @('animation-retry-plan', $unpublished.id, $wrong) 1 | Out-Null
$retryPlan = Invoke-Probe @('animation-retry-plan', $unpublished.id, $beforeRename) |
    ConvertFrom-Json
if ($retryPlan.destination -ne $unpublished.destination -or
    $retryPlan.intent.source.assetId -ne $asset -or
    $retryPlan.intent.recipe.frames[0].durationMs -ne 125 -or (Get-Published $beforeRename)) {
    throw 'Review changed the destination or lost the saved recipe'
}
$retried = Invoke-Probe @('animation-retry', $unpublished.id, $beforeRename) | ConvertFrom-Json
if ($retried.state -ne 'completed' -or $retried.id -eq $unpublished.id -or
    $retried.destination -ne $unpublished.destination -or @(Get-Published $beforeRename).Count -ne 1 -or
    (Get-FileHash -LiteralPath (Join-Path $retried.destination 'manifest.json')).Hash -ne
    (Get-FileHash -LiteralPath (Join-Path $success.destination 'manifest.json')).Hash) {
    throw 'Retry did not reproduce the saved recipe in the original destination'
}
Invoke-Probe @('animation-retry', $unpublished.id, $beforeRename) 1 | Out-Null

Export-Interrupted $afterRename $sequence 'animation-published'
$reconciled = Invoke-Probe @('job-status') | ConvertFrom-Json
$recovered = @(Get-Published $afterRename)
if ($reconciled.state -ne 'completed' -or $reconciled.phase -ne 'animation-published' -or
    $recovered.Count -ne 1 -or (Get-AnimationStage $afterRename)) {
    throw 'A verified published sequence did not reconcile'
}
$manifest = Get-Content -LiteralPath (Join-Path $recovered[0].FullName 'manifest.json') -Raw |
    ConvertFrom-Json
if ($manifest.schemaVersion -ne 2 -or $manifest.frameSourceSha256[0] -ne $sourceHash) {
    throw 'The sequence job rendered a different source'
}

Export-Interrupted $modified $atlas 'animation-published'
$changed = @(Get-Published $modified)
if ($changed.Count -ne 1) { throw 'Expected a published package before modifying its test fixture' }
Add-Content -LiteralPath (Join-Path $changed[0].FullName 'clip.tscn') -Value '# fixture edit'
$unverified = Invoke-Probe @('job-status') | ConvertFrom-Json
if ($unverified.state -ne 'interrupted') { throw 'A changed package was incorrectly reconciled' }
Invoke-Probe @('animation-retry-plan', $unverified.id, $modified) 1 | Out-Null

$unrelatedStage = Join-Path $beforeInputs ".zicode-animation-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $unrelatedStage | Out-Null
$unrelated = Join-Path $unrelatedStage 'recipe.json'
'user file' | Set-Content -LiteralPath $unrelated
Export-Interrupted $beforeInputs $atlas 'animation-stage-created'
if (@(Get-AnimationStage $beforeInputs).Count -ne 2) { throw 'Early fault did not leave an empty stage' }
$early = Invoke-Probe @('job-status') | ConvertFrom-Json
if ($early.state -ne 'interrupted' -or $early.phase -ne 'animation-stage-created' -or
    @(Get-AnimationStage $beforeInputs).Count -ne 1 -or (Get-Content -LiteralPath $unrelated) -ne 'user file') {
    throw 'Recovery did not remove only the journaled empty stage'
}

Export-Interrupted $changedStage $atlas 'animation-ready'
$stage = @(Get-AnimationStage $changedStage)[0].FullName
$unexpected = Join-Path $stage 'personal.txt'
$owned = Join-Path $stage 'atlas.input'
'user file' | Set-Content -LiteralPath $unexpected
Invoke-Probe @('job-status') | Out-Null
if ((Get-Content -LiteralPath $unexpected) -ne 'user file' -or !(Test-Path -LiteralPath $owned)) {
    throw 'An unexpected file did not preserve the stage'
}
Remove-Item -LiteralPath $unexpected
$handle = [IO.File]::Open($owned, 'Open', 'Read', 'None')
try {
    Invoke-Probe @('job-status') | Out-Null
    if (!(Test-Path -LiteralPath (Join-Path $stage 'project/manifest.json'))) {
        throw 'A file in use did not preserve the stage'
    }
} finally { $handle.Dispose() }
Invoke-Probe @('job-status') | Out-Null
if (Get-AnimationStage $changedStage) { throw 'Recovery did not retry after the file was released' }

Export-Interrupted $replacedStage $atlas 'animation-ready'
$stage = @(Get-AnimationStage $replacedStage)[0].FullName
$stopped = Join-Path $replacedStage 'original-stage'
$verifiedParent = (Resolve-Path -LiteralPath $replacedStage).Path
$stage = (Resolve-Path -LiteralPath $stage).Path
if ((Split-Path -Parent $stage) -ne $verifiedParent -or
    (Split-Path -Parent ([IO.Path]::GetFullPath($stopped))) -ne $verifiedParent -or
    (Test-Path -LiteralPath $stopped)) {
    throw 'Invalid staging fixture path'
}
Move-Item -LiteralPath $stage -Destination $stopped
New-Item -ItemType Directory -Path $stage | Out-Null
$replacement = Join-Path $stage 'recipe.json'
'replacement file' | Set-Content -LiteralPath $replacement
Invoke-Probe @('job-status') | Out-Null
if ((Get-Content -LiteralPath $replacement) -ne 'replacement file' -or
    !(Test-Path -LiteralPath (Join-Path $stopped 'atlas.input'))) {
    throw 'A different directory was treated as the journaled stage'
}

$project = Join-Path $firstInstall 'project.godot'
'config_version=5' | Set-Content -LiteralPath $project
$projectHash = (Get-FileHash -LiteralPath $project).Hash
$installSlot = Join-Path $firstInstall 'zicode-animation-first'
$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'animation-ready'
try { Invoke-Probe @('animation-install', $firstInstall, 'first', $sequence, 'new') 86 | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
$stage = @(Get-AnimationStage $firstInstall)
if ($stage.Count -ne 1 -or !(Test-Path -LiteralPath (Join-Path $stage[0].FullName 'slot/versions'))) {
    throw 'The first installation fault did not leave a nested managed slot'
}
$firstInterrupted = Invoke-Probe @('job-status') | ConvertFrom-Json
if ($firstInterrupted.state -ne 'interrupted' -or (Get-AnimationStage $firstInstall) -or
    (Test-Path -LiteralPath $installSlot)) {
    throw 'Recovery did not remove the nested stage for a first installation'
}
$installed = Invoke-Probe @('animation-retry', $firstInterrupted.id, $firstInstall) | ConvertFrom-Json
if ($installed.state -ne 'completed' -or (Get-AnimationStage $firstInstall) -or
    !(Test-Path -LiteralPath (Join-Path $installSlot 'clip.tscn')) -or
    (Get-FileHash -LiteralPath $project).Hash -ne $projectHash) {
    throw 'Retry did not install the nested slot in the unchanged Godot project'
}

Invoke-Probe @('animation-job', $wrong, $wrongLibrary) 1 | Out-Null
$mismatch = Invoke-Probe @('job-status') | ConvertFrom-Json
if ($mismatch.state -ne 'failed' -or (Get-ChildItem -LiteralPath $wrong -Force) -or
    (Get-FileHash -LiteralPath $Sample).Hash -ne $sourceHash) {
    throw 'A mismatched library exported or changed the source'
}

$receipt = [ordered]@{
    run = $run
    atlas = $success
    cancelled = $cancellation
    unpublished = $unpublished
    retried = $retried
    emptyStageRecovered = $true
    readyStageRecovered = $true
    unrelatedAndReplacedDirectoriesPreserved = $true
    unexpectedAndInUseFilesPreserved = $true
    interruptedFirstInstallStageRecovered = $true
    reconciled = $reconciled
    unverified = $unverified
    libraryMismatch = $mismatch
    sourceSha256 = $sourceHash.ToLowerInvariant()
}
$json = $receipt | ConvertTo-Json -Depth 5
$json | Set-Content -LiteralPath (Join-Path $run 'receipt.json') -Encoding utf8
$json
