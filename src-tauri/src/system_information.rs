//! Read-only local metrics. CPU frequency is the value reported by Windows,
//! not an estimate of effective per-core clocks. Missing sensors remain None.
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemInformation {
    pub(crate) sampled_at: u64,
    pub(crate) cpu_name: String,
    pub(crate) logical_processors: usize,
    pub(crate) cpu_usage: Option<f64>,
    pub(crate) reported_frequency_mhz: Option<u32>,
    pub(crate) max_frequency_mhz: Option<u32>,
    pub(crate) memory_total: u64,
    pub(crate) memory_available: u64,
    pub(crate) disks: Vec<DiskInformation>,
    pub(crate) temperature_celsius: Option<f64>,
    pub(crate) temperature_source: Option<String>,
    pub(crate) temperature_monitor: crate::system_temperature::Status,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiskInformation {
    pub(crate) name: String,
    pub(crate) total_bytes: u64,
    pub(crate) free_bytes: u64,
}
struct Sampler {
    previous: Option<[u64; 3]>,
    cached: Option<(Instant, SystemInformation)>,
}
static SAMPLER: Mutex<Sampler> = Mutex::new(Sampler {
    previous: None,
    cached: None,
});

fn cpu_usage(previous: [u64; 3], next: [u64; 3]) -> Option<f64> {
    if next
        .iter()
        .zip(previous)
        .any(|(next, previous)| *next < previous)
    {
        return None;
    }
    let total = (next[1] - previous[1]).checked_add(next[2] - previous[2])?;
    let idle = next[0] - previous[0];
    (total > 0 && idle <= total).then(|| (total - idle) as f64 * 100.0 / total as f64)
}

#[tauri::command]
pub(crate) async fn get_system_information() -> Result<SystemInformation, String> {
    tauri::async_runtime::spawn_blocking(sample)
        .await
        .map_err(|_| "System information worker unavailable".to_string())?
}
fn sample() -> Result<SystemInformation, String> {
    let mut sampler = SAMPLER
        .lock()
        .map_err(|_| "System information unavailable")?;
    if let Some((time, data)) = &sampler.cached {
        if time.elapsed() < Duration::from_secs(1) {
            return Ok(data.clone());
        }
    }
    let result = platform_sample(&mut sampler.previous)?;
    sampler.cached = Some((Instant::now(), result.clone()));
    Ok(result)
}

#[cfg(not(windows))]
fn platform_sample(_: &mut Option<[u64; 3]>) -> Result<SystemInformation, String> {
    Err("System information is currently available on Windows".into())
}

#[cfg(windows)]
fn platform_sample(previous: &mut Option<[u64; 3]>) -> Result<SystemInformation, String> {
    use windows_sys::Win32::{
        Foundation::FILETIME,
        Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives},
        System::{
            Power::{CallNtPowerInformation, ProcessorInformation, PROCESSOR_POWER_INFORMATION},
            SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
            Threading::{GetActiveProcessorCount, GetSystemTimes},
        },
    };
    let mut memory = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // Windows writes only the initialized, correctly sized out-parameters.
    if unsafe { GlobalMemoryStatusEx(&mut memory) } == 0 {
        return Err("Memory information unavailable".into());
    }
    let usage = if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0 {
        let value =
            |time: FILETIME| (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime);
        let next = [value(idle), value(kernel), value(user)];
        let result = previous.and_then(|before| cpu_usage(before, next));
        *previous = Some(next);
        result
    } else {
        None
    };
    let cores = unsafe { GetActiveProcessorCount(0xffff) } as usize;
    let mut power = vec![PROCESSOR_POWER_INFORMATION::default(); cores.clamp(1, 4096)];
    let power_ok = unsafe {
        CallNtPowerInformation(
            ProcessorInformation,
            std::ptr::null(),
            0,
            power.as_mut_ptr().cast(),
            std::mem::size_of_val(power.as_slice()) as u32,
        )
    } == 0;
    let reported_frequency_mhz = power_ok
        .then(|| power.iter().map(|p| p.CurrentMhz).max())
        .flatten()
        .filter(|mhz| *mhz > 0);
    let max_frequency_mhz = power_ok
        .then(|| power.iter().map(|p| p.MaxMhz).max())
        .flatten()
        .filter(|mhz| *mhz > 0);
    let mut disks = Vec::new();
    let drives = unsafe { GetLogicalDrives() };
    for index in 0..26 {
        if drives & (1 << index) == 0 {
            continue;
        }
        let name = format!("{}:\\", (b'A' + index) as char);
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        if unsafe { GetDriveTypeW(wide.as_ptr()) } != 3 {
            continue;
        }
        let (mut available, mut total, mut free) = (0, 0, 0);
        if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut free) } != 0
            && free <= total
        {
            disks.push(DiskInformation {
                name,
                total_bytes: total,
                free_bytes: free,
            });
        }
    }
    let cpu_name = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0")
        .ok()
        .and_then(|key| key.get_value::<String, _>("ProcessorNameString").ok())
        .unwrap_or_else(|| "CPU".into());
    let temperature = crate::system_temperature::read();
    Ok(SystemInformation {
        sampled_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        cpu_name: cpu_name.trim().into(),
        logical_processors: cores,
        cpu_usage: usage,
        reported_frequency_mhz,
        max_frequency_mhz,
        memory_total: memory.ullTotalPhys,
        memory_available: memory.ullAvailPhys.min(memory.ullTotalPhys),
        disks,
        temperature_celsius: temperature.as_ref().map(|t| t.0),
        temperature_source: temperature.map(|t| t.1),
        temperature_monitor: crate::system_temperature::status(),
    })
}

#[cfg(test)]
pub(crate) fn test_information() -> SystemInformation {
    SystemInformation {
        sampled_at: 0,
        cpu_name: "Test CPU".into(),
        logical_processors: 8,
        cpu_usage: None,
        reported_frequency_mhz: None,
        max_frequency_mhz: None,
        memory_total: 0,
        memory_available: 0,
        disks: Vec::new(),
        temperature_celsius: None,
        temperature_source: None,
        temperature_monitor: crate::system_temperature::Status {
            state: "idle",
            library_available: false,
            driver_available: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calculates_busy_time_without_counting_idle_twice() {
        assert_eq!(cpu_usage([20, 60, 40], [50, 120, 80]), Some(70.0));
    }
    #[test]
    fn rejects_zero_or_reset_counters() {
        assert_eq!(cpu_usage([20, 60, 40], [20, 60, 40]), None);
        assert_eq!(cpu_usage([20, 60, 40], [0, 1, 2]), None);
    }
    #[cfg(windows)]
    #[test]
    fn reads_real_windows_metrics_without_changing_system_settings() {
        let data = platform_sample(&mut None).unwrap();
        assert!(data.memory_total > 0 && data.memory_available <= data.memory_total);
        assert!(data.logical_processors > 0);
        assert!(data
            .disks
            .iter()
            .all(|disk| disk.free_bytes <= disk.total_bytes));
        assert!(!data.cpu_name.is_empty());
    }
}
