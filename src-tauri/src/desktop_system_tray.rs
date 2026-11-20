//! Live, read-only hardware overview. Sampling shares the same cache as Settings;
//! no OS scheduled task, Pi session or external service is started here.
use crate::system_information::SystemInformation;
use std::sync::Mutex;
use tauri::{
    menu::{MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager,
};

struct SystemTray {
    menu: Submenu<tauri::Wry>,
    cpu: MenuItem<tauri::Wry>,
    temperature: MenuItem<tauri::Wry>,
    frequency: MenuItem<tauri::Wry>,
    memory: MenuItem<tauri::Wry>,
    disks: Submenu<tauri::Wry>,
    open: MenuItem<tauri::Wry>,
    disk_rows: Mutex<Vec<(String, MenuItem<tauri::Wry>)>>,
    locale: Mutex<String>,
    latest: Mutex<Option<SystemInformation>>,
}

pub(crate) fn install(app: &tauri::App) -> tauri::Result<Submenu<tauri::Wry>> {
    let menu = Submenu::new(app, "系统信息（采样中…）", true)?;
    let cpu = MenuItem::with_id(app, "studio.system.cpu", "CPU：采样中…", true, None::<&str>)?;
    let temperature = MenuItem::with_id(
        app,
        "studio.system.temperature",
        "CPU 温度：采样中…",
        true,
        None::<&str>,
    )?;
    let frequency = MenuItem::with_id(
        app,
        "studio.system.frequency",
        "系统报告频率：采样中…",
        true,
        None::<&str>,
    )?;
    let memory = MenuItem::with_id(
        app,
        "studio.system.memory",
        "内存：采样中…",
        true,
        None::<&str>,
    )?;
    let disks = Submenu::new(app, "磁盘", true)?;
    let open = MenuItem::with_id(
        app,
        "studio.system.open",
        "打开系统信息…",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    menu.append_items(&[
        &cpu,
        &temperature,
        &frequency,
        &memory,
        &disks,
        &separator,
        &open,
    ])?;
    app.manage(SystemTray {
        menu: menu.clone(),
        cpu,
        temperature,
        frequency,
        memory,
        disks,
        open,
        disk_rows: Mutex::new(Vec::new()),
        locale: Mutex::new("zh-CN".into()),
        latest: Mutex::new(None),
    });
    let app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let data = crate::system_information::get_system_information()
                .await
                .ok();
            if let Some(state) = app.try_state::<SystemTray>() {
                if let Ok(mut latest) = state.latest.lock() {
                    *latest = data;
                }
            }
            render(&app);
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }
    });
    Ok(menu)
}

pub(crate) fn set_locale(app: &AppHandle, locale: &str) {
    if let Some(state) = app.try_state::<SystemTray>() {
        if let Ok(mut value) = state.locale.lock() {
            *value = locale.into();
        }
    }
    render(app);
}

fn usage(data: &SystemInformation) -> f64 {
    if data.memory_total == 0 {
        0.0
    } else {
        100.0 * data.memory_total.saturating_sub(data.memory_available) as f64
            / data.memory_total as f64
    }
}
fn summary(data: &SystemInformation, en: bool) -> String {
    let cpu = data
        .cpu_usage
        .map(|value| format!("{value:.0}%"))
        .unwrap_or_else(|| "…".into());
    let memory = if en { "Memory" } else { "内存" };
    let temperature = data
        .temperature_celsius
        .map(|value| format!(" · {value:.1}°C"))
        .unwrap_or_default();
    format!("CPU {cpu} · {memory} {:.0}%{temperature}", usage(data))
}

fn render(app: &AppHandle) {
    let target = app.clone();
    // Read locale and snapshot only when this callback runs. No mutex remains
    // held while dispatching to the main thread or updating native menu items.
    let _ = app.run_on_main_thread(move || {
        let Some(state) = target.try_state::<SystemTray>() else {
            return;
        };
        let en = state
            .locale
            .lock()
            .map(|locale| *locale == "en")
            .unwrap_or(false);
        let data = state.latest.lock().ok().and_then(|data| data.clone());
        let _ = state.open.set_text(if en {
            "Open system information…"
        } else {
            "打开系统信息…"
        });
        let _ = state.disks.set_text(if en { "Disks" } else { "磁盘" });
        let Some(data) = data else {
            let label = if en {
                "System information unavailable"
            } else {
                "系统信息暂不可用"
            };
            let _ = state.menu.set_text(label);
            return;
        };
        let title = summary(&data, en);
        let _ = state.menu.set_text(&title);
        if let Some(tray) = target.tray_by_id("zicode-studio-desktop") {
            let _ = tray.set_tooltip(Some(format!("ZiCode Studio Desktop\n{title}")));
        }
        let cpu = data
            .cpu_usage
            .map(|value| format!("{value:.1}%"))
            .unwrap_or_else(|| if en { "Sampling…" } else { "采样中…" }.into());
        let _ = state.cpu.set_text(format!("CPU: {cpu}"));
        let temperature = data
            .temperature_celsius
            .map(|value| format!("{value:.1} °C"))
            .unwrap_or_else(|| if en { "No reading" } else { "暂无读数" }.into());
        let _ = state.temperature.set_text(format!(
            "{}: {temperature}",
            if en { "CPU temperature" } else { "CPU 温度" }
        ));
        let frequency = data
            .reported_frequency_mhz
            .map(|value| format!("{:.2} GHz", f64::from(value) / 1000.0))
            .unwrap_or_else(|| "—".into());
        let _ = state.frequency.set_text(format!(
            "{}: {frequency}",
            if en {
                "Reported frequency"
            } else {
                "系统报告频率"
            }
        ));
        let _ = state.memory.set_text(format!(
            "{}: {:.1}% · {:.1} / {:.1} GiB",
            if en { "Memory" } else { "内存" },
            usage(&data),
            data.memory_total.saturating_sub(data.memory_available) as f64 / 1073741824.0,
            data.memory_total as f64 / 1073741824.0
        ));
        let mut rows = state
            .disk_rows
            .lock()
            .map(|rows| rows.clone())
            .unwrap_or_default();
        if rows
            .iter()
            .map(|row| &row.0)
            .ne(data.disks.iter().map(|disk| &disk.name))
        {
            for (_, item) in &rows {
                let _ = state.disks.remove(item);
            }
            rows.clear();
            for disk in &data.disks {
                if let Ok(item) = MenuItem::with_id(
                    &target,
                    format!("studio.system.disk.{}", disk.name),
                    &disk.name,
                    true,
                    None::<&str>,
                ) {
                    let _ = state.disks.append(&item);
                    rows.push((disk.name.clone(), item));
                }
            }
            if let Ok(mut stored) = state.disk_rows.lock() {
                *stored = rows.clone();
            }
        }
        for ((_, item), disk) in rows.iter().zip(&data.disks) {
            let used = disk.total_bytes.saturating_sub(disk.free_bytes);
            let _ = item.set_text(format!(
                "{} {:.1} / {:.1} GiB",
                disk.name,
                used as f64 / 1073741824.0,
                disk.total_bytes as f64 / 1073741824.0
            ));
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn cpu_and_memory_overview_keeps_unavailable_temperature_unknown() {
        let mut data = crate::system_information::test_information();
        data.cpu_usage = Some(12.4);
        data.memory_total = 100;
        data.memory_available = 25;
        assert_eq!(super::summary(&data, false), "CPU 12% · 内存 75%");
        data.temperature_celsius = Some(53.5);
        assert_eq!(super::summary(&data, true), "CPU 12% · Memory 75% · 53.5°C");
    }
}
