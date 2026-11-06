//! Native updater bridge for desktop WebViews without plugin JS globals.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_updater::UpdaterExt;
static INSTALLED: AtomicBool = AtomicBool::new(false);

const BETA_ENDPOINT: &str =
    "https://github.com/ax2/zicode-studio-desktop/releases/download/beta/latest.json";
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopUpdateInfo {
    version: String,
    date: Option<String>,
    body: Option<String>,
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
    beta: bool,
) -> Result<Option<DesktopUpdateInfo>, String> {
    let update = updater(&app, beta)?
        .check()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;
    Ok(update.map(|update| DesktopUpdateInfo {
        version: update.version,
        date: update.date.map(|date| date.to_string()),
        body: update.body,
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
pub(crate) fn restart_desktop_after_update(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    crate::require_workspace_window(&window)?;
    if !INSTALLED.load(Ordering::Acquire) {
        return Err("No installed update is pending restart".into());
    }
    app.restart()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installs_only_the_version_reviewed_by_the_user() {
        assert!(require_checked_version("0.5.4", "0.5.4").is_ok());
        assert!(require_checked_version("0.5.4", "0.5.5").is_err());
        assert!(require_checked_version("invalid", "invalid").is_err());
    }
}
