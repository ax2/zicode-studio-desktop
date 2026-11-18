[CmdletBinding()]
param([Parameter(Mandatory)][string]$Receipt,[string]$ScratchRoot)
$ErrorActionPreference='Stop'
if (-not $IsWindows) { throw 'This fixture requires Windows' }
if (Test-Path -LiteralPath $Receipt) { throw 'Use a new receipt path to preserve previous results' }
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this fixture without administrator elevation' }
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$scratch=if($ScratchRoot){[IO.Path]::GetFullPath($ScratchRoot)}else{Join-Path $root '.cache/task-scratch'}
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$fixture=Join-Path $scratch ('sensor-lifecycle-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
'{"purpose":"ordinary sensor lifecycle fixture; empty sensors, no hardware or driver calls"}' | Set-Content -LiteralPath (Join-Path $fixture 'owner.json')
$compiler=Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source=Join-Path $root 'src-tauri/sensors/SensorReader.cs'
$library=Join-Path $fixture 'LibreHardwareMonitorLib.dll'
$reader=Join-Path $fixture 'SensorReader.exe'
$ownerExe=Join-Path $fixture 'FixtureOwner.exe'
@'
using System;
using System.IO;
using System.Reflection;
namespace LibreHardwareMonitor.Hardware {
  public class Computer {
    public bool IsCpuEnabled { get; set; }
    public object[] Hardware { get { return new object[0]; } }
    private void Mark(string name) { File.WriteAllText(Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),name),"fixture-only"); }
    public void Open() { Mark("opened"); }
    public void Close() { Mark("closed"); }
  }
}
'@ | Set-Content -LiteralPath (Join-Path $fixture 'EmptySensors.cs')
'using System.Threading; internal static class FixtureOwner { private static void Main() { Thread.Sleep(Timeout.Infinite); } }' | Set-Content -LiteralPath (Join-Path $fixture 'FixtureOwner.cs')
function Start-Hidden([string]$Executable,[string[]]$Arguments) {
    $info=[Diagnostics.ProcessStartInfo]::new($Executable)
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.Arguments=($Arguments | ForEach-Object { '"'+$_+'"' }) -join ' '
    $info.EnvironmentVariables['TEMP']=$fixture; $info.EnvironmentVariables['TMP']=$fixture
    [Diagnostics.Process]::Start($info)
}
function Compile([string]$Mode,[string]$Output,[string]$InputFile) {
    $process=Start-Hidden $compiler @('/nologo','/optimize+',('/target:'+$Mode),'/platform:anycpu','/reference:System.Web.Extensions.dll',('/out:'+$Output),$InputFile)
    try {
        if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Fixture compiler timed out' }
        if ($process.ExitCode -ne 0) { throw 'Fixture compilation failed' }
    } finally { $process.Dispose() }
}
$cases=@(); $diagnostics=@(); $passed=$false; $failure=$null
try {
    Compile 'library' $library (Join-Path $fixture 'EmptySensors.cs')
    Compile 'winexe' $ownerExe (Join-Path $fixture 'FixtureOwner.cs')
    Compile 'winexe' $reader $source
    $hash=(Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash
    foreach ($mode in @('pipe-disconnect','owner-exit')) {
        $owner=$null; $helper=$null; $server=$null; $readerStream=$null
        foreach($name in @('opened','closed')) { $p=Join-Path $fixture $name; if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p} }
        try {
            $owner=Start-Hidden $ownerExe @()
            $pipe='zicode-cpu-'+[guid]::NewGuid().ToString('N')
            $server=[IO.Pipes.NamedPipeServerStream]::new($pipe,[IO.Pipes.PipeDirection]::In,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous)
            $helper=Start-Hidden $reader @($library,$hash,$pipe,[string]$owner.Id,[string]$owner.StartTime.ToUniversalTime().ToFileTimeUtc())
            if (-not $server.WaitForConnectionAsync().Wait(10000)) { $diagnostics += [pscustomobject]@{ownerAlive=(-not $owner.HasExited);ownerTime=$owner.StartTime.ToUniversalTime().ToFileTimeUtc();helperExited=$helper.HasExited;helperExitCode=$(if($helper.HasExited){$helper.ExitCode});arguments=$helper.StartInfo.Arguments}; throw 'Fixture pipe did not connect' }
            $readerStream=[IO.StreamReader]::new($server,[Text.Encoding]::UTF8)
            $line=$readerStream.ReadLineAsync()
            if (-not $line.Wait(5000)) { throw 'Fixture reader did not produce an empty-sensor frame' }
            $frame=$line.Result | ConvertFrom-Json
            if ($null -eq $frame.sampledAt -or $frame.sensors.Count -ne 0) { throw 'Unexpected fixture frame' }
            if (-not (Test-Path -LiteralPath (Join-Path $fixture 'opened'))) { throw 'Fixture library was not opened' }
            if ($mode -eq 'pipe-disconnect') { $readerStream.Dispose(); $readerStream=$null; $server=$null }
            else { $owner.Kill(); $owner.WaitForExit() }
            if (-not $helper.WaitForExit(6000)) { throw 'Reader remained alive after its owner/channel ended' }
            if (-not (Test-Path -LiteralPath (Join-Path $fixture 'closed'))) { throw 'Reader did not close its library' }
            if ($helper.ExitCode -ne 0) { throw 'Reader failed to exit normally' }
            if ($mode -eq 'pipe-disconnect' -and $owner.HasExited) { throw 'Pipe case accidentally exited its owner first' }
            $cases += [pscustomobject]@{case=$mode;emptyFrameReceived=$true;libraryClosed=$true;readerExitedNormally=$true;exitCode=$helper.ExitCode}
        } finally {
            if($readerStream){$readerStream.Dispose()} elseif($server){$server.Dispose()}
            foreach($process in @($helper,$owner)) { if($process){if(-not $process.HasExited){$process.Kill();$process.WaitForExit()};$process.Dispose()} }
        }
    }
    $passed=$true
} catch { $failure=$_.Exception.Message }
$result=[pscustomobject]@{passed=$passed;source='src-tauri/sensors/SensorReader.cs';sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();cases=$cases;diagnostics=$diagnostics;ordinaryCaller=$true;elevationRequested=$false;hardwareAccess=$false;desktopOpened=$false;realTemperatureTest=$false;failure=$failure;scratchRoot=$scratch;fixture=$(if($passed){$null}else{$fixture})}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Receipt
if($passed) {
    $resolved=[IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($scratch)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture cleanup escaped task scratch' }
    if (@(Get-ChildItem -LiteralPath $resolved -Force -Recurse | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count) { throw 'Fixture contains unexpected links' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
$result | ConvertTo-Json -Depth 6
if(-not $passed){exit 1}
