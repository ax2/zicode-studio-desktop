# Inventories only the synthetic Issue #31 profile in this checkout.
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Initialize', 'CaptureBefore', 'CaptureAfter', 'StageInterruptedRestore', 'CheckRecovered',
        'SeedOfflineRestore', 'ChangeOfflineRestore', 'CheckRestoreQueued', 'CheckRestoreApplied')]
    [string]$Phase
)

$ErrorActionPreference = 'Stop'
$checkout = Split-Path $PSScriptRoot
$scratch = Join-Path $checkout '.cache/task-scratch/issue-31-data-retention'
$owner = 'ax2/zicode-studio-desktop#31 synthetic Windows retention fixture'
$utf8 = [Text.UTF8Encoding]::new($false)

function Assert-PlainPath([string]$Path) {
    for ($current = $Path; $current; $current = [IO.Path]::GetDirectoryName($current)) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Reparse point in fixture path: $current"
        }
    }
}

function Write-NewText([string]$Path, [string]$Value) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
    try {
        $bytes = $utf8.GetBytes($Value)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Dispose()
    }
}

Assert-PlainPath $scratch
$profile = Join-Path $scratch 'profile'
$ownerPath = Join-Path $scratch 'owner.txt'
$profileMarker = Join-Path $profile 'profile.json'
$marker = '{"schemaVersion":1,"kind":"zicode-isolated-desktop"}' + "`n"
if ($Phase -eq 'Initialize') {
    if (Test-Path -LiteralPath $scratch) { throw "Fixture directory already exists: $scratch" }
    New-Item -ItemType Directory -Path $profile | Out-Null
    Write-NewText $ownerPath $owner
    Write-NewText $profileMarker $marker
    $selector = Join-Path $scratch 'desktop-profile.template.json'
    Write-NewText $selector (@{schemaVersion = 1; profileRoot = $profile} | ConvertTo-Json)
    [pscustomobject]@{Profile = $profile; SelectorTemplate = $selector}
    return
}

foreach ($path in @($ownerPath, $profileMarker)) { Assert-PlainPath $path }
if ([IO.File]::ReadAllText($ownerPath) -cne $owner -or
    [IO.File]::ReadAllText($profileMarker) -cne $marker) {
    throw 'Synthetic fixture ownership markers do not match.'
}

if ($Phase -in @('SeedOfflineRestore', 'ChangeOfflineRestore', 'CheckRestoreQueued', 'CheckRestoreApplied')) {
    $notes = Join-Path $profile 'system/.zicode/notes'
    $attachment = Join-Path $notes 'public/attachments/issue-31/probe.txt'
    $note = Join-Path $notes 'issue-31-offline.md'
    $requestPath = Join-Path $profile 'system/workspace-restore-request.json'
    $resultPath = Join-Path $profile 'system/workspace-restore-result.json'
    $receiptPath = Join-Path $scratch 'offline-restore-queued.json'
    foreach ($path in @($note, $attachment, $requestPath, $resultPath, $receiptPath)) {
        Assert-PlainPath $path
    }
    $originalNote = '# Issue 31 snapshot'
    $originalAttachment = 'attachment from the snapshot'
    $currentNote = '# Issue 31 current'
    $currentAttachment = 'attachment before restore'
    switch ($Phase) {
        'SeedOfflineRestore' {
            New-Item -ItemType Directory -Path (Split-Path $attachment) -Force | Out-Null
            Write-NewText $note $originalNote
            Write-NewText $attachment $originalAttachment
        }
        'ChangeOfflineRestore' {
            if ([IO.File]::ReadAllText($note) -cne $originalNote -or
                [IO.File]::ReadAllText($attachment) -cne $originalAttachment) {
                throw 'Synthetic input changed unexpectedly.'
            }
            [IO.File]::WriteAllText($note, $currentNote, $utf8)
            [IO.File]::WriteAllText($attachment, $currentAttachment, $utf8)
        }
        'CheckRestoreQueued' {
            if ([IO.File]::ReadAllText($note) -cne $currentNote -or
                [IO.File]::ReadAllText($attachment) -cne $currentAttachment) {
                throw 'Queueing modified the live data.'
            }
            $request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json
            if ($request.requestId -notmatch '^[a-f0-9]{32}$' -or !$request.workspaceId -or !$request.backupId) {
                throw 'Invalid queued request.'
            }
            Write-NewText $receiptPath ($request | ConvertTo-Json)
        }
        'CheckRestoreApplied' {
            if (Test-Path -LiteralPath $requestPath) { throw 'Restore request is still pending.' }
            $request = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
            $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
            if ($result.requestId -cne $request.requestId -or $result.workspaceId -cne $request.workspaceId -or
                $result.report.backupId -cne $request.backupId -or !$result.report.preRestoreBackupId) {
                throw 'Restore result does not match the queued request.'
            }
            if ([IO.File]::ReadAllText($note) -cne $originalNote -or
                [IO.File]::ReadAllText($attachment) -cne $originalAttachment) {
                throw 'Restored fixture bytes do not match the snapshot.'
            }
            $result
        }
    }
    Get-FileHash -LiteralPath $note, $attachment -Algorithm SHA256
    return
}

