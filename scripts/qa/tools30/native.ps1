param([string]$Mode,[long]$Hwnd,[double]$X=0,[double]$Y=0)
$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Windows tool entry acceptance'){throw 'Disposable VM only'}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Q35 {
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu,int i);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog,int id);
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
    $hDialog=[IntPtr]$dialog.Current.NativeWindowHandle
    $ok=[Q35]::GetDlgItem($hDialog,1)
    if($ok -ne [IntPtr]::Zero){
      $r=[IntPtr]::Zero
      [void][Q35]::SendMessageTimeout($ok,0xf5,[IntPtr]::Zero,[IntPtr]::Zero,2,3000,[ref]$r)
      Write-Output 'Confirmed genuine file picker by its native IDOK button';exit
    }
    [System.Windows.Forms.SendKeys]::SendWait('%s')
    Write-Output 'Confirmed genuine folder picker through Select shortcut';exit
  }
  Click $button $false
  Write-Output 'Genuine Studio folder picker confirmed public fixture';exit
}
if($Mode -eq 'quick'){
  $item=ShellItem 'ZiCode Studio Desktop'
  if(!$item){$arrow=ShellItem 'show hidden icons|notification chevron|显示隐藏|显示.*图标';if($arrow){Click $arrow $false;Start-Sleep -Milliseconds 340};$item=ShellItem 'ZiCode Studio Desktop'}
  if(!$item){throw 'No Studio notification icon'}
  Click $item $true
  function Get-MenuLabels([IntPtr]$menu){
    for($i=0;$i -lt [Q35]::GetMenuItemCount($menu);$i++){
      $caption=[Text.StringBuilder]::new(300);[void][Q35]::GetMenuString($menu,$i,$caption,300,0x400)
      [pscustomobject]@{index=$i;text=$caption.ToString().Replace('&','');child=[Q35]::GetSubMenu($menu,$i)}
    }
  }
  function Select-Index([IntPtr]$menu,[int]$index,[string]$key){
    [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
    for($step=0;$step -le [Q35]::GetMenuItemCount($menu);$step++){
      if(([Q35]::GetMenuState($menu,$index,0x400) -band 0x80) -ne 0){
        [System.Windows.Forms.SendKeys]::SendWait($key);return
      }
      [System.Windows.Forms.SendKeys]::SendWait('{DOWN}');Start-Sleep -Milliseconds 75
    }
    throw "Could not highlight native menu item $index"
  }
  $labels=@();$quick=$null
  for($n=0;$n -lt 25 -and !$quick;$n++){
    $popup=[IntPtr]::Zero
    while(($popup=[Q35]::FindWindowEx([IntPtr]::Zero,$popup,'#32768',$null)) -ne [IntPtr]::Zero){
      $menu=[IntPtr]::Zero
      [void][Q35]::SendMessageTimeout($popup,0x1e1,[IntPtr]::Zero,[IntPtr]::Zero,2,400,[ref]$menu)
      if($menu -eq [IntPtr]::Zero){continue}
      $labels=@(Get-MenuLabels $menu)
      $quick=$labels|Where-Object {$_.text -match 'Quick tools|快捷工具'}|Select-Object -First 1
      if($quick){break}
    }
    if(!$quick){Start-Sleep -Milliseconds 100}
  }
  if(!$quick -or $quick.child -eq [IntPtr]::Zero){throw "Missing native Quick tools submenu: $($labels.text -join '|')"}
  $children=@(Get-MenuLabels $quick.child)
  $tool=$children|Where-Object {$_.text -match 'Base64.*(encode|编码)'}|Select-Object -First 1
  if(!$tool){throw "Missing pinned encoder in real tray: $($children.text -join '|')"}
  Select-Index $menu $quick.index '{RIGHT}'
  Start-Sleep -Milliseconds 330
  Select-Index $quick.child $tool.index '{ENTER}'
  Write-Output "Explorer native menu $($quick.text) > $($tool.text)";exit
}