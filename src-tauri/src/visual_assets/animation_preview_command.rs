use super::{animation_preview, animation_request::AnimationIntent, commands::LIBRARY};
use crate::{host_server::ResourceExportContext, resource_export_picker};
use serde_json::Value;
use tauri::WebviewWindow;

pub(super) async fn handle(
    window: WebviewWindow,
    workspace: String,
    context: ResourceExportContext,
    intent: AnimationIntent,
) -> Result<Value, String> {
    let library = crate::app_paths::data_root()?.join("visual-assets");
    tauri::async_runtime::spawn_blocking(move || {
        let current = || {
            if resource_export_picker::context(&window, &workspace)
                .ok()
                .as_ref()
                != Some(&context)
            {
                return Err("visual_assets_window_changed".into());
            }
            Ok(())
        };
        if current().is_err() {
            return Err("visual_assets_window_changed".to_string());
        }
        let store = super::backup_commands::store()?;
        if store
            .latest()
            .map_err(|_| "visual_assets_animation_preview_failed")?
            .is_some_and(|job| {
                matches!(
                    job.state.as_str(),
                    "queued" | "running" | "publishing" | "cancelling"
                )
            })
        {
            return Err("visual_assets_busy".to_string());
        }
        animation_preview::render(&library, &intent, &LIBRARY, &current).map_err(|error| {
            let message = error.to_string();
            if matches!(
                message.as_str(),
                "visual_assets_busy"
                    | "visual_assets_animation_preview_busy"
                    | "visual_assets_window_changed"
            ) {
                message
            } else {
                "visual_assets_animation_preview_failed".to_string()
            }
        })
    })
    .await
    .map_err(|_| "visual_assets_animation_preview_failed")?
}
