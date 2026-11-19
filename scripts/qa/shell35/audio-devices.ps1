$ErrorActionPreference='Stop'
if($env:RUNNER_ENVIRONMENT -ne 'github-hosted'){throw 'Disposable Windows only'}
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class Devices {
  [DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();
}
'@
Get-Service AudioSrv,AudioEndpointBuilder | ForEach-Object {
  if($_.Status -ne 'Running'){try{Start-Service $_ -ErrorAction Stop}catch{Write-Output $_.Exception.Message}}
}
$count=[Devices]::waveOutGetNumDevs()
Write-Output "Windows render devices: $count"
Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | Select-Object FriendlyName,Status
"QA10_RENDER_DEVICES=$count" >> $env:GITHUB_ENV
exit 0
