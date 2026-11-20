//! Native updater bridge for desktop WebViews without plugin JS globals.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_updater::UpdaterExt;
static INSTALLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UpdateMode {
    Manual,
    Notify,
    Download,
}

fn preference_at(path: &std::path::Path, mode: Option<UpdateMode>) -> Result<UpdateMode, String> {
    if let Some(mode) = mode {
        std::fs::create_dir_all(path.parent().ok_or("Invalid update preference path")?)
            .map_err(|error| error.to_string())?;
        let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(&mode).map_err(|error| error.to_string())?;
        std::fs::write(&temp, bytes).map_err(|error| error.to_string())?;
        if let Err(error) = std::fs::rename(&temp, path) {
            let _ = std::fs::remove_file(temp);
            return Err(error.to_string());
        }
        return Ok(mode);
    }
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(UpdateMode::Notify),
        Err(error) => Err(error.to_string()),
    }
}

pub(crate) fn update_mode(mode: Option<UpdateMode>) -> Result<UpdateMode, String> {
    preference_at(
        &crate::app_paths::data_root()?.join("desktop-update-mode.json"),
        mode,
    )
}

#[tauri::command]
pub(crate) fn desktop_update_preference(
    window: WebviewWindow,
    mode: Option<UpdateMode>,
) -> Result<UpdateMode, String> {
    crate::require_workspace_window(&window)?;
    update_mode(mode)
}

const BETA_ENDPOINT: &str =
    "https://github.com/ax2/zicode-studio-desktop/releases/download/beta/latest.json";
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopUpdateInfo {
    version: String,
    date: Option<String>,
    body: Option<String>,
    full_installer: bool,
}
impl DesktopUpdateInfo {
    #[cfg(all(windows, target_arch = "x86_64"))]
    pub(crate) fn full(version: String, date: Option<String>, body: Option<String>) -> Self {
        Self {
            version,
            date,
            body,
            full_installer: true,
        }
    }
}
#[derive(serde::Serialize)]
pub(crate) struct ResultNotice {
    pub(crate) version: String,
    pub(crate) success: bool,
    pub(crate) message: String,
}

fn updater(app: &AppHandle, beta: bool) -> Result<tauri_plugin_updater::Updater, String> {
    let builder = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(20));
    let builder = if beta {
        builder
            .endpoints(vec![
                reqwest::Url::parse(BETA_ENDPOINT).map_err(|e| e.to_string())?
            ])
            .map_err(|e| e.to_string())?
    } else {
        builder
    };
    builder
        .build()
        .map_err(|e| format!("Update configuration unavailable: {e}"))
}
#[tauri::command]
pub(crate) async fn check_desktop_update(
    app: AppHandle,
    window: WebviewWindow,
    beta: bool,
) -> Result<Option<DesktopUpdateInfo>, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(all(windows, target_arch = "x86_64"))]
    if !beta {
        return crate::stable_update::check(&window, &app.package_info().version).await;
    }
    let update = updater(&app, beta)?
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;
    Ok(update.map(|update| DesktopUpdateInfo {
        version: update.version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
        full_installer: false,
    }))
}
fn require_checked_version(expected: &str, actual: &str) -> Result<(), String> {
    if semver::Version::parse(expected).is_err() || expected != actual {
        return Err("Available update changed. Check again before installing.".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn install_desktop_update(
    app: AppHandle,
    window: WebviewWindow,
    expected_version: String,
    beta: bool,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    #[cfg(all(windows, target_arch = "x86_64"))]
    if !beta {
        return crate::stable_update::install(
            &window,
            &expected_version,
            &app.package_info().version,
        )
        .await;
    }
    let update = updater(&app, beta)?
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?
        .ok_or("No desktop update is available")?;
    require_checked_version(&expected_version, &update.version)?;
    crate::reserve_background_worker_for_update(&app, &window).await?;
    // Tauri verifies updater signatures and forwards current startup arguments
    // to the Windows installer, including the fixed isolated profile.
    let result = update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update installation failed: {e}"));
    if result.is_err() {
        if let Err(error) = crate::release_background_worker_update_lease(&app, &window, true).await
        {
            log::warn!("Could not resume background worker after update failure: {error}");
        }
    }
    if result.is_ok() {
        INSTALLED.store(true, Ordering::Release);
    }
    result
}
#[tauri::command]
pub(crate) async fn restart_desktop_after_update(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    #[cfg(all(windows, target_arch = "x86_64"))]
    if crate::stable_update::handoff(&app, &window, true).await? {
        return Ok(());
    }
    if !INSTALLED.load(Ordering::Acquire) {
        return Err("No installed update is pending restart".into());
    }
    app.restart()
}
#[tauri::command]
pub(crate) fn cancel_desktop_update(window: WebviewWindow) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    #[cfg(all(windows, target_arch = "x86_64"))]
    return crate::stable_update::cancel(&window);
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    Err("No full-installer download is available".into())
}
#[tauri::command]
pub(crate) fn take_desktop_update_result(
    window: WebviewWindow,
) -> Result<Option<ResultNotice>, String> {
    crate::require_workspace_window(&window)?;
    #[cfg(all(windows, target_arch = "x86_64"))]
    return crate::stable_update::take_result();
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    Ok(None)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_the_choice_per_profile_and_defaults_to_notifications() {
        let root = std::env::temp_dir().join(format!("studio-pref-{}", uuid::Uuid::new_v4()));
        let file = root.join("first/update.json");
        assert!(matches!(preference_at(&file, None), Ok(UpdateMode::Notify)));
        preference_at(&file, Some(UpdateMode::Download)).unwrap();
        assert!(matches!(
            preference_at(&file, None),
            Ok(UpdateMode::Download)
        ));
        let other = root.join("second/update.json");
        assert!(matches!(
            preference_at(&other, None),
            Ok(UpdateMode::Notify)
        ));
        preference_at(&file, Some(UpdateMode::Manual)).unwrap();
        assert!(matches!(preference_at(&file, None), Ok(UpdateMode::Manual)));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn installs_only_the_version_reviewed_by_the_user() {
        assert!(require_checked_version("0.5.4", "0.5.4").is_ok());
        assert!(require_checked_version("0.5.4", "0.5.5").is_err());
        assert!(require_checked_version("invalid", "invalid").is_err());
    }
}
