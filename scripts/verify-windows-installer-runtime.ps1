[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer,[Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$Receipt,[string]$PreviousInstaller,[string]$PreviousSha256,[switch]$RequireUpgrade)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:STUDIO_RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:RUNNER_OS -ne 'Windows') {throw 'A disposable GitHub-hosted Windows runner is required'}
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {throw 'Installer must not inherit a repository token'}
$report=[ordered]@{ schemaVersion=1; version=$Version; workflow=$env:GITHUB_WORKFLOW_SHA; installerSha256=$null;
  installerBytes=0; canaries=@(); wizard=[ordered]@{}; cases=[ordered]@{} }
foreach ($id in @('silentGuard','passiveGuard','lateStartInteractive','cleanInstall','baselineInstall','blockedUpgrade','upgradeAndData')) {
  $report.cases[$id]=@{status='notRun';reason='Earlier step did not complete'}
}
function Save-Receipt {
  [IO.File]::WriteAllText($Receipt,($report | ConvertTo-Json -Depth 6))
}
function Case($id,[scriptblock]$body) {
  try { & $body; $report.cases[$id]=@{status='passed'} }
  catch {$report.cases[$id]=@{status='failed';reason=$_.Exception.Message}; throw}
  finally {Save-Receipt}
}
Save-Receipt
$setup=(Get-Item -LiteralPath $Installer -ErrorAction Stop).FullName
$report.installerSha256=(Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
$report.installerBytes=(Get-Item -LiteralPath $setup).Length
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') {throw 'Invalid candidate version'}
$checkStartup = [version]($Version.Split('-')[0]) -ge [version]'0.7.2'
if ($checkStartup) {
  $report.cases['installedStartup'] = @{status='notRun';reason='Installation did not complete'}
  Save-Receipt
}
if (!$PreviousInstaller) {
  if ($RequireUpgrade) {Case 'baselineInstall' {throw 'A verified previous installer is required for publication'}}
  foreach ($id in @('baselineInstall','blockedUpgrade','upgradeAndData')) {$report.cases[$id]=@{status='skipped';reason='No verified previous installer supplied'}}
} else {
  if ($PreviousSha256 -notmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash -LiteralPath $PreviousInstaller).Hash -ne $PreviousSha256 -or
      $PreviousSha256 -eq $report.installerSha256) {throw 'Unverified or identical upgrade baseline'}
  $report.previousInstallerSha256=$PreviousSha256
}
Save-Receipt
Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class Issue64Gui {
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct SI { public int cb; public string reserved,desktop,title; public uint x,y,w,h,xc,yc,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr process,thread; public uint pid,tid; }
  public delegate bool EnumProc(IntPtr window,IntPtr arg);
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateDesktop(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr attributes);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desk);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr desktop,EnumProc callback,IntPtr arg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr arg);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window,StringBuilder text,int max);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint msg,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll",EntryPoint="SendMessageW",CharSet=CharSet.Unicode)] static extern IntPtr SendText(IntPtr window,uint msg,IntPtr w,string text);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool QueryFullProcessImageName(IntPtr handle,uint flags,StringBuilder path,ref uint chars);
  public static string Image(IntPtr handle) {
    uint chars=32768; var path=new StringBuilder((int)chars);
    if(!QueryFullProcessImageName(handle,0,path,ref chars)) throw new Win32Exception();
    return path.ToString();
  }
  [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  public static PI Start(string exe,string args,string cwd,string desktop) { var si=new SI(); si.cb=Marshal.SizeOf(si); si.desktop="WinSta0\\"+desktop; PI pi; if(!CreateProcess(exe,new StringBuilder("\""+exe+"\" "+args),IntPtr.Zero,IntPtr.Zero,false,0,IntPtr.Zero,cwd,ref si,out pi)) throw new Win32Exception(); return pi; }
  public static string Text(IntPtr w) { var b=new StringBuilder(2048); GetWindowText(w,b,b.Capacity); return b.ToString(); }
  public static string Class(IntPtr w) { var b=new StringBuilder(128); GetClassName(w,b,b.Capacity); return b.ToString(); }
  public static IntPtr[] Windows(IntPtr desk,uint pid) { var list=new List<IntPtr>(); EnumDesktopWindows(desk,(w,a)=>{uint owner;GetWindowThreadProcessId(w,out owner);if(owner==pid){list.Add(w);EnumChildWindows(w,(c,b)=>{list.Add(c);return true;},IntPtr.Zero);}return true;},IntPtr.Zero);return list.ToArray(); }
  public static IntPtr Button(IntPtr desk,uint pid,string prefix) { foreach(var w in Windows(desk,pid)) if(Class(w)=="Button" && IsWindowVisible(w) && IsWindowEnabled(w) && Text(w).Replace("&","").StartsWith(prefix,StringComparison.OrdinalIgnoreCase)) return w; return IntPtr.Zero; }
  public static bool Contains(IntPtr desk,uint pid,string value) { foreach(var w in Windows(desk,pid)) if(IsWindowVisible(w) && Text(w).IndexOf(value,StringComparison.OrdinalIgnoreCase)>=0) return true; return false; }
  public static bool SetVisibleEdit(IntPtr desk,uint pid,string text) { foreach(var w in Windows(desk,pid)) if(Class(w)=="Edit" && IsWindowVisible(w) && IsWindowEnabled(w)) { SendText(w,0x000c,IntPtr.Zero,text); return true; } return false; }
  public static bool Visible(IntPtr w) { return IsWindowVisible(w); }
  public static bool Enabled(IntPtr w) { return IsWindowEnabled(w); }
  public static bool Activate(IntPtr w) { return PostMessage(GetParent(w),0x0111,new IntPtr(GetDlgCtrlID(w)),w); }
}
'@
$testRoot=Join-Path $env:RUNNER_TEMP ('guard64-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$testDir=Join-Path $testRoot 'installed'
$fixture=Join-Path $testRoot 'zicode-studio-desktop.exe'
$source=Join-Path $testRoot 'canary.cs'
[IO.File]::WriteAllText($source,@"
using System.Threading;
class Canary {
  static void Main(string[] args) {
    using (var ready = EventWaitHandle.OpenExisting(args[0])) { ready.Set(); }
    Thread.Sleep(Timeout.Infinite);
  }
}
"@)
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe "/out:$fixture" $source
if ($LASTEXITCODE -ne 0) {throw 'Canary compilation failed'}
if (Get-Process -Name zicode-studio-desktop -ErrorAction SilentlyContinue) {throw 'Unexpected existing Studio process'}
function Assert-Alive($p) {
  if($p.HasExited){throw "Canary pid=$($p.Id) exited with code $($p.ExitCode)"}
  $image=[Issue64Gui]::Image($p.Handle)
  if(![StringComparer]::OrdinalIgnoreCase.Equals($image,$fixture)){throw "Unexpected canary image for pid=$($p.Id): expected=$fixture actual=$image"}
}
function Canary {
  # Process.Path enumerates user-mode modules and may be empty during loader startup.
  # The native image is tied to the original process handle; the named event proves Main ran.
  $eventName='Local\ZiCodeGuard64-'+[guid]::NewGuid().ToString('N')
  $ready=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,$eventName)
  $p=$null
  try {
    $p=Start-Process -FilePath $fixture -ArgumentList $eventName -PassThru -WindowStyle Hidden
    try { $initial=$p.Path } catch { $initial=$null }
    $record=[ordered]@{pid=$p.Id;initialModulePath=$initial;nativeImage=[Issue64Gui]::Image($p.Handle);ready=$false}
    $report.canaries+=@($record)
    Assert-Alive $p
    if(!$ready.WaitOne(10000)){Assert-Alive $p;throw "Canary pid=$($p.Id) did not signal readiness"}
    $record.ready=$true
    Assert-Alive $p
    return $p
  } catch {
    if($p -and !$p.HasExited -and [StringComparer]::OrdinalIgnoreCase.Equals([Issue64Gui]::Image($p.Handle),$fixture)){
      $p.Kill();$p.WaitForExit()
    }
    throw
  } finally { $ready.Dispose() }
}
function Run-Installer($file,$mode,$code) {
  $p=Start-Process -FilePath $file -ArgumentList "$mode /NS /D=$testDir" -WindowStyle Hidden -PassThru
  if (!$p.WaitForExit(180000) -or $p.ExitCode -ne $code) {throw "Unexpected installer result: mode=$mode exit=$($p.ExitCode), expected=$code"}
}
$regKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ZiCode Studio Desktop'
function Assert-Clean {
  if ((Test-Path $testDir) -or (Test-Path $regKey)) {throw 'Blocked setup modified destination or product registration'}
}
Assert-Clean
$owned=Canary
try {
  foreach ($mode in @('/S','/P')) {
    $id=if ($mode -eq '/S') {'silentGuard'} else {'passiveGuard'}
    Case $id {Run-Installer $setup $mode 42; Assert-Alive $owned; Assert-Clean}
    Write-Output "PASS actual installer ${mode}: exit 42; canary alive; destination and uninstall key absent"
  }
} finally {Assert-Alive $owned; $owned.Kill(); $owned.WaitForExit()}

# In interactive setup, introduce the process only after the wizard is accepting user input.
# The second process could not have existed at the time the installer was launched.
Case 'lateStartInteractive' {
$deskName='Guard64-'+[guid]::NewGuid().ToString('N')
$desk=[Issue64Gui]::CreateDesktop($deskName,[IntPtr]::Zero,[IntPtr]::Zero,0,0x1ff,[IntPtr]::Zero)
if ($desk -eq [IntPtr]::Zero) {throw 'Isolated test desktop unavailable'}
$gui=[Issue64Gui]::Start($setup,"/NS /D=$testDir",$testRoot,$deskName)
[void][Issue64Gui]::CloseHandle($gui.thread)
$report.wizard=[ordered]@{pid=$gui.pid;image=[Issue64Gui]::Image($gui.process);firstAction=$null;warningSeen=$false;exitCode=$null}
$owned=$null; $warning=$false
try {
  for ($i=0; $i -lt 360; $i++) {
    if ([Issue64Gui]::WaitForSingleObject($gui.process,0) -eq 0) {break}
    if ([Issue64Gui]::Contains($desk,$gui.pid,'is running')) {
      $warning=$true; $report.wizard.warningSeen=$true; $button=[Issue64Gui]::Button($desk,$gui.pid,'OK')
    } else {
      $button=[Issue64Gui]::Button($desk,$gui.pid,'Next')
      if ($button -eq [IntPtr]::Zero) {$button=[Issue64Gui]::Button($desk,$gui.pid,'Install')}
      if (!$owned -and $button -ne [IntPtr]::Zero) {
        $report.wizard.firstAction=[Issue64Gui]::Text($button)
        $owned=Canary
      }
    }
    if ($button -ne [IntPtr]::Zero) {[void][Issue64Gui]::Activate($button)}
    Start-Sleep -Milliseconds 250
  }
  [uint32]$exitCode=0
  $readExit=[Issue64Gui]::GetExitCodeProcess($gui.process,[ref]$exitCode)
  if($readExit){$report.wizard.exitCode=$exitCode}
  if (!$owned -or !$warning -or !$readExit -or $exitCode -ne 42) {throw "Actual wizard race failed: warning=$warning exit=$exitCode canary=$([bool]$owned)"}
  Assert-Alive $owned; Assert-Clean
  Write-Output 'PASS actual interactive installer: canary started after wizard was ready; visible warning; exit 42; canary alive; destination and uninstall key absent'
} finally {
  if ($owned) {Assert-Alive $owned; $owned.Kill(); $owned.WaitForExit()}
  [void][Issue64Gui]::CloseHandle($gui.process)
  [void][Issue64Gui]::CloseDesktop($desk)
}
}
function Check-Version {
  $actual=(Get-Item -LiteralPath (Join-Path $testDir 'zicode-studio-desktop.exe')).VersionInfo.ProductVersion
  if ($actual -ne $Version -and $actual -ne ($Version+'.0')) {throw "Installed version $actual differs from $Version"}
}
if (!$PreviousInstaller) {
  Case 'cleanInstall' {Run-Installer $setup '/S' 0; Check-Version}
} else {
  # Test both a fresh candidate install and a previous -> candidate upgrade on distinct install states.
  Case 'cleanInstall' { Run-Installer $setup '/S' 0; Check-Version }
  $uninstaller=Join-Path $testDir 'uninstall.exe'
  # NSIS _?= runs the uninstaller in place and waits for completion.
  $u=Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$testDir" -PassThru -WindowStyle Hidden
  if (!$u.WaitForExit(120000) -or $u.ExitCode -ne 0 -or (Test-Path (Join-Path $testDir 'zicode-studio-desktop.exe')) -or (Test-Path $regKey)) {throw 'Candidate uninstall did not clear the throwaway install'}
  Case 'baselineInstall' {
    Run-Installer $PreviousInstaller '/S' 0
    $oldVersion=(Get-Item (Join-Path $testDir 'zicode-studio-desktop.exe')).VersionInfo.ProductVersion
    if ([version]$oldVersion -ge [version]($Version.Split('-')[0])) {throw 'Baseline must be an earlier installed version'}
    $report.baselineVersion=$oldVersion
  }
  # Synthetic data at the runner account's ordinary system notes path, outside the install.
  $noteDir=Join-Path $env:USERPROFILE '.zicode/.zicode/notes/issue64-acceptance'
  if (Test-Path $noteDir) {throw 'Unexpected existing acceptance notes'}
  [void][IO.Directory]::CreateDirectory($noteDir)
  $note=Join-Path $noteDir 'retained.md'; $attachment=Join-Path $noteDir 'retained.bin'
  [IO.File]::WriteAllText($note,("# Synthetic upgrade note"+[Environment]::NewLine+"资料保留"))
  [IO.File]::WriteAllBytes($attachment,[byte[]](0..255))
  $noteHash=(Get-FileHash $note).Hash; $attachmentHash=(Get-FileHash $attachment).Hash
  $owned=Canary
  try {
    Case 'blockedUpgrade' {
      $installed=Join-Path $testDir 'zicode-studio-desktop.exe'
      $oldHash=(Get-FileHash $installed).Hash
      Run-Installer $setup '/S' 42; Assert-Alive $owned
      if ((Get-FileHash $installed).Hash -ne $oldHash) {throw 'Blocked upgrade changed installed executable'}
    }
  } finally {Assert-Alive $owned; $owned.Kill(); $owned.WaitForExit()}
  Case 'upgradeAndData' {
    Run-Installer $setup '/S' 0; Check-Version
    if ((Get-FileHash $note).Hash -ne $noteHash -or (Get-FileHash $attachment).Hash -ne $attachmentHash) {throw 'Synthetic user data changed'}
  }
}
if ($checkStartup) {
  Case 'installedStartup' {
    $installed = Join-Path $testDir 'zicode-studio-desktop.exe'
    & "$PSScriptRoot/verify-windows-installed-startup.ps1" -Executable $installed -ProfileDirectory (Join-Path $testRoot 'startup-profile')
    $report.startup = @{executableSha256=(Get-FileHash -LiteralPath $installed).Hash; mode='tools-only'; visibleEnabledEntry='Mail'}
  }
}
if ((Get-FileHash -LiteralPath $setup).Hash -ne $report.installerSha256) {throw 'Candidate installer changed during verification'}
Save-Receipt
