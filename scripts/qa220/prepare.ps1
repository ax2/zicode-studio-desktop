$ErrorActionPreference='Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires a disposable GitHub runner' }
$setup=Join-Path $env:RUNNER_TEMP baseline.exe
curl.exe -fLs --max-time 360 -o $setup https://github.com/ax2/zicode-studio-desktop/releases/download/v0.6.9/ZiCode.Studio.Desktop_0.6.9_x64-setup.exe
if ($LASTEXITCODE -or (Get-FileHash $setup).Hash.ToLowerInvariant() -cne '799dc8822ceb94a582c13d56de922b73cb611a949e6d70839dc36419112692ff') { throw 'Unexpected baseline' }
$installed=Join-Path $env:RUNNER_TEMP 'Studio installed'
$p=Start-Process $setup -ArgumentList "/S /NS /D=$installed" -PassThru -WindowStyle Hidden
if (!$p.WaitForExit(200000) -or $p.ExitCode) { throw 'Baseline install failed' }
"Q220_EXE=$installed/zicode-studio-desktop.exe" >> $env:GITHUB_ENV
"Q220_PROFILE=$env:RUNNER_TEMP/QA220 private profile" >> $env:GITHUB_ENV
"Q220_TRIGGER=$env:RUNNER_TEMP/qa220-tray-quit" >> $env:GITHUB_ENV
foreach ($name in @('pi','portable-git','bun','webview2')) {
  robocopy "$installed/$name" "src-tauri/resources/$name" /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Runtime copy failed: $name" }
}
$conf=(Resolve-Path src-tauri/tauri.conf.json).Path
$value=Get-Content $conf -Raw | ConvertFrom-Json
if ($value.version -ne '0.7.1') { throw 'Wrong candidate' }
$value.version='0.6.9'
[IO.File]::WriteAllText($conf,($value|ConvertTo-Json -Depth 100))
# A GitHub runner has no reliable Explorer tray. Only replace selecting Quit in
# the menu: enter its production confirmation dialog and operate its real buttons.
$tray=(Resolve-Path src-tauri/src/desktop_tray.rs).Path
$source=[IO.File]::ReadAllText($tray)
$entry='pub fn install(app: &tauri::App) -> tauri::Result<()> {'
if (!$source.Contains($entry)) { throw 'Missing tray entry' }
$driver=@'
    if let Some(trigger) = std::env::var_os("Q220_TRIGGER") {
        let handle = app.handle().clone();
        std::thread::spawn(move || loop {
            if std::fs::remove_file(&trigger).is_ok() {
                let target = handle.clone();
                let evidence = std::path::PathBuf::from(&trigger).with_extension("state");
                let _ = handle.run_on_main_thread(move || {
                    let _ = std::fs::write(evidence, format!("tray={} offered={:?}", target.try_state::<DesktopTray>().is_some(), crate::stable_update::pending_quit_update()));
                    confirm_exit(&target);
                });
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        });
    }
'@
[IO.File]::WriteAllText($tray,$source.Replace($entry,$entry+[Environment]::NewLine+$driver))
exit 0
