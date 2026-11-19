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
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:ImageOS -ne 'win22' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This destructive installation acceptance runs only on an ephemeral GitHub-hosted Windows 2022 runner.'
}
$testRoot=Join-Path $env:RUNNER_TEMP ('guard64-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$before=Join-Path $env:RUNNER_TEMP 'studio-065.exe'
$setup=Join-Path $env:RUNNER_TEMP 'studio-066.exe'
$testDir=Join-Path $testRoot 'installed'
$fixture=Join-Path $testRoot 'zicode-studio-desktop.exe'
$source=Join-Path $testRoot 'canary.cs'
[IO.File]::WriteAllText($source,'class Canary { static void Main() { System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite); } }')
& "$env:WINDIR/Microsoft.NET/Framework64/v4.0.30319/csc.exe" /nologo /target:winexe "/out:$fixture" $source
if ($LASTEXITCODE -ne 0) {throw 'Canary compilation failed'}
if (Get-Process -Name zicode-studio-desktop -ErrorAction SilentlyContinue) {throw 'Unexpected existing Studio process'}
function Canary {
  $p=Start-Process -FilePath $fixture -PassThru -WindowStyle Hidden
  if ($p.HasExited -or $p.Path -ne $fixture) {throw 'Canary identity mismatch'}
  return $p
}
function Assert-Alive($p) {
  $p.Refresh()
  if ($p.HasExited -or $p.Path -ne $fixture) {throw 'Installer terminated the canary'}
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
    Run-Installer $setup $mode 42
    Assert-Alive $owned; Assert-Clean
    Write-Output "PASS actual v0.6.6 ${mode}: exit 42; canary alive; destination and uninstall key absent"
  }
} finally {Assert-Alive $owned; $owned.Kill(); $owned.WaitForExit()}

# In interactive setup, introduce the process only after the wizard is accepting user input.
# The second process could not have existed at the time the installer was launched.
$deskName='Guard64-'+[guid]::NewGuid().ToString('N')
$desk=[Issue64Gui]::CreateDesktop($deskName,[IntPtr]::Zero,[IntPtr]::Zero,0,0x1ff,[IntPtr]::Zero)
if ($desk -eq [IntPtr]::Zero) {throw 'Isolated test desktop unavailable'}
$gui=[Issue64Gui]::Start($setup,"/NS /D=$testDir",$testRoot,$deskName)
[void][Issue64Gui]::CloseHandle($gui.thread)
$owned=$null; $warning=$false
try {
  for ($i=0; $i -lt 360; $i++) {
    if ([Issue64Gui]::WaitForSingleObject($gui.process,0) -eq 0) {break}
    if ([Issue64Gui]::Contains($desk,$gui.pid,'is running')) {
      $warning=$true; $button=[Issue64Gui]::Button($desk,$gui.pid,'OK')
    } else {
      $button=[Issue64Gui]::Button($desk,$gui.pid,'Next')
      if ($button -eq [IntPtr]::Zero) {$button=[Issue64Gui]::Button($desk,$gui.pid,'Install')}
      if (!$owned -and $button -ne [IntPtr]::Zero) {$owned=Canary}
    }
    if ($button -ne [IntPtr]::Zero) {[void][Issue64Gui]::Activate($button)}
    Start-Sleep -Milliseconds 250
  }
  [uint32]$exitCode=0
  if (!$owned -or !$warning -or ![Issue64Gui]::GetExitCodeProcess($gui.process,[ref]$exitCode) -or $exitCode -ne 42) {throw "Actual wizard race failed: warning=$warning exit=$exitCode canary=$([bool]$owned)"}
  Assert-Alive $owned; Assert-Clean
  Write-Output 'PASS actual interactive installer: canary started after wizard was ready; visible warning; exit 42; canary alive; destination and uninstall key absent'
} finally {
  if ($owned) {Assert-Alive $owned; $owned.Kill(); $owned.WaitForExit()}
  [void][Issue64Gui]::CloseHandle($gui.process)
  [void][Issue64Gui]::CloseDesktop($desk)
}
Run-Installer $before '/S' 0
$installed=Join-Path $testDir 'zicode-studio-desktop.exe'
if ((Get-Item $installed).VersionInfo.ProductVersion -notmatch '^0\.6\.5(?:\D|$)') {throw 'Wrong baseline version'}
$owned=Canary
try {
  $original=(Get-FileHash $installed).Hash
  Run-Installer $setup '/S' 42
  Assert-Alive $owned
  if ((Get-FileHash $installed).Hash -ne $original) {throw 'Blocked upgrade changed installed executable'}
} finally {Assert-Alive $owned; $owned.Kill(); $owned.WaitForExit()}
Run-Installer $setup '/S' 0
if ((Get-Item $installed).VersionInfo.ProductVersion -notmatch '^0\.6\.6(?:\D|$)') {throw 'Wrong upgraded version'}
Write-Output 'PASS actual v0.6.5 install; running-process v0.6.6 upgrade refused without changing installed executable; no-process v0.6.6 upgrade succeeded'
