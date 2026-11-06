//! Optional sensors exposed by an already running hardware monitor. Never
//! present ACPI thermal zones as CPU temperatures or install a kernel driver.
use serde::Serialize;

#[cfg(windows)]
mod monitor;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    pub state: &'static str,
    pub library_available: bool,
    pub driver_available: bool,
}
pub(crate) fn status() -> Status {
    #[cfg(windows)]
    {
        monitor::status()
    }
    #[cfg(not(windows))]
    {
        Status {
            state: "unsupported",
            library_available: false,
            driver_available: false,
        }
    }
}
#[tauri::command]
pub(crate) async fn start_system_temperature_monitor(
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        monitor::start().await
    }
    #[cfg(not(windows))]
    {
        Err("CPU temperature monitoring is currently available on Windows".into())
    }
}
#[tauri::command]
pub(crate) fn stop_system_temperature_monitor(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    #[cfg(windows)]
    {
        monitor::stop()
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(windows)]
pub(crate) fn read() -> Option<(f64, String)> {
    if let Some(reading) = monitor::reading() {
        return Some(reading);
    }
    use std::{
        io::Read,
        process::Stdio,
        sync::Mutex,
        time::{Duration, Instant},
    };
    type Cached = Option<(Instant, Option<(f64, String)>)>;
    static CACHE: Mutex<Cached> = Mutex::new(None);
    let mut cache = CACHE.lock().ok()?;
    if let Some((time, value)) = &*cache {
        if time.elapsed() < Duration::from_secs(30) {
            return value.clone();
        }
    }
    let script = r#"$ErrorActionPreference='SilentlyContinue'; foreach($provider in @('LibreHardwareMonitor','OpenHardwareMonitor')) { $sensors=@(Get-CimInstance -Namespace ('root/'+$provider) -ClassName Sensor -OperationTimeoutSec 1 | Where-Object {$_.SensorType -eq 'Temperature' -and ($_.Identifier -match '/(intelcpu|amdcpu|cpu)/') -and $_.Value -gt 0 -and $_.Value -lt 150}); if($sensors.Count) { $value=($sensors|Measure-Object Value -Maximum).Maximum; @{celsius=[double]$value;source=$provider}|ConvertTo-Json -Compress; break } }"#;
    let result = (|| {
        let windows = std::env::var_os("SystemRoot")?;
        let powershell = std::path::PathBuf::from(windows)
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut child = crate::process_command::new_command(powershell)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                script,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        return None;
                    }
                    break;
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        let mut output = String::new();
        child
            .stdout
            .take()?
            .take(16384)
            .read_to_string(&mut output)
            .ok()?;
        let value: serde_json::Value = serde_json::from_str(output.trim()).ok()?;
        let celsius = value.get("celsius")?.as_f64()?;
        let source = value.get("source")?.as_str()?;
        if !(0.0..150.0).contains(&celsius)
            || !["LibreHardwareMonitor", "OpenHardwareMonitor"].contains(&source)
        {
            return None;
        }
        Some((celsius, source.to_string()))
    })();
    *cache = Some((Instant::now(), result.clone()));
    result
}
