param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample,
    [Parameter(Mandatory)][string]$Reference
)

$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Sample = (Resolve-Path -LiteralPath $Sample).Path
$Reference = (Resolve-Path -LiteralPath $Reference).Path
$root = (New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot "../../.cache/task-scratch/visual-assets-characters-$([guid]::NewGuid())")).FullName

function New-FixtureFolder([string]$Name) {
    (New-Item -ItemType Directory -Path (Join-Path $root $Name)).FullName
}

function Invoke-CatalogProbe([string]$Profile, [string[]]$Arguments, [int]$Expected = 0) {
    $output = & $Probe $Profile @Arguments 2>&1
    if ($LASTEXITCODE -ne $Expected) { throw "Unexpected exit $LASTEXITCODE for $Arguments. $output. Evidence directory $root" }
    return ($output -join "`n")
}

$actionFile = Join-Path $root 'action.json'
function Invoke-CharacterAction($Action, [string]$Profile = $active, [string]$LibraryId = $libraryId, [int]$Expected = 0) {
    $Action | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $actionFile -Encoding utf8
    $output = Invoke-CatalogProbe $Profile @('character-action', $LibraryId, $actionFile) $Expected
    if ($Expected -eq 0) { return ($output | ConvertFrom-Json) }
    return $output
}

$active = New-FixtureFolder 'active'
$source = New-FixtureFolder 'source'
$original = Join-Path $source '角色参考.png'
Copy-Item -LiteralPath $Reference -Destination $original
$referenceHash = (Get-FileHash -LiteralPath $original).Hash.ToLowerInvariant()
$managedHash = (Get-FileHash -LiteralPath $Sample).Hash.ToLowerInvariant()
if ($referenceHash -eq $managedHash) { throw 'Use two distinct samples' }
$libraryId = Invoke-CatalogProbe $active @('library-id')
$managed = [long](Invoke-CatalogProbe $active @('import', $Sample))
$referenceItem = Invoke-CatalogProbe $active @('reference-import', $source, '角色参考.png') | ConvertFrom-Json
$referenceId = $referenceItem.assetId
$baselinePreview = Invoke-CatalogProbe $active @('reference-preview', [string]$referenceId) | ConvertFrom-Json
if ($referenceItem.status -ne 'imported') { throw 'Reference fixture did not import' }

$creation = @{kind='create';name='绘光';identity='绘制光源的旅人'}
$character = (Invoke-CharacterAction $creation).id
$index = Invoke-CharacterAction @{kind='list'}
if ($index.entries[0].id -ne $character -or $index.entries[0].name -ne $creation.name) { throw 'Character did not persist' }
foreach ($facet in @('appearance', 'style')) {
    $first = Invoke-CharacterAction @{kind='append';id=$character;facet=$facet;previous=$null;text="第一版 $facet"}
    $second = Invoke-CharacterAction @{kind='append';id=$character;facet=$facet;previous=1;text="第二版 $facet"}
    if ($first.version -ne 1 -or $second.version -ne 2) { throw 'Character versions are not independent' }
    $stale = Invoke-CharacterAction @{kind='append';id=$character;facet=$facet;previous=1;text='过时的编辑'} -Expected 1
    if ($stale -ne 'visual_assets_character_revision_changed') { throw 'A stale character edit was not rejected' }
}
$identity = @{kind='revisions';id=$character;facet='identity'}
$style = @{kind='revisions';id=$character;facet='style'}
if ((Invoke-CharacterAction $identity).entries.Count -ne 1 -or
    ((Invoke-CharacterAction $style).entries.version -join ',') -ne '2,1') { throw 'Identity and style history changed' }
$identitySecond = Invoke-CharacterAction @{kind='append';id=$character;facet='identity';previous=1;text='记录光源的旅人'}
$firstStyle = Invoke-CharacterAction @{kind='revisions';id=$character;facet='style';before=1}
if ($identitySecond.version -ne 2 -or (Invoke-CharacterAction $identity).entries[1].text -ne $creation.identity -or
    $firstStyle.entries.Count -ne 1 -or $firstStyle.entries[0].version -ne 1) { throw 'Older identity or style versions could not be read' }
$wrongLibrary = Invoke-CharacterAction $identity -LibraryId ([guid]::NewGuid().ToString()) -Expected 1
if ($wrongLibrary -ne 'visual_assets_library_changed') { throw 'A mismatched library read a character' }

