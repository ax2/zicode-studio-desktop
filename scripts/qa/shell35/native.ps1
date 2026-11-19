param([string]$Mode,[long]$Hwnd,[double]$X=0,[double]$Y=0)
$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Isolated Windows shell acceptance'){throw 'Disposable VM only'}
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
if($Mode -eq 'tray'){
  $item=ShellItem 'ZiCode Studio Desktop'
  if(!$item){$arrow=ShellItem 'show hidden icons|notification chevron|显示隐藏|显示.*图标';if($arrow){Click $arrow $false;Start-Sleep -Milliseconds 350};$item=ShellItem 'ZiCode Studio Desktop'}
  if(!$item){throw 'No accessible Studio icon in the Windows notification area or overflow'}
  $iconName=$item.Current.Name
  Click $item $true
  $entry=$null;for($i=0;$i -lt 18 -and !$entry;$i++){Start-Sleep -Milliseconds 100;$entry=ShellItem '(Show|显示) ZiCode Studio' $true}
  if(!$entry){
    $popup=[IntPtr]::Zero
    $labels=@()
    while(($popup=[Q35]::FindWindowEx([IntPtr]::Zero,$popup,'#32768',$null)) -ne [IntPtr]::Zero){
      $menu=[IntPtr]::Zero
      [void][Q35]::SendMessageTimeout($popup,0x1e1,[IntPtr]::Zero,[IntPtr]::Zero,2,300,[ref]$menu)
      if($menu -eq [IntPtr]::Zero){continue}
      for($i=0;$i -lt [Q35]::GetMenuItemCount($menu);$i++){
        $label=[Text.StringBuilder]::new(250)
        [void][Q35]::GetMenuString($menu,$i,$label,250,0x400)
        $labels+=$label.ToString()
        if($label.ToString().Replace('&','') -notmatch '(Show|显示) ZiCode Studio'){continue}
        $r=New-Object Q35+Rect
        if(![Q35]::GetMenuItemRect($popup,$menu,$i,[ref]$r) -and ![Q35]::GetMenuItemRect([IntPtr]::Zero,$menu,$i,[ref]$r)){
          [System.Windows.Forms.SendKeys]::SendWait('{HOME}')
          for($step=0;$step -le [Q35]::GetMenuItemCount($menu);$step++){
            if(([Q35]::GetMenuState($menu,$i,0x400) -band 0x80) -ne 0){
              [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
              @{tray=$iconName;action='right-click menu and keyboard activation';menu=$label.ToString()}|ConvertTo-Json -Compress;exit
            }
            [System.Windows.Forms.SendKeys]::SendWait('{DOWN}')
            Start-Sleep -Milliseconds 100
          }
          continue
        }
        [void][Q35]::SetCursorPos([int](($r.left+$r.right)/2),[int](($r.top+$r.bottom)/2))
        [Q35]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[Q35]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        @{tray=$iconName;action='right click, native menu item';menu=$label.ToString()}|ConvertTo-Json -Compress;exit
      }
    }
    throw "No accessible or Win32 show command after right click; menu items $($labels -join ', ')"
  }
  $menuName=$entry.Current.Name
  Click $entry $false
  @{tray=$iconName;menu=$menuName}|ConvertTo-Json -Compress;exit
}
if($Mode -eq 'size'){[Q35]::ShowWindow($h,9)|Out-Null;[Q35]::MoveWindow($h,32,38,[int]$X,[int]$Y,$true)|Out-Null;[Q35]::SetForegroundWindow($h)|Out-Null;Start-Sleep -Milliseconds 300}
$rect=New-Object Q35+Rect;$pt=New-Object Q35+Pt
[Q35]::GetClientRect($h,[ref]$rect)|Out-Null;[Q35]::ClientToScreen($h,[ref]$pt)|Out-Null
$result=@{dpi=[Q35]::GetDpiForWindow($h);monitors=[Q35]::GetSystemMetrics(80);visible=[Q35]::IsWindowVisible($h);width=$rect.right;height=$rect.bottom;caption=(([Q35]::GetWindowLong($h,-16) -band 0x00c00000) -eq 0x00c00000)}
if($Mode -eq 'pixel'){
  $dc=[Q35]::GetDC([IntPtr]::Zero)
  try{$v=[Q35]::GetPixel($dc,($pt.x+[int]($X*$rect.right)),($pt.y+[int]($Y*$rect.bottom)));$result.color=('{0:x2}{1:x2}{2:x2}' -f ($v -band 255),(($v -shr 8) -band 255),(($v -shr 16) -band 255))}
  finally{[Q35]::ReleaseDC([IntPtr]::Zero,$dc)|Out-Null}
}
$result|ConvertTo-Json -Compress
