param([string]$Action,[string]$Encoded)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Isolated Windows clipboard translation') {throw 'Disposable GitHub-hosted Windows VM required.'}
Add-Type -AssemblyName System.Windows.Forms
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
  else {
    $box.SelectAll()
    $box.Copy()
    if ([Windows.Forms.Clipboard]::GetText() -cne $box.Text) {throw 'External source copy failed'}
  }
  foreach ($k in @(0x11,0x10,0x77)) {[Smoke.Keyboard]::keybd_event($k,0,0,[UIntPtr]::Zero)}
  foreach ($k in @(0x77,0x10,0x11)) {[Smoke.Keyboard]::keybd_event($k,0,2,[UIntPtr]::Zero)}
  for ($i=0;$i -lt 10;$i++) {[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 30}
} finally { $form.Dispose() }
