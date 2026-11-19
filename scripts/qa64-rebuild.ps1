$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Windows installer verification fixture'){throw 'Disposable Windows runner required'}
$candidate=Join-Path $env:RUNNER_TEMP from066
$manifest=Get-Content -Raw (Join-Path $candidate 'candidate-manifest.json')|ConvertFrom-Json
if($manifest.source -ne 'a46fb91548587e5e4206ad9af86ddb697b8b06f3' -or $manifest.tag -ne 'v0.6.6' -or $manifest.installerSha256 -ne '92068d0b8d6a353bbeadf7872e399cca4988806b2c89d8541f72d11e6afefb92'){throw 'Unexpected installer inventory'}
$baseline=Join-Path $env:RUNNER_TEMP baseline.exe
curl.exe -fsSL --max-time 180 -o $baseline https://github.com/ax2/zicode-studio-desktop/releases/download/v0.6.2/ZiCode.Studio.Desktop_0.6.2_x64-setup.exe
if($LASTEXITCODE -or (Get-FileHash $baseline).Hash -ne 'E6F18AC3D4DE6DFAB123755FF75CB3CA7CD6486ED4A11619C5269D8760ABDB9C'){throw 'Public baseline digest mismatch'}
$unpack=Join-Path $env:RUNNER_TEMP unpack062
& 7z.exe x $baseline "-o$unpack" -y | Out-Null
if($LASTEXITCODE){throw 'Unpack failed'}
$app=@(Get-ChildItem $unpack -Recurse -File -Filter 'zicode-studio-desktop.exe')
if($app.Count -ne 1){throw 'Ambiguous baseline'}
$runtime=Join-Path $env:RUNNER_TEMP 'verified066'
$paths=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($file in $manifest.files){
  $rel=$file.path
  if([IO.Path]::IsPathRooted($rel) -or ($rel -split '[/\\]' -contains '..') -or !$paths.Add($rel)){throw "Unsafe inventory path"}
  $dst=Join-Path $runtime $rel
  $from=Join-Path $candidate $rel
  if(!(Test-Path -LiteralPath $from -PathType Leaf)){ $from=Join-Path $app[0].DirectoryName $rel }
  $item=Get-Item -LiteralPath $from
  if($item.Length -ne $file.bytes -or (Get-FileHash -LiteralPath $from).Hash -ne $file.sha256){throw "Cannot reconstruct frozen file $rel"}
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dst))|Out-Null
  [IO.File]::Copy($from,$dst)
}
$exe=Get-Item "$runtime/zicode-studio-desktop.exe"
if($exe.VersionInfo.ProductVersion -ne '0.6.6'){throw 'Application version mismatch'}
Write-Output "PASS reconstructed $($paths.Count) individually verified files from frozen v0.6.6 installer inventory"
"STUDIO_Q35_EXE=$($exe.FullName)" >> $env:GITHUB_ENV
$project=(Get-Location).Path
$cfgPath=Join-Path $project 'src-tauri/tauri.conf.json'
$cfg=Get-Content -Raw -LiteralPath $cfgPath|ConvertFrom-Json
$resources=[ordered]@{}
foreach($entry in Get-ChildItem -LiteralPath $runtime){if($entry.Name -ne $exe.Name){$resources[$entry.FullName]=$entry.Name}}
$cfg.bundle.resources=$resources
$cfg.version='0.6.6'
[IO.File]::WriteAllText($cfgPath,($cfg|ConvertTo-Json -Depth 95))
[void][IO.Directory]::CreateDirectory("$project/target/release")
Copy-Item -LiteralPath $exe.FullName -Destination "$project/target/release/zicode-studio-desktop.exe"
# The frozen acceptance inventory contains the Studio executable and runtime resources.
# Package only that verified binary; untracked Cargo utility binaries are outside this fixture.
$manifest=Join-Path $project 'src-tauri/Cargo.toml'
$metadata=[IO.File]::ReadAllText($manifest)
$metadata=$metadata.Replace('[package]',"[package]`nautobins = false")
$metadata=[regex]::Replace($metadata,'(?ms)^\[\[bin\]\]\s*name\s*=\s*"zicode-relay".*?(?=^\[|\z)','')
[IO.File]::WriteAllText($manifest,$metadata)
[IO.Directory]::Move("$project/src-tauri/src/bin","$env:RUNNER_TEMP/unused-cargo-bins")
$lockedTools=Join-Path $env:RUNNER_TEMP 'tauri-cli'
[void][IO.Directory]::CreateDirectory($lockedTools)
Push-Location $lockedTools
npm install --ignore-scripts --no-audit --no-fund --no-save '@tauri-apps/cli@2.11.2'
if($LASTEXITCODE){throw 'Pinned official bundler not available'}
Pop-Location
& "$lockedTools/node_modules/.bin/tauri.cmd" bundle --bundles nsis
if($LASTEXITCODE){throw 'Could not rebuild verifier-only NSIS'}
$setup=@(Get-ChildItem "$project/target/release/bundle/nsis" -File -Filter '*_x64-setup.exe')
if($setup.Count -ne 1){throw 'Ambiguous fixture installer'}
$dst=Join-Path $env:RUNNER_TEMP qa64-bundle
[void][IO.Directory]::CreateDirectory($dst)
Copy-Item -LiteralPath $setup[0].FullName -Destination "$dst/fixture.exe"
Copy-Item -LiteralPath $baseline -Destination "$dst/previous.exe"
Write-Output "Fixture compiled from frozen files and production template; SHA256 $((Get-FileHash $setup[0].FullName).Hash)"