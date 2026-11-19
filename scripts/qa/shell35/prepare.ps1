$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Isolated Windows shell acceptance'){throw 'Disposable Windows runner required'}
$source=Join-Path $env:RUNNER_TEMP from067
$archive=Join-Path $env:RUNNER_TEMP baseline.exe
curl.exe -fsSL --max-time 240 -o $archive https://github.com/ax2/zicode-studio-desktop/releases/download/v0.6.2/ZiCode.Studio.Desktop_0.6.2_x64-setup.exe
if($LASTEXITCODE -or (Get-FileHash $archive).Hash.ToLowerInvariant() -cne 'e6f18ac3d4de6dfab123755ff75cb3ca7cd6486ed4a11619c5269d8760abdb9c'){throw 'Unexpected public runtime baseline'}
$runtime=Join-Path $env:RUNNER_TEMP 'Studio shell fixture'
$setup=Start-Process $archive -ArgumentList "/S /NS /D=$runtime" -WindowStyle Hidden -PassThru
if(!$setup.WaitForExit(180000) -or $setup.ExitCode){throw 'Genuine runtime install failed'}
$hosts=@(Get-ChildItem -LiteralPath $source -Recurse -File -Filter zicode-studio-desktop.exe)
if($hosts.Count -ne 1){throw 'Wrong new host inventory'}
$exe=Join-Path $runtime zicode-studio-desktop.exe
Copy-Item -LiteralPath $hosts[0].FullName -Destination $exe -Force
robocopy "$source/public" "$runtime/public" /E /NFL /NDL /NJH /NJS /NP|Out-Null
if($LASTEXITCODE -ge 8){throw 'Could not stage accepted frontend'}
"STUDIO_Q35_EXE=$exe" >> $env:GITHUB_ENV
'PASS staged the full #161 candidate binary and its matching UI into disposable runtime'
exit 0