$approval = @{kind='approveReferences';id=$character;requestId=[guid]::NewGuid().ToString();name='已审参考';references=@(
    @{assetId=$referenceId;revision=1}, @{assetId=$managed;revision=1}
)}
$sets = @{kind='referenceSets';id=$character}
$bad = $approval.Clone()
$bad.references = @($approval.references[0], @{assetId=$managed;revision=99})
Invoke-CharacterAction $bad -Expected 1 | Out-Null
$page = Invoke-CatalogProbe $active @('list') | ConvertFrom-Json
if (($page.assets | Where-Object id -eq $referenceId).archivedReference) { throw 'An invalid approval archived an original' }

$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'original-published'
try { Invoke-CharacterAction $approval -Expected 86 | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
$page = Invoke-CatalogProbe $active @('list') | ConvertFrom-Json
if (($page.assets | Where-Object id -eq $referenceId).archivedReference -or (Invoke-CharacterAction $sets).entries.Count) {
    throw 'An interrupted original publication left an approved set'
}
$env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT = 'reference-set-committed'
try { Invoke-CharacterAction $approval -Expected 86 | Out-Null }
finally { Remove-Item Env:ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT }
$saved = Invoke-CharacterAction $sets
$retried = Invoke-CharacterAction $approval
if ($saved.entries.Count -ne 1 -or $retried.id -ne $saved.entries[0].id -or
    ($saved.entries[0].references.assetId -join ',') -ne "$referenceId,$managed" -or
    ($saved.entries[0].references.sha256 -join ',') -ne "$referenceHash,$managedHash") {
    throw 'The approved set changed order, originals, or identity after retry'
}
$conflict = $approval.Clone()
$conflict.name = 'Different set'
if ((Invoke-CharacterAction $conflict -Expected 1) -ne 'visual_assets_character_reference_conflict') {
    throw 'A repeated approval key modified a saved set'
}

$offline = Join-Path $source 'temporarily-offline.png'
Move-Item -LiteralPath $original -Destination $offline
try {
    $backup = Invoke-CatalogProbe $active @('backup-default', (New-FixtureFolder 'backup')) | ConvertFrom-Json
    $snapshot = Join-Path $backup.destination 'snapshot'
    $manifest = Get-Content -LiteralPath (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
    if ($backup.state -ne 'completed' -or $manifest.version -ne 4 -or $manifest.blobCount -ne 2) { throw 'Default backup lost approved originals or character records' }
    $restored = New-FixtureFolder 'restored'
    $restore = Invoke-CatalogProbe $restored @('restore-default', $snapshot) | ConvertFrom-Json
    $restoredSet = Invoke-CharacterAction $sets -Profile $restored
    $restoredPreview = Invoke-CatalogProbe $restored @('reference-preview', [string]$referenceId) | ConvertFrom-Json
    if ($restore.state -ne 'completed' -or ($restoredSet | ConvertTo-Json -Depth 8 -Compress) -ne ($saved | ConvertTo-Json -Depth 8 -Compress) -or
        (Invoke-CharacterAction $style -Profile $restored).entries[1].text -ne '第一版 style' -or
        $restoredPreview.base64 -ne $baselinePreview.base64) { throw 'Offline restore changed the approved set, preview or older version' }

    $charactersOnly = New-FixtureFolder 'characters-only'
    $otherLibrary = Invoke-CatalogProbe $charactersOnly @('library-id')
    $other = (Invoke-CharacterAction $creation -Profile $charactersOnly -LibraryId $otherLibrary).id
    Invoke-CatalogProbe $charactersOnly @('restore-default', $snapshot) 1 | Out-Null
    if ((Invoke-CharacterAction @{kind='list'} -Profile $charactersOnly -LibraryId $otherLibrary).entries[0].id -ne $other) {
        throw 'Restore overwrote a library containing only character data'
    }
} finally {
    Move-Item -LiteralPath $offline -Destination $original
}
if ((Get-FileHash -LiteralPath $original).Hash.ToLowerInvariant() -ne $referenceHash) { throw 'Approval changed the external original' }

$receipt = [ordered]@{
    run=$root; character=$character; approvedSet=$saved.entries[0]; snapshotVersion=$manifest.version
    staleEditsRejected=$true; interruptedPublicationRecovered=$true; approvalRetryWasIdempotent=$true
    offlineBackupAndRestoreVerified=$true; characterOnlyRestoreRejected=$true
}
$json = $receipt | ConvertTo-Json -Depth 8
$json | Set-Content -LiteralPath (Join-Path $root 'receipt.json') -Encoding utf8
$json
