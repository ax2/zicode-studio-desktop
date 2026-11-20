param(
    [Parameter(Mandatory)][string]$Run,
    [Parameter(Mandatory)][string]$ConsumerProject,
    [Parameter(Mandatory)][string]$ConsumerScene,
    [Parameter(Mandatory)][string]$ConsumerSceneResource,
    [Parameter(Mandatory)][string]$LibraryId,
    [Parameter(Mandatory)][object[]]$SequenceFrames,
    [Parameter(Mandatory)][string]$ReferencedFrame,
    [Parameter(Mandatory)][scriptblock]$ProbeCommand,
    [Parameter(Mandatory)][scriptblock]$EngineCheck
)

$ErrorActionPreference = 'Stop'

function Get-Hash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$managedProject = Join-Path $run 'managed-consumer'
New-Item -ItemType Directory -Path $managedProject | Out-Null
$managedConfig = Join-Path $managedProject 'project.godot'
$managedScene = Join-Path $managedProject 'consumer.tscn'
$managedReference = 'res://zicode-animation-walk/clip.tscn'
Copy-Item -LiteralPath $consumerProject -Destination $managedConfig
(Get-Content -LiteralPath $consumerScene -Raw).Replace('res://visuals/walk/clip.tscn', $managedReference) |
    Set-Content -LiteralPath $managedScene -Encoding utf8
