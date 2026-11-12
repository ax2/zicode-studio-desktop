param(
    [Parameter(Mandatory)][string]$Probe,
    [Parameter(Mandatory)][string]$Sample
)

$ErrorActionPreference = 'Stop'
$Probe = (Resolve-Path -LiteralPath $Probe).Path
$Sample = (Resolve-Path -LiteralPath $Sample).Path
$root = (New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot "../../.cache/task-scratch/visual-assets-recipes-$([guid]::NewGuid())")).FullName

function New-FixtureFolder([string]$Name) {
    (New-Item -ItemType Directory -Path (Join-Path $root $Name)).FullName
}

function Invoke-RecipeProbe([string]$Profile, [string[]]$Arguments, [int]$Expected = 0) {
    $output = & $Probe $Profile @Arguments 2>&1
    if ($LASTEXITCODE -ne $Expected) { throw "Unexpected exit $LASTEXITCODE for $Arguments. $output. Evidence directory $root" }
    return ($output -join "`n")
}

$actionFile = Join-Path $root 'action.json'
function Invoke-RecipeAction($Action, [string]$Profile = $active, [int]$Expected = 0) {
    $Action | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $actionFile -Encoding utf8
    $output = Invoke-RecipeProbe $Profile @('character-action', $libraryId, $actionFile) $Expected
    if ($Expected -eq 0) { return ($output | ConvertFrom-Json) }
    return $output
}

function New-ApprovedSet([string]$Character, [string]$Name) {
    (Invoke-RecipeAction @{kind='approveReferences';id=$Character;requestId=[guid]::NewGuid().ToString();name=$Name;references=@(@{assetId=$asset;revision=1})}).id
}

function Save-FixtureSnapshot([string]$Folder, [int]$Version) {
    $job = Invoke-RecipeProbe $active @('backup-default', (New-FixtureFolder $Folder)) | ConvertFrom-Json
    $snapshot = Join-Path $job.destination 'snapshot'
    $manifest = Get-Content -LiteralPath (Join-Path $snapshot 'manifest.json') -Raw | ConvertFrom-Json
    if ($job.state -ne 'completed' -or $manifest.version -ne $Version) { throw 'Unexpected snapshot format' }
    return $snapshot
}

$active = New-FixtureFolder 'active'
$libraryId = Invoke-RecipeProbe $active @('library-id')
$asset = [long](Invoke-RecipeProbe $active @('import', $Sample))
$originalHash = (Get-FileHash -LiteralPath $Sample).Hash.ToLowerInvariant()
$character = (Invoke-RecipeAction @{kind='create';name='夜灯';identity='点灯人'}).id
$other = (Invoke-RecipeAction @{kind='create';name='另一角色';identity='守门人'}).id
Invoke-RecipeAction @{kind='append';id=$character;facet='appearance';previous=$null;text='蓝色外套'} | Out-Null
Invoke-RecipeAction @{kind='append';id=$character;facet='style';previous=$null;text='水彩'} | Out-Null
$set = New-ApprovedSet $character '蓝色外套参考'
$foreignSet = New-ApprovedSet $other '其他角色参考'
$catalog = @{kind='recipes';id=$character}
$legacy = Save-FixtureSnapshot 'legacy-backup' 4
$restoredLegacy = New-FixtureFolder 'restored-v4'
$restored = Invoke-RecipeProbe $restoredLegacy @('restore-default', $legacy) | ConvertFrom-Json
if ($restored.state -ne 'completed' -or (Invoke-RecipeAction $catalog -Profile $restoredLegacy).entries.Count) {
    throw 'A version 4 library failed to open as a library without recipes'
}

