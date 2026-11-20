param([long]$Hwnd,[string]$Signal)
$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Windows browser panel frame capture'){throw 'Disposable Windows only'}
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.IO;
using System.Threading;
public class Monitor222 {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h,IntPtr dc);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc,int x,int y);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d,int x,int y,int w,int h,IntPtr s,int sx,int sy,uint op);
  [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc,int x,int y);
  [DllImport("dwmapi.dll")] static extern int DwmFlush();
  public static int[] Sample(long hwnd,string signal){
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    Rect r;
    if(!GetWindowRect(new IntPtr(hwnd),out r))throw new Exception("Studio window not found");
    var screen=GetDC(IntPtr.Zero); var mem=CreateCompatibleDC(screen);
    var w=r.right-r.left;var h=r.bottom-r.top;
    var bitmap=CreateCompatibleBitmap(screen,w,h); var old=SelectObject(mem,bitmap);
    var counts=new List<int>();var timer=Stopwatch.StartNew();
    try{
      while(timer.ElapsedMilliseconds<19000&&!File.Exists(signal+".stop")){
        DwmFlush();
        if(!BitBlt(mem,0,0,w,h,screen,r.left,r.top,0x00CC0020))throw new Exception("Window capture failed");
        int green=0;
        for(int y=36;y<h-12;y+=24) for(int x=16;x<w-12;x+=24){
          uint c=GetPixel(mem,x,y);int red=(int)(c&255), g=(int)(c>>8&255), b=(int)(c>>16&255);
          if(g>45 && g>2*red && g>b*1.6)green++;
        }
        counts.Add(green);
        if(counts.Count==1)File.WriteAllText(signal,"armed");
      }
      return counts.ToArray();
    }finally{SelectObject(mem,old); DeleteObject(bitmap); DeleteDC(mem);ReleaseDC(IntPtr.Zero,screen);}
  }
}
"@
$samples=[Monitor222]::Sample($Hwnd,$Signal)
@{frames=$samples.Count;blank=@($samples|Where-Object {$_ -lt 3}).Count;min=($samples|Measure-Object -Minimum).Minimum;max=($samples|Measure-Object -Maximum).Maximum;series=($samples -join ',')}|ConvertTo-Json -Compress
