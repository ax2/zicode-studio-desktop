//! Native source selection for the trusted visual-assets command.
use super::{import_batch, reference_source::Root};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

pub(super) struct Selection {
    pub root: Root,
    pub files: Vec<PathBuf>,
}

pub(super) async fn pick(
    app: AppHandle,
    batch: bool,
    still_current: impl Fn() -> bool + Send + 'static,
) -> Result<Option<Selection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !still_current() {
            return Err("visual_assets_window_changed".into());
        }
        let Some(directory) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        if !still_current() {
            return Err("visual_assets_window_changed".into());
        }
        let directory = directory
            .into_path()
            .map_err(|_| "visual_assets_invalid_source")?;
        let root = Root::approve(&directory).map_err(|error| error.to_string())?;
        if !batch {
            return Ok(Some(Selection {
                root,
                files: Vec::new(),
            }));
        }
        let Some(files) = app
            .dialog()
            .file()
            .set_directory(&directory)
            .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_files()
        else {
            return Ok(None);
        };
        if !still_current() {
            return Err("visual_assets_window_changed".into());
        }
        if files.is_empty() {
            return Ok(None);
        }
        if files.len() > import_batch::MAX_FILES {
            return Err("visual_assets_batch_limit".into());
        }
        let files = files
            .into_iter()
            .map(|file| {
                let path = file
                    .into_path()
                    .map_err(|_| "visual_assets_invalid_source")?;
                path.strip_prefix(&directory)
                    .map(PathBuf::from)
                    .map_err(|_| "reference_path_rejected")
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(Selection { root, files }))
    })
    .await
    .map_err(|_| "visual_assets_picker_unavailable")?
}