if ($Phase -in @('StageInterruptedRestore', 'CheckRecovered')) {
    $root = Join-Path $profile 'system/.zicode'
    $pending = Join-Path $root '.restore-v2-pending-31acafe031acafe031acafe031acafe0'
    $notes = Join-Path $root 'notes'
    $markerName = 'issue-31-restore-sentinel.txt'
    foreach ($path in @($root, $pending, $notes)) { Assert-PlainPath $path }
    if ($Phase -eq 'StageInterruptedRestore') {
        if (Test-Path -LiteralPath $root) { throw 'Use a fresh synthetic profile for this phase.' }
        $previous = Join-Path $pending 'previous/notes'
        $next = Join-Path $pending 'next/notes'
        New-Item -ItemType Directory -Path $previous, $next | Out-Null
        Write-NewText (Join-Path $previous $markerName) 'original workspace bytes'
        Write-NewText (Join-Path $next $markerName) 'replacement snapshot bytes'
        Write-NewText (Join-Path $pending 'restore.json') '[{"app":"notes","had_previous":true}]'
        Get-Item -LiteralPath $pending
        return
    }
    $restored = Join-Path $notes $markerName
    Assert-PlainPath $restored
    if ((Test-Path -LiteralPath $pending) -or
        [IO.File]::ReadAllText($restored) -cne 'original workspace bytes') {
        throw 'Interrupted workspace restore was not rolled back.'
    }
    Get-FileHash -LiteralPath $restored -Algorithm SHA256
    return
}

# Only read these product stores. Credential, agent, scene and WebView
# directories are outside the inventory even if they exist in the fixture.
$stores = [ordered]@{
    Notes = 'system/.zicode/notes'
    Browser = 'data/browser'
    Plugins = 'data/plugins'
    Gallery = 'data/visual-assets'
    WorkspaceRegistry = 'system/metadata/picot.sqlite3'
}

function Get-StoreFiles([IO.FileSystemInfo]$Entry) {
    if ($Entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse point in fixture store: $($Entry.FullName)"
    }
    if ($Entry.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $Entry.FullName -Force) {
            Get-StoreFiles $child
        }
    } else {
        $Entry
    }
}

$files = @(
    foreach ($store in $stores.GetEnumerator()) {
        $path = Join-Path $profile $store.Value
        Assert-PlainPath $path
        $entries = @(Get-StoreFiles (Get-Item -LiteralPath $path -Force))
        if (!$entries.Count) { throw "Synthetic store has no files: $($store.Key)" }
        foreach ($file in $entries) {
            [pscustomobject]@{
                store = $store.Key
                path = [IO.Path]::GetRelativePath($profile, $file.FullName).Replace('\', '/')
                bytes = $file.Length
                sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            }
        }
    }
)
$files = @($files | Sort-Object -Property path -CaseSensitive)
$beforePath = Join-Path $scratch 'before.json'
if ($Phase -eq 'CaptureBefore') {
    Write-NewText $beforePath (ConvertTo-Json -InputObject $files -Depth 3)
    Get-Item -LiteralPath $beforePath
    return
}

Assert-PlainPath $beforePath
$before = @(Get-Content -LiteralPath $beforePath -Raw | ConvertFrom-Json)
$changes = @(Compare-Object $before $files -Property path, bytes, sha256 -CaseSensitive)
$reportPath = Join-Path $scratch 'after.json'
$report = @{files = $files; changes = $changes}
Write-NewText $reportPath ($report | ConvertTo-Json -Depth 5)
Get-Item -LiteralPath $reportPath
if ($changes.Count) {
    throw 'Store bytes changed. Check the receipt and verify preserved records in the app.'
}
