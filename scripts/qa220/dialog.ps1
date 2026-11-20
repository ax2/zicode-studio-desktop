param([int]$AppPid, [ValidateSet('cancel','confirm')][string]$Choice)
$ErrorActionPreference='Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires disposable runner' }
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OwnedDialog {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32")] static extern bool EnumWindows(Callback f,IntPtr p);
  [DllImport("user32")] static extern bool EnumChildWindows(IntPtr h,Callback f,IntPtr p);
  [DllImport("user32")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr h,out int pid);
  [DllImport("user32",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int size);
  [DllImport("user32",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h,int m,IntPtr w,StringBuilder text,uint flags,uint ms,out IntPtr result);
  [DllImport("user32")] public static extern bool PostMessage(IntPtr h,int m,IntPtr w,IntPtr l);
  public static string Class(IntPtr h) {var s=new StringBuilder(128);GetClassName(h,s,128);return s.ToString();}
  public static string Text(IntPtr h) {var s=new StringBuilder(1000);IntPtr r;SendMessageTimeout(h,13,(IntPtr)s.Capacity,s,2,350,out r);return s.ToString();}
  public static IntPtr[] Windows(int owner) {var a=new List<IntPtr>();EnumWindows((h,p)=>{int pid;GetWindowThreadProcessId(h,out pid);if(pid==owner)a.Add(h);return true;},IntPtr.Zero);return a.ToArray();}
  public static IntPtr[] Children(IntPtr parent) {var a=new List<IntPtr>();EnumChildWindows(parent,(h,p)=>{a.Add(h);return true;},IntPtr.Zero);return a.ToArray();}
}
"@
Add-Type -AssemblyName UIAutomationClient
$wanted = if($Choice -eq 'cancel'){'^(Keep running|继续运行|Cancel|取消)$'}else{'^(Quit Studio|退出 Studio|OK|确定)$'}
$deadline=[DateTime]::UtcNow.AddSeconds(55)
$diagnostics=@()
do {
  $diagnostics=@()
  foreach ($h in [OwnedDialog]::Windows($AppPid)) {
    $class=[OwnedDialog]::Class($h)
    if($class -ne '#32770'){continue}
    $title=[OwnedDialog]::Text($h)
    if($title -ne 'ZiCode Studio Desktop'){continue}
    $children=[OwnedDialog]::Children($h)
    $texts=@($children | ForEach-Object {[OwnedDialog]::Text($_)})
    $element=[Windows.Automation.AutomationElement]::FromHandle($h)
    $all=$element.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
    $names=@($all|ForEach-Object {$_.Current.Name})
    $diagnostics+=($texts+$names -join '|')
    if (!(($texts+$names) -match '0\.7\.0')){continue}
    foreach($button in $all) {
      if($button.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $button.Current.Name -match $wanted){
        $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "PASS real owned update prompt selected $Choice";exit 0
      }
    }
    foreach($button in $children) {
      if([OwnedDialog]::Class($button) -eq 'Button' -and [OwnedDialog]::Text($button) -match $wanted){
        if(![OwnedDialog]::PostMessage($button,245,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Could not click owned dialog button'}
        Write-Output "PASS real owned update prompt selected $Choice";exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 200
}while([DateTime]::UtcNow -lt $deadline)
$triggerState=Get-Content ([IO.Path]::ChangeExtension($env:Q220_TRIGGER,"state")) -ErrorAction SilentlyContinue
Write-Output "Tray dispatch state: $triggerState"
throw "Missing owned quit dialog action $Choice; observed dialogs: $diagnostics"
