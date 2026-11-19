[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory,
      [string]$WidgetsSdkArchive, [string]$SdkTools)
$ErrorActionPreference='Stop'
$work=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path $work){throw 'Choose a new output directory for this build'}
$stage=Join-Path $work 'stage'
$assets=Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assets,(Join-Path $stage 'Public') | Out-Null
if(!$SdkTools){
  $kits=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
  $SdkTools=Get-ChildItem (Join-Path $kits 'bin') -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'x64/cppwinrt.exe')} | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 | ForEach-Object {Join-Path $_.FullName 'x64'}
}
if(!$WidgetsSdkArchive){
  $WidgetsSdkArchive=Join-Path $work 'widgets.nupkg'
  Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/microsoft.windowsappsdk.widgets/2.7.0/microsoft.windowsappsdk.widgets.2.7.0.nupkg' -OutFile $WidgetsSdkArchive
}
if((Get-FileHash $WidgetsSdkArchive).Hash -ne '35E118D97640941BA1DC32205680AD2377222F4E6BB41B719073B6EFEC34D0B0'){throw 'Unexpected Windows App SDK Widgets package digest'}
$refs=Join-Path $work 'sdk'
[IO.Compression.ZipFile]::ExtractToDirectory((Get-Item $WidgetsSdkArchive).FullName,$refs)
$headers=Join-Path $work 'generated'
& "$SdkTools/cppwinrt.exe" -input "$refs/metadata/Microsoft.Windows.Widgets.winmd" -reference sdk -output $headers
if($LASTEXITCODE){throw 'C++/WinRT header generation failed'}
& cl.exe /nologo /std:c++20 /utf-8 /EHsc /O1 /MT /DUNICODE /D_UNICODE "/I$headers" "/Fo$work/provider.obj" "/Fe$stage/QuickNotes.exe" "$PSScriptRoot/provider.cpp" /link /subsystem:windows windowsapp.lib ole32.lib advapi32.lib
if($LASTEXITCODE){throw 'Widget provider compilation failed'}
& cl.exe /nologo /std:c++20 /utf-8 /EHsc /O1 /MT /DUNICODE /D_UNICODE /DSTUDIO_TEST_NOTES_WIDGET "/I$headers" "/Fo$work/test.obj" "/Fe$work/TestNotesWidget.exe" "$PSScriptRoot/provider.cpp" /link /subsystem:console windowsapp.lib ole32.lib advapi32.lib
if($LASTEXITCODE){throw 'Widget COM/card test compilation failed'}
& "$work/TestNotesWidget.exe"
if($LASTEXITCODE){throw 'Widget COM/card self-test failed'}
Copy-Item "$PSScriptRoot/AppxManifest.xml" $stage
foreach($name in 'StoreLogo.png','Square150x150Logo.png','Square44x44Logo.png'){Copy-Item "$PSScriptRoot/../../src-tauri/icons/$name" $assets}
Set-Content -LiteralPath "$stage/Public/provider.txt" -Value 'ZiCode Quick Notes'
& "$SdkTools/MakeAppx.exe" pack /d $stage /p "$work/ZiCode.QuickNotes.x64.msix"
if($LASTEXITCODE){throw 'MSIX validation or packaging failed'}
