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
$shellName = 'zicode_studio_shell.dll'
$shell = Get-Item -LiteralPath (Join-Path $runtime $shellName)
$stagedShell = Join-Path $PSScriptRoot '../src-tauri/resources/shell/zicode_studio_shell.dll'
if ($shell.PSIsContainer -or -not (Test-Path -LiteralPath $stagedShell -PathType Leaf)) {
    throw 'Windows Explorer selection bridge is missing from the installer or build'
}
if ((Get-FileHash -LiteralPath $shell.FullName -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $stagedShell -Algorithm SHA256).Hash) {
    throw 'Installer Explorer selection bridge differs from the staged build'
}
New-Item -ItemType Directory -Path $candidate | Out-Null
$files = @($entries[0], $shell)
Copy-Item -LiteralPath $shell.FullName -Destination (Join-Path $candidate $shellName)
foreach ($folder in @('public', 'extensions', 'pi', 'portable-git', 'bun', 'webview2')) {
    $resource = Join-Path $runtime $folder
    if (-not (Test-Path $resource)) { throw "Missing runtime resource: $folder" }
    $files += @(Get-ChildItem -LiteralPath $resource -File -Recurse -Force)
    if ($folder -in @('public', 'extensions')) {
        Copy-Item -LiteralPath $resource -Destination (Join-Path $candidate $folder) -Recurse -Force
    }
}
# Portable Git configuration can differ between installations. Export it
# verbatim; reuse other runtime directories only after checking their digests.
$gitSource = Join-Path $runtime 'portable-git'
$gitCandidate = Join-Path $candidate 'portable-git'
New-Item -ItemType Directory -Path $gitCandidate | Out-Null
Copy-Item -LiteralPath (Join-Path $gitSource 'etc') -Destination (Join-Path $gitCandidate 'etc') -Recurse -Force
Get-ChildItem -LiteralPath $gitSource -File -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $gitCandidate -Force }
$marker = Join-Path $gitCandidate '.version'
if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'Portable Git version marker is missing from candidate' }
if ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $gitSource '.version') -Algorithm SHA256).Hash) {
    throw 'Portable Git version marker differs from installer'
}
Copy-Item -LiteralPath $entries[0].FullName -Destination $candidate
# upload-artifact otherwise omits this required dotfile. Permit only the
# known package marker before allowing hidden files into the artifact.
$hiddenEntries = @(Get-ChildItem -LiteralPath $candidate -Recurse -Force |
    Where-Object { $_.Name.StartsWith('.') })
if ($hiddenEntries.Count -ne 1 -or $hiddenEntries[0].PSIsContainer -or $hiddenEntries[0].FullName -cne $marker) {
    throw 'Windows acceptance export must contain only portable-git/.version as a hidden path'
}
$gitLock = Get-Content -LiteralPath 'scripts/portable-git-version.json' -Raw | ConvertFrom-Json
$expectedMarker = [ordered]@{ version = $gitLock.version; target = 'windows-x64'; sha256 = $gitLock.assets.'windows-x64'.sha256 } |
    ConvertTo-Json -Compress
if ((Get-Item -LiteralPath $marker).Length -gt 256 -or (Get-Content -LiteralPath $marker -Raw).Trim() -cne $expectedMarker) {
    throw 'Exported Portable Git marker does not match the pinned package'
}

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