$slot = Join-Path $managedProject 'zicode-animation-walk'
$initialIntent = Join-Path $run 'install-first.json'
$updateIntent = Join-Path $run 'install-update.json'
@{
    libraryId=$libraryId; source=@{kind='sequence'}
    recipe=@{looped=$true;frames=$sequenceFrames}
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $initialIntent -Encoding utf8
@{
    libraryId=$libraryId; source=@{kind='sequence'}
    recipe=@{looped=$true;frames=@($sequenceFrames[1],$sequenceFrames[0])}
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $updateIntent -Encoding utf8

$newPlan = & $ProbeCommand -Arguments @('animation-install-plan', $managedProject, 'walk') |
    ConvertFrom-Json
if ($newPlan.previous -or $newPlan.resourcePath -ne $managedReference -or (Test-Path -LiteralPath $slot)) {
    throw 'Reviewing a new installation changed the project'
}
$installed = & $ProbeCommand -Arguments @('animation-install', $managedProject, 'walk', $initialIntent, 'new') |
    ConvertFrom-Json
if ($installed.state -ne 'completed') { throw 'The managed animation was not installed' }
& $EngineCheck $managedProject 'installed' $consumerSceneResource 'loop' @('0.120','0.245')
$configHash = Get-Hash $managedConfig
$sceneHash = Get-Hash $managedScene
$oldPointer = Get-Hash (Join-Path $slot 'clip.tscn')
$oldVersion = (& $ProbeCommand -Arguments @('animation-install-plan', $managedProject, 'walk') |
    ConvertFrom-Json).previous
$oldManifest = Join-Path $slot "versions/$oldVersion/manifest.json"
$updateArgs = @('animation-install', $managedProject, 'walk', $updateIntent, $oldVersion)
$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'animation-ready'
try { & $ProbeCommand -Arguments $updateArgs -ExpectFailure | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
$oldStage = @(Get-ChildItem -LiteralPath $managedProject -Directory -Force -Filter '.zicode-animation-*')
if ($oldStage.Count -ne 1) { throw 'No managed update stage remained after the injected fault' }
$interrupted = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
if ($interrupted.state -ne 'interrupted' -or (Get-Hash (Join-Path $slot 'clip.tscn')) -ne $oldPointer -or
    (Test-Path -LiteralPath $oldStage[0].FullName)) {
    throw 'An interrupted update replaced the previous scene'
}
$offlineFrame = Join-Path $run 'offline-retry-frame.png'
$frameHash = Get-Hash $ReferencedFrame
Move-Item -LiteralPath $ReferencedFrame -Destination $offlineFrame
try {
    & $ProbeCommand -Arguments @('animation-preview', $updateIntent) -ExpectFailure | Out-Null
    $retry = & $ProbeCommand -Arguments @('animation-retry-plan', $interrupted.id, $managedProject) |
        ConvertFrom-Json
    if ($retry.installPrevious -ne $oldVersion -or $retry.intent.recipe.frames[0].durationMs -ne 245 -or
        (Get-Hash (Join-Path $slot 'clip.tscn')) -ne $oldPointer) {
        throw 'Retry review changed the project or lost the saved installation'
    }
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'animation-reusing-version'
    try {
        & $ProbeCommand -Arguments @('animation-retry', $interrupted.id, $managedProject) -ExpectFailure |
            Out-Null
    } finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $secondAttempt = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
    if ($secondAttempt.state -ne 'interrupted' -or $secondAttempt.phase -ne 'animation-reusing-version' -or
        $secondAttempt.id -eq $interrupted.id -or (Get-Hash (Join-Path $slot 'clip.tscn')) -ne $oldPointer) {
        throw 'An interrupted retry lost the checkpoint or changed the installed scene'
    }
    $env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'animation-published'
    try {
        & $ProbeCommand -Arguments @('animation-retry', $secondAttempt.id, $managedProject) -ExpectFailure |
            Out-Null
    } finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
    $reconciled = & $ProbeCommand -Arguments @('job-status') | ConvertFrom-Json
    if ($reconciled.state -ne 'completed' -or $reconciled.id -eq $secondAttempt.id -or
        $reconciled.destination -ne $interrupted.destination) {
        throw 'The installed retry did not reconcile with the reference offline'
    }
} finally {
    Move-Item -LiteralPath $offlineFrame -Destination $ReferencedFrame
}
if ((Get-Hash $ReferencedFrame) -ne $frameHash) { throw 'The referenced frame changed' }
$newVersion = (& $ProbeCommand -Arguments @('animation-install-plan', $managedProject, 'walk') |
    ConvertFrom-Json).previous
& $EngineCheck $managedProject 'managed-update' $consumerSceneResource 'loop' @('0.245','0.120')
& $ProbeCommand -Arguments $updateArgs -ExpectFailure | Out-Null
$newPointer = Get-Hash (Join-Path $slot 'clip.tscn')
& $ProbeCommand -Arguments @('animation-install', $managedProject, 'walk', $updateIntent, $newVersion) |
    Out-Null
if ($oldVersion -eq $newVersion -or (Get-Hash $oldManifest) -ne $oldVersion -or
    (Get-Hash $managedConfig) -ne $configHash -or (Get-Hash $managedScene) -ne $sceneHash -or
    (Get-Hash (Join-Path $slot 'clip.tscn')) -ne $newPointer -or
    @(Get-ChildItem -LiteralPath (Join-Path $slot 'versions') -Directory).Count -ne 2) {
    throw 'Updating or retrying changed the project or lost a version'
}
$unmanaged = Join-Path $managedProject 'zicode-animation-unmanaged'
New-Item -ItemType Directory -Path $unmanaged | Out-Null
$userScene = Join-Path $unmanaged 'clip.tscn'
'user-owned file' | Set-Content -LiteralPath $userScene
& $ProbeCommand -Arguments @('animation-install-plan', $managedProject, 'unmanaged') -ExpectFailure |
    Out-Null
if ((Get-Content -LiteralPath $userScene) -ne 'user-owned file') {
    throw 'An unmanaged scene was changed'
}
$edited = Join-Path $managedProject 'zicode-animation-edited'
Copy-Item -LiteralPath $slot -Destination $edited -Recurse
$editedScene = Join-Path $edited 'clip.tscn'
Add-Content -LiteralPath $editedScene -Value '# user edit'
$editedHash = Get-Hash $editedScene
& $ProbeCommand -Arguments @('animation-install-plan', $managedProject, 'edited') -ExpectFailure |
    Out-Null
if ((Get-Hash $editedScene) -ne $editedHash) { throw 'An edited managed scene was changed' }
[ordered]@{
    resourcePath=$managedReference
    firstVersion=$oldVersion
    updatedVersion=$newVersion
    firstPointerSha256=$oldPointer
    updatedPointerSha256=$newPointer
    consumerSceneSha256=$sceneHash
    projectConfigSha256=$configHash
    preSwitchInterrupted=$true
    postSwitchReconciled=$true
    resumedWithSourceOffline=$true
    inheritedCheckpointAfterSecondInterruption=$true
    interruptedStageRecovered=$true
    repeatedRecipeReusedVersion=$true
    stalePlanAndUserEditsRejected=$true
}
