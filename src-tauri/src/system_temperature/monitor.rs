//! Session-scoped temperature reader. Elevation happens only after an explicit
//! Start action; the one-way local pipe accepts only the launched helper PID.
use super::Status;
use serde::Deserialize;
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{io::AsyncReadExt, net::windows::named_pipe::ServerOptions};
use tokio_util::sync::CancellationToken;
mod windows;

#[derive(Default)]
struct Monitor {
    generation: u64,
    cancel: Option<CancellationToken>,
    reading: Option<(Instant, f64, String)>,
    state: &'static str,
}
fn monitor() -> &'static Mutex<Monitor> {
    static STATE: OnceLock<Mutex<Monitor>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Monitor::default()))
}
pub(crate) fn status() -> Status {
    let state = monitor()
        .lock()
        .map(|m| if m.state.is_empty() { "idle" } else { m.state })
        .unwrap_or("failed");
    Status {
        state,
        library_available: windows::library().is_some(),
        driver_available: windows::driver_available(),
    }
}
pub(crate) fn reading() -> Option<(f64, String)> {
    let monitor = monitor().lock().ok()?;
    let (time, value, source) = monitor.reading.as_ref()?;
    (time.elapsed() < Duration::from_secs(8)).then(|| (*value, source.clone()))
}
pub(crate) fn stop() -> Result<(), String> {
    let mut monitor = monitor()
        .lock()
        .map_err(|_| "CPU temperature monitor unavailable")?;
    if let Some(cancel) = monitor.cancel.take() {
        cancel.cancel();
    }
    monitor.generation += 1;
    monitor.reading = None;
    monitor.state = "idle";
    Ok(())
}
fn update(generation: u64, reading: Option<(f64, String)>, ended: bool) {
    if let Ok(mut monitor) = monitor().lock() {
        if monitor.generation == generation {
            monitor.reading = reading.map(|(value, source)| (Instant::now(), value, source));
            monitor.state = if ended {
                "failed"
            } else if monitor.reading.is_some() {
                "running"
            } else {
                "no_reading"
            };
            if ended {
                monitor.cancel = None;
            }
        }
    }
}

pub(crate) async fn start() -> Result<(), String> {
    let library = windows::library()
        .ok_or("Install LibreHardwareMonitor to enable CPU temperature readings.")?;
    if !windows::driver_available() {
        return Err("LibreHardwareMonitor requires the installed PawnIO driver.".into());
    }
    let (generation, cancel) = {
        let mut monitor = monitor()
            .lock()
            .map_err(|_| "CPU temperature monitor unavailable")?;
        if monitor.cancel.is_some() {
            return Ok(());
        }
        monitor.generation += 1;
        monitor.state = "starting";
        monitor.reading = None;
        let cancel = CancellationToken::new();
        monitor.cancel = Some(cancel.clone());
        (monitor.generation, cancel)
    };
    let pipe = format!("zicode-cpu-{}", uuid::Uuid::new_v4());
    let result = async {
        let mut server = ServerOptions::new().first_pipe_instance(true).access_outbound(false)
            .reject_remote_clients(true).max_instances(1).create(format!(r"\\.\pipe\{pipe}"))
            .map_err(|_| "Cannot create the local CPU sensor channel")?;
        let helper = tauri::async_runtime::spawn_blocking(move || windows::launch(&library, &pipe)).await
            .map_err(|_| "Cannot launch the CPU sensor reader")??;
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            result = tokio::time::timeout(Duration::from_secs(15), server.connect()) => {
                result.map_err(|_| "CPU sensor reader did not connect")?.map_err(|_| "CPU sensor channel unavailable")?;
            }
        }
        use std::os::windows::io::AsRawHandle;
        let mut client = 0;
        if unsafe { windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId(server.as_raw_handle().cast(), &mut client) } == 0 || client != helper {
            return Err("CPU sensor reader identity differs".into());
        }
        tauri::async_runtime::spawn(async move {
            let mut buffer = [0; 1024]; let mut pending = Vec::new();
            let result: Result<(), ()> = async {
                loop {
                    let count = tokio::select! {
                        _ = cancel.cancelled() => return Ok(()),
                        result = tokio::time::timeout(Duration::from_secs(10), server.read(&mut buffer)) => result.map_err(|_| ())?.map_err(|_| ())?
                    };
                    if count == 0 { return Err(()); }
                    pending.extend_from_slice(&buffer[..count]);
                    if pending.len() > 16384 { return Err(()); }
                    while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
                        let line: Vec<_> = pending.drain(..=end).collect();
                        update(generation, parse(&line), false);
                    }
                }
            }.await;
            if result.is_err() { update(generation, None, true); }
        });
        Ok(())
    }.await;
    if result.is_err() {
        update(generation, None, true);
    }
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    sampled_at: u64,
    sensors: Vec<Sensor>,
}
#[derive(Deserialize)]
struct Sensor {
    name: String,
    identifier: String,
    celsius: f64,
}
fn parse(line: &[u8]) -> Option<(f64, String)> {
    let frame: Frame = serde_json::from_slice(line).ok()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    if frame.sensors.len() > 64 || frame.sampled_at.abs_diff(now) > 10000 {
        return None;
    }
    let mut sensors: Vec<_> = frame
        .sensors
        .into_iter()
        .filter(|sensor| {
            ["/amdcpu/", "/intelcpu/", "/cpu/"]
                .iter()
                .any(|prefix| sensor.identifier.starts_with(prefix))
                && sensor.identifier.len() <= 160
                && sensor.name.len() <= 100
                && !sensor.name.chars().any(char::is_control)
                && sensor.celsius.is_finite()
                && sensor.celsius > 0.0
                && sensor.celsius < 150.0
        })
        .collect();
    // Prefer the package/control temperature; do not let an unrelated CCD max
    // silently replace the CPU package value shown by LibreHardwareMonitor.
    sensors.sort_by_key(|sensor| {
        !["Tctl/Tdie", "Package", "Tdie"]
            .iter()
            .any(|name| sensor.name.contains(name))
    });
    sensors.first().map(|sensor| {
        (
            sensor.celsius,
            format!("LibreHardwareMonitor · {}", sensor.name),
        )
    })
}

#[cfg(test)]
mod tests {
    fn frame(sensors: serde_json::Value) -> Vec<u8> {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        serde_json::to_vec(&serde_json::json!({"sampledAt":at,"sensors":sensors})).unwrap()
    }
    #[test]
    fn chooses_package_and_rejects_zero_or_non_cpu_sensors() {
        let bytes = frame(serde_json::json!([
            {"name":"GPU","identifier":"/gpu/0","celsius":90},
            {"name":"CPU","identifier":"/amdcpu/0/temperature/0","celsius":0},
            {"name":"CCD1","identifier":"/amdcpu/0/temperature/1","celsius":65},
            {"name":"Core (Tctl/Tdie)","identifier":"/amdcpu/0/temperature/2","celsius":53.5}
        ]));
        let (value, source) = super::parse(&bytes).unwrap();
        assert_eq!(value, 53.5);
        assert!(source.contains("Tctl/Tdie"));
        assert!(super::parse(&frame(
            serde_json::json!([{"name":"CPU","identifier":"/amdcpu/0","celsius":0}])
        ))
        .is_none());
        assert!(super::parse(b"{\"sampledAt\":1,\"sensors\":[]}").is_none());
    }
}
