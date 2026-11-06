param(
    [Parameter(Mandatory)][string]$CompiledArtifacts,
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [string[]]$TestArguments = @()
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This runner requires Windows.' }
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class StudioTestToken {
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
 [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr t,int c,IntPtr b,int n,out int needed);
 [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr s,uint n);
 [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr s);
 public static int Integrity() {
  IntPtr token;if(!OpenProcessToken(GetCurrentProcess(),8,out token))throw new Exception("Cannot read caller token");
  try{int n;GetTokenInformation(token,25,IntPtr.Zero,0,out n);var b=Marshal.AllocHGlobal(n);
   try{if(!GetTokenInformation(token,25,b,n,out n))throw new Exception("Cannot read integrity label");
    var sid=Marshal.ReadIntPtr(b);return Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)Marshal.ReadByte(GetSidSubAuthorityCount(sid))-1));
   }finally{Marshal.FreeHGlobal(b);}
  }finally{CloseHandle(token);}
 }
}
'@
$integrity = [StudioTestToken]::Integrity()
if ($integrity -ne 8192) { throw 'Run this script from a normal Medium Windows PowerShell session, rather than a Low-integrity build process or Administrator session.' }
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetSetting = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'target' }
$targetPath = if ([IO.Path]::IsPathRooted($targetSetting)) { $targetSetting } else { Join-Path $project $targetSetting }
$target = [IO.Path]::GetFullPath($targetPath).TrimEnd('\') + '\'
$runnerRoot = Join-Path $project '.cache\task-scratch\windows-test-runner'
New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
if ((Get-Item -LiteralPath $runnerRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The test runner directory must not be a link.' }
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$artifacts = @(Get-Content -LiteralPath $CompiledArtifacts | ForEach-Object {
    $entry = $_ | ConvertFrom-Json
    if ($entry.reason -eq 'compiler-artifact' -and $entry.profile.test -and $entry.executable) { $entry }
})
if (-not $artifacts.Count) { throw 'No compiled tests found; use cargo test --no-run --message-format json first.' }
if (-not $env:RUST_TEST_THREADS) { $env:RUST_TEST_THREADS = '2' }
$rows = @()
foreach ($artifact in $artifacts) {
    $source = [IO.Path]::GetFullPath($artifact.executable)
    if (-not $source.StartsWith($target, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test binary is outside the shared Cargo target.' }
    $binary = $source
    if ($artifact.target.name -eq 'zicode-studio-desktop') {
        $binary = Join-Path $runnerRoot 'studio-tests.exe'
        Copy-Item -LiteralPath $source -Destination $binary
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $binary).Hash) { throw 'Staged test bytes differ.' }
        # Reuse this owned Medium-labelled file between checks. Prepare its label
        # once with icacls /setintegritylevel M when a sandbox labels build output Low.
        # This runner never changes privileges or silently skips Windows tests.
    }
    $log = Join-Path $EvidenceDirectory ($artifact.target.name + '.log')
    & $binary @TestArguments *> $log
    $code = $LASTEXITCODE
    $summary = @(Select-String -LiteralPath $log -Pattern '^test result:').Line
    $rows += @{ target = $artifact.target.name; executable = $binary; sha256 = (Get-FileHash -LiteralPath $binary).Hash; exitCode = $code; summary = $summary }
    Write-Output "$($artifact.target.name): $summary"
}
$receipt = @{ checkedAt = (Get-Date).ToUniversalTime().ToString('o'); callerIntegrity = $integrity; testThreads = $env:RUST_TEST_THREADS; passed = @($rows | Where-Object exitCode -ne 0).Count -eq 0; targets = $rows }
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'result.json')
if (-not $receipt.passed) { exit 1 }
