param([string]$Mode,[long]$Hwnd,[double]$X=0,[double]$Y=0)
$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Windows tool entry acceptance'){throw 'Disposable VM only'}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Q35 {
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr menu,uint pos,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr menu,uint item,System.Text.StringBuilder text,int max,uint flags);
  [DllImport("user32.dll")] public static extern bool GetMenuItemRect(IntPtr owner,IntPtr menu,uint item,out Rect rect);
  [StructLayout(LayoutKind.Sequential)]public struct Pt {public int x,y;}
  [StructLayout(LayoutKind.Sequential)]public struct Rect {public int left,top,right,bottom;}
  [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int cmd);
  [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")]public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int ht,bool redraw);
  [DllImport("user32.dll")]public static extern bool GetClientRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")]public static extern bool ClientToScreen(IntPtr h,ref Pt p);
  [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")]public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")]public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll",EntryPoint="GetWindowLongW")]public static extern int GetWindowLong(IntPtr h,int n);
  [DllImport("user32.dll")]public static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")]public static extern int ReleaseDC(IntPtr h,IntPtr dc);
  [DllImport("gdi32.dll")]public static extern uint GetPixel(IntPtr dc,int x,int y);
  [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
[Q35]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$h=[IntPtr]$Hwnd
function Click($elem,[bool]$Right){
  $b=$elem.Current.BoundingRectangle
  if($b.IsEmpty -or $b.Width -lt 1){throw 'UIA item not on screen'}
  [Q35]::SetCursorPos([int]($b.X+$b.Width/2),[int]($b.Y+$b.Height/2))|Out-Null
  $down=2;$up=4;if($Right){$down=8;$up=16}
  [Q35]::mouse_event($down,0,0,0,[UIntPtr]::Zero);[Q35]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
}
function ShellItem([string]$pattern,[bool]$menu=$false){
  $classes=if($menu){@('#32768')}else{@('Shell_TrayWnd','NotifyIconOverflowWindow','TopLevelWindowForOverflowXamlIsland')}
  $root=[Windows.Automation.AutomationElement]::RootElement
  foreach($top in $root.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition)){
    if($classes -notcontains $top.Current.ClassName){continue}
    foreach($item in $top.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)){
      if(!$item.Current.IsOffscreen -and $item.Current.Name -match $pattern){return $item}
    }
  }
}
if($Mode -eq 'choose'){
  $needle=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')
  $root=[Windows.Automation.AutomationElement]::RootElement
  $deadline=[DateTime]::UtcNow.AddSeconds(28)
  do{$dialog=$root.FindFirst([Windows.Automation.TreeScope]::Children,$needle);if(!$dialog){Start-Sleep -Milliseconds 200}}while(!$dialog -and [DateTime]::UtcNow -lt $deadline)
  if(!$dialog){throw 'Native folder picker did not appear'}
  [void][Q35]::SetForegroundWindow([IntPtr]$dialog.Current.NativeWindowHandle)
  [System.Windows.Forms.SendKeys]::SendWait('%d')
  [System.Windows.Forms.SendKeys]::SendWait($env:Q30_PACKAGE)
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Start-Sleep -Milliseconds 570
  $button=$dialog.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.Name -match '^(Select Folder|选择文件夹|选择文件夹\(.*\)|Open|打开)$'}|Select-Object -First 1
  if(!$button){
    $labels=@($dialog.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::Button}|ForEach-Object {$_.Current.Name})
    throw "Native folder picker select button not found: $($labels -join '|')"
  }
  Click $button $false
  Write-Output 'Genuine Studio folder picker confirmed public fixture';exit
}
if($Mode -eq 'quick'){
  $item=ShellItem 'ZiCode Studio Desktop'
  if(!$item){$arrow=ShellItem 'show hidden icons|notification chevron|显示隐藏|显示.*图标';if($arrow){Click $arrow $false;Start-Sleep -Milliseconds 340};$item=ShellItem 'ZiCode Studio Desktop'}
  if(!$item){throw 'No Studio notification icon'}
  Click $item $true
  function MenuEntry([string]$pattern){
    for($i=0;$i -lt 25;$i++){
      $item=ShellItem $pattern $true
      if($item){return $item}
      Start-Sleep -Milliseconds 100
    }
    throw "Missing menu entry: $pattern"
  }
  $quick=MenuEntry '^(Quick tools|快捷工具)$'
  $r=$quick.Current.BoundingRectangle
  [void][Q35]::SetCursorPos([int]($r.X+$r.Width/2),[int]($r.Y+$r.Height/2))
  Start-Sleep -Milliseconds 750
  $tool=MenuEntry 'Base64.*(encode|编码)'
  $name=$tool.Current.Name
  Click $tool $false
  Write-Output $name;exit
}