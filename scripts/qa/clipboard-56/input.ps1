param([string]$Action,[string]$Encoded)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Isolated Windows clipboard translation') {throw 'Disposable GitHub-hosted Windows VM required.'}
Add-Type -AssemblyName System.Windows.Forms
if($Action -eq 'reserve'){
  Add-Type -Name Hotkey -Namespace Smoke -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll",SetLastError=true)] public static extern bool RegisterHotKey(IntPtr h,int id,uint modifiers,uint key); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h,int id);'
  if(![Smoke.Hotkey]::RegisterHotKey([IntPtr]::Zero,1774,6,0x77)){throw 'Synthetic owner could not reserve the chord'}
  try{[Console]::WriteLine('RESERVED');[Console]::Out.Flush();[Console]::ReadLine() | Out-Null}
  finally{[Smoke.Hotkey]::UnregisterHotKey([IntPtr]::Zero,1774) | Out-Null}
  return
}
Add-Type -Name Keyboard -Namespace Smoke -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);'
if ($Action -eq 'read') { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Windows.Forms.Clipboard]::GetText())); exit }
$form=New-Object Windows.Forms.Form
$form.Text='Synthetic source for clipboard translation'
$box=New-Object Windows.Forms.TextBox
$box.Multiline=$true
$box.Text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Encoded))
$form.Controls.Add($box)
$form.TopMost=$true
$form.Show()
try {
  $form.Activate()
  $box.Focus() | Out-Null
  [Windows.Forms.Application]::DoEvents()
  if (!$form.ContainsFocus) {throw 'Runner has no interactive input desktop'}
  if ($Action -eq 'empty') {[Windows.Forms.Clipboard]::Clear()}
  elseif ($Action -eq 'opaque') {$o=New-Object Windows.Forms.DataObject;$o.SetData('StudioSyntheticNonText',$false,[byte[]](4,5,6));[Windows.Forms.Clipboard]::SetDataObject($o,$true)}
  elseif ($Action -eq 'oversize') {[Windows.Forms.Clipboard]::SetText(('a'*50001))}
  else {
    $box.SelectAll()
    $box.Copy()
    if ([Windows.Forms.Clipboard]::GetText() -cne $box.Text) {throw 'External source copy failed'}
  }
  if($Action -eq 'copyOnly') {return}
  foreach ($k in @(0x11,0x10,0x77)) {[Smoke.Keyboard]::keybd_event($k,0,0,[UIntPtr]::Zero)}
  foreach ($k in @(0x77,0x10,0x11)) {[Smoke.Keyboard]::keybd_event($k,0,2,[UIntPtr]::Zero)}
  for ($i=0;$i -lt 10;$i++) {[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 30}
} finally { $form.Dispose() }
