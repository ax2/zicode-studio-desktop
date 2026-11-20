param([int]$AppPid, [ValidateSet('cancel','confirm')][string]$Choice)
$ErrorActionPreference='Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires disposable runner' }
Add-Type -AssemblyName UIAutomationClient
$root=[Windows.Automation.AutomationElement]::RootElement
$scope=[Windows.Automation.TreeScope]
$elements=[Windows.Automation.AutomationElement]
$owned=[Windows.Automation.PropertyCondition]::new($elements::ProcessIdProperty,$AppPid)
$wanted=if ($Choice -eq 'cancel') { 'Keep running|继续运行' } else { 'Quit Studio|退出 Studio' }
$deadline=[DateTime]::UtcNow.AddSeconds(75)
do {
  foreach ($window in $root.FindAll($scope::Children,$owned)) {
    $children=$window.FindAll($scope::Descendants,[Windows.Automation.Condition]::TrueCondition)
    if (!(@($children | ForEach-Object { $_.Current.Name }) -match '0\.7\.0')) {continue}
    foreach ($child in $children) {
      if ($child.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $child.Current.Name -match $wanted) {
        $child.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        Write-Output "PASS real update quit dialog selected $Choice for owned PID $AppPid"
        exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
throw "Missing owned quit dialog action: $Choice"
