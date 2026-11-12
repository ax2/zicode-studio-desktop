#[cfg(windows)]
mod animation;
#[cfg(windows)]
mod animation_export;
#[cfg(windows)]
mod animation_install;
#[cfg(windows)]
mod animation_install_command;
#[cfg(windows)]
mod animation_preview;
#[cfg(windows)]
mod animation_preview_command;
mod animation_request;
#[cfg(windows)]
mod animation_stage;
#[cfg(windows)]
mod backup_commands;
#[cfg(windows)]
mod backup_destination;
#[cfg(windows)]
mod backup_jobs;
mod catalog;
#[cfg(windows)]
mod character_commands;
#[cfg(windows)]
mod characters;
mod collections;
#[cfg(windows)]
mod comfyui;
mod commands;
mod duplicates;
#[cfg(windows)]
mod generation_attempts;
#[cfg(windows)]
mod generation_commands;
#[cfg(windows)]
mod generation_dispatch;
#[cfg(windows)]
mod generation_outputs;
#[cfg(windows)]
mod generation_recipes;
#[cfg(windows)]
mod generation_review_commands;
#[cfg(windows)]
mod generation_usage;
#[cfg(windows)]
mod generation_workflow;
mod name_search;
#[cfg(windows)]
mod novel_draft_commands;
#[cfg(windows)]
mod novel_drafts;
#[cfg(windows)]
mod novel_model_archive;
#[cfg(windows)]
mod novel_model_source;
mod preview;
#[cfg(windows)]
mod reference_catalog;
#[cfg(windows)]
mod reference_commands;
#[cfg(windows)]
mod reference_grants;
#[cfg(windows)]
mod reference_import;
#[cfg(windows)]
mod reference_source;
#[cfg(windows)]
mod restore_library;
#[cfg(windows)]
mod snapshot;
#[cfg(windows)]
mod snapshot_references;
mod tags;
pub(crate) use commands::visual_assets_control;

pub(crate) fn manifest() -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1, "id": "com.zicode.visual-assets", "name": "Visual assets",
        "description": "Your local visual library", "version": "0.1.0", "publisher": "zicode",
        "engines": {"zicode": ">=0.4.2 <1.0.0", "pluginApi": "^1.0.0"},
        "activationEvents": ["onView:visual-assets.library"],
        "contributes": {
            "activities": [{"id": "visual-assets", "title": "Visual assets", "order": 125}],
            "views": [{"id": "visual-assets.library", "activity": "visual-assets", "location": "main", "title": "Visual assets"}]
        },
        "permissions": {"required": [], "optional": []}
    })
}

#[cfg(windows)]
mod import_batch;
#[cfg(windows)]
#[path = "import.rs"]
mod imports;
#[cfg(windows)]
mod worker;
#[cfg(windows)]
pub(crate) type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[cfg(windows)]
pub(crate) fn is_worker_argument(argument: Option<&str>) -> bool {
    matches!(
        argument,
        Some(
            "--zicode-visual-assets-worker"
                | "--zicode-visual-assets-restore-worker"
                | animation::WORKER
                | animation::sequence::WORKER
        )
    )
}

#[cfg(windows)]
pub(crate) fn run_worker() -> i32 {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let result = if let Some(result) = animation::run_if_requested(&args) {
        result
    } else {
        match args.as_slice() {
            [mode, input, output] if mode == "--zicode-visual-assets-worker" => {
                worker::decode(std::path::Path::new(input), std::path::Path::new(output))
            }
            [mode, stage] if mode == "--zicode-visual-assets-restore-worker" => {
                worker::decode_batch(std::path::Path::new(stage))
            }
            _ => return 2,
        }
    };
    match result {
        Ok(()) => 0,
        Err(_) => 1,
    }
}
