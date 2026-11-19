# An isolated acceptance fixture for the independent handoff. Never run on a user desktop.
$ErrorActionPreference = 'Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Windows update handoff acceptance'){throw 'Requires a disposable Windows runner'}
$root=Join-Path $env:RUNNER_TEMP update32
$installed=Join-Path $root 'Installed Studio'
$profile=Join-Path $root 'Disposable profile'
$updates=Join-Path $profile 'data/desktop-updates'
[void][IO.Directory]::CreateDirectory($updates)
[IO.File]::WriteAllText("$profile/profile.json",'{"schemaVersion":1,"kind":"zicode-isolated-desktop"}')
$setup=Join-Path $root stable.exe
curl.exe -fsSL --max-time 240 -o $setup https://github.com/ax2/zicode-studio-desktop/releases/download/v0.6.2/ZiCode.Studio.Desktop_0.6.2_x64-setup.exe
$sha=(Get-FileHash -LiteralPath $setup).Hash.ToLowerInvariant()
if($LASTEXITCODE -or $sha -cne 'e6f18ac3d4de6dfab123755ff75cb3ca7cd6486ed4a11619c5269d8760abdb9c' -or (Get-Item $setup).Length -ne 368501225){throw 'Unexpected public installer'}
$p=Start-Process $setup -ArgumentList "/S /NS /D=$installed" -WindowStyle Hidden -PassThru
if(!$p.WaitForExit(180000) -or $p.ExitCode){throw 'Could not prepare genuine installed product registration'}
$exe=Join-Path $installed zicode-studio-desktop.exe
if((Get-Item $exe).VersionInfo.ProductVersion -ne '0.6.2'){throw 'Failed to establish actual installation'}
$mock=Join-Path $root parent.cs
@"
using System.Threading;
using System.Reflection;
[assembly:AssemblyInformationalVersion("0.6.1")]
static class Parent { public static void Main(){Thread.Sleep(240000);} }
"@ | Set-Content $mock
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe "/out:$exe" $mock
if($LASTEXITCODE){throw 'Compile synthetic waiting parent'}
$parent=Start-Process $exe -PassThru
$candidate=Join-Path $updates ("candidate-"+[guid]::NewGuid()+".exe")
[IO.File]::Copy($setup,$candidate)
$handoff=@{pid=$parent.Id;executable=$exe;installer=$candidate;expectedSha256=('0'*64);version='0.6.2';updatesDir=$updates;arguments=@('--isolated-profile',$profile,'--tools-only')}
$code=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../src-tauri/src/desktop_update_handoff.ps1'))
function Launch-Helper {
    $si=[Diagnostics.ProcessStartInfo]::new()
    $si.FileName="$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe"
    $si.Arguments='-NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $si.UseShellExecute=$false
    $si.CreateNoWindow=$true
    $si.RedirectStandardOutput=$true
    $si.EnvironmentVariables['ZICODE_UPDATE_HANDOFF']=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($handoff|ConvertTo-Json -Compress)))
    $helper=[Diagnostics.Process]::Start($si)
    $ack=$helper.StandardOutput.ReadLine()
    return @{process=$helper;ack=$ack}
}
$bad=Launch-Helper
if($bad.ack -notmatch 'checksum changed' -or !$bad.process.WaitForExit(30000) -or $bad.process.ExitCode -eq 0 -or $parent.HasExited -or !(Test-Path $candidate)){throw "Checksum rejection failed: $($bad.ack)"}
Write-Output 'PASS modified installer digest rejected before Studio exit'
$handoff.expectedSha256=$sha
$other=Start-Process $exe -PassThru
$blocked=Launch-Helper
if($blocked.ack -notmatch 'Close other Studio instances' -or $other.HasExited -or $parent.HasExited){throw "Competing instance guard failed: $($blocked.ack)"}
$other.Kill();$other.WaitForExit()
Write-Output 'PASS existing second instance left running; installation refused'
$sentinels=@{}
foreach($relative in @('notes/retained.md','attachments/retained.bin','bookmarks/retained.json','assets/retained.png','settings/retained.json','credential-store/retained.bin','storage/retained-location.json')){
    $file=Join-Path $profile "data/sentinels/$relative"
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
    [IO.File]::WriteAllText($file,"synthetic test bytes: $relative")
    $sentinels[$file]=(Get-FileHash $file).Hash
}
$good=Launch-Helper
if($good.ack -ne 'ready'){throw "Handoff refused: $($good.ack)"}
$result=Join-Path $updates result.json
if($parent.HasExited -or (Test-Path $result)){throw 'Installer raced original Studio'}
$locked=$false
try{$probe=[IO.File]::OpenWrite($candidate);$probe.Dispose()}catch [IO.IOException]{$locked=$true}
if(!$locked){throw 'Checked candidate was still writable'}
Write-Output 'PASS checked installer held read-only; original process remains active until exit'
$parent.Kill();$parent.WaitForExit() # This fixture owns the temporary waiting process.
if(!$good.process.WaitForExit(240000) -or $good.process.ExitCode){throw "Helper failed: $(Get-Content $result -ErrorAction SilentlyContinue)"}
$r=Get-Content -Raw $result|ConvertFrom-Json
if($r.status -ne 'installed' -or $r.version -ne '0.6.2' -or (Get-Item $exe).VersionInfo.ProductVersion -ne '0.6.2' -or (Test-Path $candidate)){throw 'Final receipt, version or cleanup was wrong'}
foreach($f in $sentinels.Keys){if((Get-FileHash $f).Hash -ne $sentinels[$f]){throw "Changed sentinel $f"}}
$deadline=[DateTime]::UtcNow.AddSeconds(45)
do{$restarted=Get-CimInstance Win32_Process -Filter "Name='zicode-studio-desktop.exe'" | Where-Object {$_.ExecutablePath -eq $exe -and $_.CommandLine.Contains($profile)};if(!$restarted){Start-Sleep -Milliseconds 300}}while(!$restarted -and [DateTime]::UtcNow -lt $deadline)
if(!$restarted){throw 'New Studio did not use original explicit profile'}
Write-Output 'PASS genuine full Windows installer replaced test parent, receipt matches installed PE, seven synthetic sentinels retained, new Studio relaunched original path including spaces'
