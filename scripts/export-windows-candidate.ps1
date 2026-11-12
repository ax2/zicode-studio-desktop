# Export acceptance files from the actual installer using the runner's existing 7-Zip.
# Large unchanged runtimes stay in the installer; local QA must verify every byte
# against this manifest before reusing installed runtime resources.
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_OS -ne 'Windows') { throw 'Windows runner required' }
$archiveTool = (Get-Command 7z.exe -ErrorAction Stop).Source
$installers = @(Get-ChildItem target/release/bundle/nsis -Filter '*_x64-setup.exe' -File)
if ($installers.Count -ne 1) { throw 'Exactly one installer required' }
$unpacked = Join-Path $env:RUNNER_TEMP 'studio-installer-inspection'
$candidate = Join-Path $env:RUNNER_TEMP 'studio-windows-candidate'
if ((Test-Path $unpacked) -or (Test-Path $candidate)) { throw 'Candidate already exists' }
& $archiveTool x $installers[0].FullName "-o$unpacked" -y | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Installer extraction failed' }
$entries = @(Get-ChildItem $unpacked -Recurse -File -Filter zicode-studio-desktop.exe)
if ($entries.Count -ne 1) { throw 'Expected one application in installer' }
$runtime = $entries[0].Directory.FullName
if (-not (Test-Path (Join-Path $runtime 'public/native/react/visual-assets.js'))) {
    throw 'Installer is missing the visual assets bundle'
}
New-Item -ItemType Directory -Path $candidate | Out-Null
$files = @($entries[0])
foreach ($folder in @('public', 'extensions', 'pi', 'portable-git', 'bun', 'webview2')) {
    $resource = Join-Path $runtime $folder
    if (-not (Test-Path $resource)) { throw "Missing runtime resource: $folder" }
    $files += @(Get-ChildItem -LiteralPath $resource -File -Recurse)
    if ($folder -in @('public', 'extensions')) {
        Copy-Item -LiteralPath $resource -Destination (Join-Path $candidate $folder) -Recurse
    }
}
# Portable Git rewrites config after installation, so it cannot always be
# reused from an older installed release even when the runtime version matches.
$gitSource = Join-Path $runtime 'portable-git'
$gitCandidate = Join-Path $candidate 'portable-git'
New-Item -ItemType Directory -Path $gitCandidate | Out-Null
Copy-Item -LiteralPath (Join-Path $gitSource 'etc') -Destination (Join-Path $gitCandidate 'etc') -Recurse
Get-ChildItem -LiteralPath $gitSource -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $gitCandidate }
Copy-Item -LiteralPath $entries[0].FullName -Destination $candidate
$inventory = @($files | Sort-Object FullName | ForEach-Object {
    @{ path = [IO.Path]::GetRelativePath($runtime, $_.FullName).Replace('\', '/');
       bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
@{ schemaVersion = 1; tag = $env:RELEASE_TAG;
   source = (& git rev-parse HEAD).Trim();
   installer = $installers[0].Name;
   installerSha256 = (Get-FileHash $installers[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant();
   applicationVersion = $entries[0].VersionInfo.ProductVersion;
   files = $inventory
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $candidate 'candidate-manifest.json') -Encoding utf8
Write-Output "Exported candidate from installer: $($inventory.Count) verified file records"
