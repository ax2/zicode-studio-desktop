[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Executable,
  [Parameter(Mandatory)][string]$ProfileDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
$exe = (Get-Item -LiteralPath $Executable).FullName
if (Test-Path -LiteralPath $ProfileDirectory) { throw 'Startup acceptance requires a new isolated profile' }
$start = [Diagnostics.ProcessStartInfo]::new($exe)
$start.UseShellExecute = $false
$start.WorkingDirectory = [IO.Path]::GetDirectoryName($exe)
$start.ArgumentList.Add('--isolated-profile')
$start.ArgumentList.Add([IO.Path]::GetFullPath($ProfileDirectory))
$start.ArgumentList.Add('--tools-only')
$app = [Diagnostics.Process]::Start($start)
try {
  $element = [Windows.Automation.AutomationElement]
  $condition = [Windows.Automation.AndCondition]::new(
    [Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, [Windows.Automation.ControlType]::Button),
    [Windows.Automation.OrCondition]::new(
      [Windows.Automation.PropertyCondition]::new($element::NameProperty, 'Mail'),
      [Windows.Automation.PropertyCondition]::new($element::NameProperty, '邮箱')
    )
  )
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while ([DateTime]::UtcNow -lt $deadline) {
    $app.Refresh()
    if ($app.HasExited) { throw "Installed Studio exited during startup ($($app.ExitCode))" }
    if ($app.MainWindowHandle -ne [IntPtr]::Zero) {
      try {
        $window = $element::FromHandle($app.MainWindowHandle)
        $mail = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
        if ($mail -and $mail.Current.IsEnabled -and !$mail.Current.IsOffscreen) {
          Write-Output 'PASS installed Studio rendered the enabled Mail entry in its isolated workspace'
          return
        }
      } catch [Windows.Automation.ElementNotAvailableException] {
        # A splash or WebView can be replaced while the native window initializes.
      }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'Installed Studio did not render the Mail entry in its isolated workspace'
} finally {
  try {
    if (!$app.HasExited) {
      [void]$app.CloseMainWindow()
      if (!$app.WaitForExit(3000)) { $app.Kill(); $app.WaitForExit() }
    }
  } finally { $app.Dispose() }
}
