$ErrorActionPreference = 'Stop'
if ($env:RUNNER_OS -ne 'Windows') { throw 'Windows runner required' }
if ($env:CANDIDATE_RUN -notmatch '^\d+$') { throw 'Invalid candidate run' }
$base = Join-Path $env:RUNNER_TEMP 'studio-original-candidate'
$download = Join-Path $env:RUNNER_TEMP 'studio-existing-installer'
$unpacked = Join-Path $env:RUNNER_TEMP 'studio-existing-unpacked'
$output = Join-Path $env:RUNNER_TEMP 'studio-runtime-config'
foreach ($directory in @($base, $download, $unpacked, $output)) {
    if (Test-Path -LiteralPath $directory) { throw 'Preserve existing extraction' }
}
& gh run download $env:CANDIDATE_RUN --repo $env:GITHUB_REPOSITORY --name "windows-candidate-$env:RELEASE_TAG" --dir $base
if ($LASTEXITCODE -ne 0) { throw 'Original candidate download failed' }
$manifest = Get-Content (Join-Path $base 'candidate-manifest.json') -Raw | ConvertFrom-Json
$source = (& git rev-parse HEAD).Trim()
if ($manifest.tag -ne $env:RELEASE_TAG -or $manifest.source -ne $source) { throw 'Candidate source mismatch' }
$draft = & gh release view $env:RELEASE_TAG --repo $env:GITHUB_REPOSITORY --json isDraft,assets | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $draft.isDraft -or $draft.assets.Count -ne 1) { throw 'Expected one draft installer' }
& gh release download $env:RELEASE_TAG --repo $env:GITHUB_REPOSITORY --pattern '*_x64-setup.exe' --dir $download
if ($LASTEXITCODE -ne 0) { throw 'Installer download failed' }
$installers = @(Get-ChildItem -LiteralPath $download -File)
if ($installers.Count -ne 1 -or (Get-FileHash $installers[0].FullName).Hash.ToLowerInvariant() -ne $manifest.installerSha256) {
    throw 'Installer differs from the original accepted CI build'
}
$archiveTool = (Get-Command 7z.exe -ErrorAction Stop).Source
& $archiveTool x $installers[0].FullName "-o$unpacked" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Installer extraction failed' }
$entries = @(Get-ChildItem $unpacked -Recurse -File -Filter zicode-studio-desktop.exe)
if ($entries.Count -ne 1) { throw 'Expected one application' }
$runtime = $entries[0].Directory.FullName
$app = @($manifest.files | Where-Object path -eq 'zicode-studio-desktop.exe')
if ($app.Count -ne 1 -or (Get-FileHash $entries[0].FullName).Hash.ToLowerInvariant() -ne $app[0].sha256) {
    throw 'Application differs from the original candidate'
}
# Portable Git updates these configuration files after install. Export the
# installer's own copies; reuse only the byte-identical immutable subdirectories.
$records = @($manifest.files | Where-Object { $_.path -match '^portable-git/(etc/|[^/]+$)' })
if (-not ($records | Where-Object path -eq 'portable-git/etc/hosts')) { throw 'Missing hosts inventory' }
New-Item -ItemType Directory -Path $output | Out-Null
foreach ($record in $records) {
    if ($record.path -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($record.path)) { throw 'Invalid resource path' }
    $file = Join-Path $runtime $record.path
    if ((Get-Item -LiteralPath $file).Length -ne $record.bytes -or (Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant() -ne $record.sha256) {
        throw "Resource differs from original candidate: $($record.path)"
    }
    $destination = Join-Path $output $record.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file -Destination $destination
}
@{schemaVersion=1;tag=$manifest.tag;source=$source;installerSha256=$manifest.installerSha256;files=$records} |
    ConvertTo-Json -Depth 5 | Set-Content (Join-Path $output 'runtime-config-manifest.json') -Encoding utf8
Write-Output "Exported $($records.Count) original runtime configuration files without rebuilding the application"