$settings = '{ "seed": 9223372036854775807, "steps": 24, "size": [512, 768] }'
$draft = @{identityVersion=1;appearanceVersion=1;styleVersion=1;referenceSetId=$set;prompt='夜景';negativePrompt='雾';settingsJson=$settings}
$create = @{kind='createRecipe';id=$character;name='街角场景';draft=$draft}
foreach ($invalid in @(@{referenceSetId=$foreignSet}, @{appearanceVersion=2})) {
    $bad = $create.Clone()
    $bad.draft = $draft.Clone()
    foreach ($key in $invalid.Keys) { $bad.draft[$key] = $invalid[$key] }
    if ((Invoke-RecipeAction $bad -Expected 1) -ne 'visual_assets_recipe_inputs_invalid') { throw 'Invalid input was accepted' }
}
$invalidJson = $create.Clone()
$invalidJson.draft = $draft.Clone()
$invalidJson.draft.settingsJson = '[1,2]'
if ((Invoke-RecipeAction $invalidJson -Expected 1) -ne 'visual_assets_recipe_settings_invalid' -or
    (Invoke-RecipeAction $catalog).entries.Count) { throw 'Rejected recipes left partial records' }

$first = Invoke-RecipeAction $create
$recipeId = $first.id
foreach ($facet in @('identity','appearance','style')) {
    Invoke-RecipeAction @{kind='append';id=$character;facet=$facet;previous=1;text="新 $facet"} | Out-Null
}
$secondSet = New-ApprovedSet $character '新版参考'
$readFirst = @{kind='recipeInputs';id=$character;recipeId=$recipeId;version=1}
$frozen = Invoke-RecipeAction $readFirst
if ($frozen.identity -ne '点灯人' -or $frozen.appearance -ne '蓝色外套' -or $frozen.style -ne '水彩' -or
    $frozen.recipe.draft.settingsJson -cne $settings -or $frozen.referenceSet.id -ne $set -or
    $frozen.referenceSet.references[0].sha256 -ne $originalHash) { throw 'The first recipe resolved current inputs in place of saved ones' }

$newDraft = $draft.Clone()
$newDraft.identityVersion = 2
$newDraft.appearanceVersion = $null
$newDraft.referenceSetId = $secondSet
$newDraft.prompt = '清晨'
$append = @{kind='appendRecipe';id=$character;recipeId=$recipeId;previous=1;draft=$newDraft}
$second = Invoke-RecipeAction $append
if ($second.version -ne 2 -or (Invoke-RecipeAction $append -Expected 1) -ne 'visual_assets_recipe_version_changed') {
    throw 'Recipe versioning accepted a stale write'
}
$foreignRead = $readFirst.Clone()
$foreignRead.id = $other
if ((Invoke-RecipeAction $foreignRead -Expected 1) -ne 'visual_assets_recipe_missing') { throw 'Another character could read this recipe' }

$snapshot = Save-FixtureSnapshot 'recipe-backup' 5
$restoredRecipes = New-FixtureFolder 'restored-v5'
$restored = Invoke-RecipeProbe $restoredRecipes @('restore-default', $snapshot) | ConvertFrom-Json
$restoredFirst = Invoke-RecipeAction $readFirst -Profile $restoredRecipes
$readSecond = $readFirst.Clone()
$readSecond.version = 2
$restoredSecond = Invoke-RecipeAction $readSecond -Profile $restoredRecipes
$versions = Invoke-RecipeAction @{kind='recipeVersions';id=$character;recipeId=$recipeId;before=1} -Profile $restoredRecipes
if ($restored.state -ne 'completed' -or ($restoredFirst | ConvertTo-Json -Depth 8 -Compress) -cne ($frozen | ConvertTo-Json -Depth 8 -Compress) -or
    $restoredSecond.identity -ne '新 identity' -or $null -ne $restoredSecond.appearance -or
    $restoredSecond.referenceSet.id -ne $secondSet -or $restoredSecond.recipe.draft.prompt -ne '清晨' -or
    $versions.entries.Count -ne 1 -or $versions.entries[0].version -ne 1) { throw 'Restore lost a pinned recipe input or history' }

$receipt = [ordered]@{
    run=$root; recipe=$recipeId; legacySnapshotVersion=4; recipeSnapshotVersion=5
    pinnedInputsVerified=$true; settingsPreservedExactly=$true; staleWriteRejected=$true
    invalidAndForeignInputsRejected=$true; restoredRecipeHistoryVerified=$true
}
$json = $receipt | ConvertTo-Json
$json | Set-Content -LiteralPath (Join-Path $root 'receipt.json') -Encoding utf8
$json
