param([string]$Mode,[long]$Hwnd,[double]$X=0,[double]$Y=0)
$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Windows PDF reading acceptance'){throw 'Disposable VM only'}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Q35 {
  [DllImport("user32.dll")]public static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr extra);
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
if($Mode -eq 'size'){[Q35]::ShowWindow($h,9)|Out-Null;[Q35]::MoveWindow($h,32,38,[int]$X,[int]$Y,$true)|Out-Null;[Q35]::SetForegroundWindow($h)|Out-Null;Start-Sleep -Milliseconds 300}
$rect=New-Object Q35+Rect;$pt=New-Object Q35+Pt
[Q35]::GetClientRect($h,[ref]$rect)|Out-Null;[Q35]::ClientToScreen($h,[ref]$pt)|Out-Null
$result=@{dpi=[Q35]::GetDpiForWindow($h);monitors=[Q35]::GetSystemMetrics(80);visible=[Q35]::IsWindowVisible($h);width=$rect.right;height=$rect.bottom;caption=(([Q35]::GetWindowLong($h,-16) -band 0x00c00000) -eq 0x00c00000)}
if($Mode -eq 'pixel'){
  $dc=[Q35]::GetDC([IntPtr]::Zero)
  try{$v=[Q35]::GetPixel($dc,($pt.x+[int]($X*$rect.right)),($pt.y+[int]($Y*$rect.bottom)));$result.color=('{0:x2}{1:x2}{2:x2}' -f ($v -band 255),(($v -shr 8) -band 255),(($v -shr 16) -band 255))}
  finally{[Q35]::ReleaseDC([IntPtr]::Zero,$dc)|Out-Null}
}
if ($Mode -eq 'marker') {
  $dc=[Q35]::GetDC([IntPtr]::Zero)
  try {
    $yPos=$pt.y+[int]($Y*$rect.bottom)
    $run=0
    $longest=0
    for ($offset=0; $offset -lt $rect.right; $offset++) {
      $pixel=[Q35]::GetPixel($dc,$pt.x+$offset,$yPos)
      if (($pixel -band 255) -gt 230 -and (($pixel -shr 8) -band 255) -lt 20 -and (($pixel -shr 16) -band 255) -gt 230) {
        $run++
        $longest=[Math]::Max($run,$longest)
      } else { $run=0 }
    }
    $result.widthPx=$longest
  } finally { [void][Q35]::ReleaseDC([IntPtr]::Zero,$dc) }
}
if($Mode -in @('pagedown','pageup','pdfend','pdfhome')){
 [void][Q35]::SetCursorPos(($pt.x+[int]($X*$rect.right)),($pt.y+[int]($Y*$rect.bottom)))
 [Q35]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 [Q35]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 $ctrl=$Mode -in @('pdfend','pdfhome')
 $key=@{pagedown=34;pageup=33;pdfend=35;pdfhome=36}[$Mode]
 if($ctrl){[Q35]::keybd_event(17,0,0,[UIntPtr]::Zero)}
 [Q35]::keybd_event($key,0,0,[UIntPtr]::Zero)
 [Q35]::keybd_event($key,0,2,[UIntPtr]::Zero)
 if($ctrl){[Q35]::keybd_event(17,0,2,[UIntPtr]::Zero)}
}
if($Mode -in @('zoomin','zoomout')){
 [void][Q35]::SetCursorPos(($pt.x+[int]($X*$rect.right)),($pt.y+[int]($Y*$rect.bottom)))
 [Q35]::keybd_event(17,0,0,[UIntPtr]::Zero)
 $delta=if($Mode -eq 'zoomin'){120}else{[uint32]::MaxValue-119}
 try {[Q35]::mouse_event(2048,0,0,$delta,[UIntPtr]::Zero);Start-Sleep -Milliseconds 150}
 finally {[Q35]::keybd_event(17,0,2,[UIntPtr]::Zero)}
}
$result|ConvertTo-Json -Compress
