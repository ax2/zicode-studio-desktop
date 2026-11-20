param(
  [Parameter(Mandatory = $true)][string]$NsisRoot,
  [Parameter(Mandatory = $true)][string]$ScratchPath
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hooks = (Resolve-Path (Join-Path $repo 'src-tauri/windows/hooks.nsh')).Path
$compiler = (Resolve-Path (Join-Path $NsisRoot 'makensis.exe')).Path
$pluginDir = (Resolve-Path (Join-Path $NsisRoot 'Plugins/x86-unicode/additional')).Path
if (-not (Test-Path -LiteralPath (Join-Path $pluginDir 'nsis_tauri_utils.dll'))) { throw 'Tauri NSIS plugin missing' }
if (Test-Path -LiteralPath $ScratchPath) { throw 'Scratch path must not already exist' }
$scratch = (New-Item -ItemType Directory -Path $ScratchPath).FullName
$testId = [guid]::NewGuid().ToString('N')
$registryParent = 'HKCU:\Software\ZiCodeInstallerSafetyTests'
$parentExisted = Test-Path -LiteralPath $registryParent
$registryPath = "HKCU:\Software\ZiCodeInstallerSafetyTests\$testId"
$registryKey = "Software\ZiCodeInstallerSafetyTests\$testId"
$binary = Join-Path $scratch 'zicode-safety-test.exe'
$script = Join-Path $scratch 'fixture.nsi'
$installer = Join-Path $scratch 'fixture-probe.exe'
$cs = Join-Path $scratch 'fixture.cs'
@'
using System.Threading;
internal static class Program { private static void Main() { Thread.Sleep(180000); } }
'@ | Set-Content -LiteralPath $cs -Encoding UTF8
$csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $csc /nologo /target:exe "/out:$binary" $cs
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile the owned process fixture' }
function Invoke-FixtureInstaller([string]$Path) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Path
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $process = [Diagnostics.Process]::Start($start)
  if (-not $process.WaitForExit(15000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'Owned fixture installer exceeded 15 seconds'
  }
  return $process.ExitCode
}
$source = @'
Unicode True
Name "ZiCode installer safety fixture"
OutFile "@OUTPUT@"
SilentInstall silent
RequestExecutionLevel user
!addplugindir "@PLUGIN@"
!include LogicLib.nsh
!include StrFunc.nsh
${StrCase}
${StrLoc}
!define PRODUCTNAME "ZiCode safety synthetic product"
!define MANUFACTURER "ZiCode safety synthetic publisher"
!define ZICODE_MSI_HIVE HKCU
!define ZICODE_MSI_UNINSTALL_KEY "@REGISTRY@"
Var PassiveMode
LangString appRunning 1033 "{{product_name}} is running. Close it and try again."
!include "@HOOKS@"
Section
  StrCpy $PassiveMode 0
  StrCpy $R0 "preserve-r0"
  StrCpy $R1 "preserve-r1"
  !insertmacro ZiCodeRejectLegacyMsi
  !insertmacro ZiCodeRequireStopped "zicode-safety-test.exe" "ZiCode safety synthetic product"
  StrCmp $R0 "preserve-r0" +2
    Abort
  StrCmp $R1 "preserve-r1" +2
    Abort
  SetErrorLevel 0
SectionEnd
'@
$source = $source.Replace('@OUTPUT@', 'fixture-probe.exe').Replace('@PLUGIN@', $pluginDir).Replace('@REGISTRY@', $registryKey).Replace('@HOOKS@', $hooks)
[IO.File]::WriteAllText($script, $source, [Text.UTF8Encoding]::new($true))
Push-Location $scratch
try {
  & $compiler /V2 'fixture.nsi'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to compile NSIS fixture' }
} finally { Pop-Location }
if (Get-Process -Name 'zicode-safety-test' -ErrorAction SilentlyContinue) { throw 'Fixture process name already in use' }
if ((Invoke-FixtureInstaller $installer) -ne 0) { throw 'No-process check failed' }
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = $binary
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$owned = [Diagnostics.Process]::Start($start)
try {
  Start-Sleep -Milliseconds 400
  if ($owned.HasExited -or $owned.Path -ne $binary) { throw 'Owned fixture identity mismatch' }
  $blocked = Invoke-FixtureInstaller $installer
  $current = Get-Process -Id $owned.Id -ErrorAction Stop
  if ($blocked -ne 42 -or $current.Path -ne $binary) { throw 'Process guard failed' }
} finally {
  $current = Get-Process -Id $owned.Id -ErrorAction SilentlyContinue
  if ($null -ne $current -and $current.Path -eq $binary -and $current.StartTime -eq $owned.StartTime) { Stop-Process -Id $owned.Id }
}
if (Test-Path -LiteralPath $registryPath) { throw 'Synthetic registry key already exists' }
$entry = Join-Path $registryPath 'Synthetic'
try {
  New-Item -Path $entry -Force | Out-Null
  New-ItemProperty -LiteralPath $entry -Name DisplayName -Value 'ZiCode safety synthetic product' | Out-Null
  New-ItemProperty -LiteralPath $entry -Name Publisher -Value 'ZiCode safety synthetic publisher' | Out-Null
  New-ItemProperty -LiteralPath $entry -Name UninstallString -Value 'not-msi.exe' | Out-Null
  if ((Invoke-FixtureInstaller $installer) -ne 0) { throw 'Non-MSI fixture was rejected' }
  Set-ItemProperty -LiteralPath $entry -Name UninstallString -Value '"C:\Windows\System32\MsiExec.exe" /X {synthetic}'
  if ((Invoke-FixtureInstaller $installer) -ne 43) { throw 'MSI fixture was not rejected' }
} finally {
  if (Test-Path -LiteralPath $entry) {
    'DisplayName', 'Publisher', 'UninstallString' | ForEach-Object { Remove-ItemProperty -LiteralPath $entry -Name $_ -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $entry
  }
  if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
  if (-not $parentExisted -and (Test-Path -LiteralPath $registryParent)) {
    $parent = Get-Item -LiteralPath $registryParent
    if ($parent.SubKeyCount -eq 0 -and $parent.ValueCount -eq 0) { Remove-Item -LiteralPath $registryParent }
  }
}
@{ passed = $true; noProcess = 0; runningProcess = 42; matchingMsi = 43; scratch = $scratch } | ConvertTo-Json -Compress
