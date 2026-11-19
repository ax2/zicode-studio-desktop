param([string]$Action,[string]$Encoded)
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_WORKFLOW -ne 'Isolated Windows clipboard translation') {throw 'Disposable GitHub-hosted Windows VM required.'}
Add-Type -AssemblyName System.Windows.Forms
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
    [Windows.Forms.SendKeys]::SendWait('^c')
    if ([Windows.Forms.Clipboard]::GetText() -cne $box.Text) {throw 'External source copy failed'}
  }
  [Windows.Forms.SendKeys]::SendWait('^+{F8}')
  Start-Sleep -Milliseconds 220
} finally { $form.Dispose() }
