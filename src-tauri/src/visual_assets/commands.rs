use super::{
    animation_request::AnimationIntent,
    catalog, collections,
    preview::{Owner, Previews},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};
#[cfg(windows)]
use tauri_plugin_dialog::DialogExt;

pub(super) static LIBRARY: Mutex<()> = Mutex::new(());
static PREVIEWS: LazyLock<Mutex<Previews>> = LazyLock::new(|| Mutex::new(Previews::default()));

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    List {
        after: Option<i64>,
        query: Option<String>,
        tag: Option<String>,
        #[serde(rename = "collectionId")]
        collection_id: Option<String>,
        #[serde(default, rename = "duplicatesOnly")]
        duplicates_only: bool,
    },
    ChangeCollections {
        #[serde(rename = "libraryId")]
        library_id: String,
        edit: collections::Edit,
    },
    #[cfg(windows)]
    Characters {
        #[serde(rename = "libraryId")]
        library_id: String,
        action: super::character_commands::Action,
    },
    #[cfg(windows)]
    Generation {
        #[serde(rename = "libraryId")]
        library_id: String,
        action: super::generation_commands::Action,
    },
    #[cfg(windows)]
    NovelDrafts {
        #[serde(rename = "libraryId")]
        library_id: String,
        #[serde(rename = "sceneId")]
        scene_id: String,
        action: super::novel_draft_commands::Action,
    },
    SetTags {
        #[serde(rename = "libraryId")]
        library_id: String,
        #[serde(rename = "assetId")]
        asset_id: i64,
        previous: Vec<String>,
        tags: Vec<String>,
    },
    Import,
    ImportBatch,
    ImportReferences,
    ReauthorizeReference {
        #[serde(rename = "libraryId")]
        library_id: String,
        #[serde(rename = "assetId")]
        asset_id: i64,
        revision: i64,
    },
    StartBackup {
        #[serde(default, rename = "includeReferencedOriginals")]
        include_referenced_originals: bool,
    },
    StartRestore,
    StartAnimation {
        intent: AnimationIntent,
    },
    PreviewAnimation {
        intent: AnimationIntent,
    },
    PlanAnimationInstall {
        name: String,
        intent: AnimationIntent,
    },
    ConfirmAnimationInstall {
        token: String,
    },
    CancelAnimationInstall {
        token: String,
    },
    PlanAnimationRetry {
        #[serde(rename = "jobId")]
        job_id: String,
    },
    ConfirmAnimationRetry {
        token: String,
    },
    CancelAnimationRetry {
        token: String,
    },
    BackupStatus,
    CancelBackup {
        #[serde(rename = "jobId")]
        job_id: String,
    },
    Preview {
        #[serde(rename = "libraryId")]
        library_id: String,
        #[serde(rename = "assetId")]
        asset_id: i64,
        revision: i64,
    },
    ReadPreview {
        handle: String,
    },
}

#[tauri::command]
pub(crate) async fn visual_assets_control(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    request: Request,
) -> std::result::Result<Value, String> {
    let context = crate::resource_export_picker::context(&window, &workspace_id)?;
    let workspace = window
        .state::<crate::host_server::HostServer>()
        .project_resource_root(&workspace_id)?;
    let default_workspace = crate::app_paths::global_workspace_root()?;
    if std::fs::canonicalize(workspace).map_err(|_| "visual_assets_workspace_unavailable")?
        != std::fs::canonicalize(default_workspace)
            .map_err(|_| "visual_assets_workspace_unavailable")?
    {
        return Err("visual_assets_default_workspace_required".into());
    }
    if let Request::PreviewAnimation { intent } = request {
        #[cfg(windows)]
        return super::animation_preview_command::handle(window, workspace_id, context, intent)
            .await;
        #[cfg(not(windows))]
        {
            let _ = intent;
            return Err("visual_assets_worker_platform_unavailable".into());
        }
    }
    #[cfg(windows)]
    if let Request::Generation { library_id, action } = request {
        return super::generation_commands::handle(
            window,
            workspace_id,
            context,
            library_id,
            action,
        )
        .await;
    }
    #[cfg(windows)]
    if let Request::NovelDrafts {
        library_id,
        scene_id,
        action,
    } = request
    {
        return super::novel_draft_commands::handle(window, context, scene_id, library_id, action)
            .await;
    }
    if matches!(
        request,
        Request::PlanAnimationInstall { .. }
            | Request::ConfirmAnimationInstall { .. }
            | Request::CancelAnimationInstall { .. }
            | Request::PlanAnimationRetry { .. }
            | Request::ConfirmAnimationRetry { .. }
            | Request::CancelAnimationRetry { .. }
    ) {
        #[cfg(windows)]
        return super::animation_install_command::handle(
            app,
            window,
            workspace_id,
            context,
            request,
        )
        .await;
        #[cfg(not(windows))]
        return Err("visual_assets_worker_platform_unavailable".into());
    }
    if matches!(
        request,
        Request::StartBackup { .. }
            | Request::StartRestore
            | Request::StartAnimation { .. }
            | Request::BackupStatus
            | Request::CancelBackup { .. }
    ) {
        #[cfg(windows)]
        return super::backup_commands::handle(app, window, workspace_id, request).await;
        #[cfg(not(windows))]
        return Err("visual_assets_worker_platform_unavailable".into());
    }
    // The native picker is the source authorization. IPC accepts no local path.
    #[cfg(windows)]
    let reference = if matches!(
        request,
        Request::ImportReferences | Request::ReauthorizeReference { .. }
    ) {
        let picker_window = window.clone();
        let picker_workspace = workspace_id.clone();
        let expected = crate::resource_export_picker::context(&window, &workspace_id)?;
        if expected != context {
            return Err("visual_assets_window_changed".into());
        }
        let picked = super::reference_commands::pick(
            app.clone(),
            matches!(request, Request::ImportReferences),
            move || {
                crate::resource_export_picker::context(&picker_window, &picker_workspace)
                    .is_ok_and(|current| current == expected)
            },
        )
        .await?;
        match picked {
            Some(value) => Some(value),
            None => return Ok(json!({"cancelled": true})),
        }
    } else {
        None
    };
    #[cfg(windows)]
    let sources = if matches!(request, Request::Import | Request::ImportBatch) {
        let batch = matches!(request, Request::ImportBatch);
        let selected = tauri::async_runtime::spawn_blocking(move || {
            let picker = app
                .dialog()
                .file()
                .add_filter("Images", &["png", "jpg", "jpeg", "webp"]);
            if batch {
                picker.blocking_pick_files()
            } else {
                picker.blocking_pick_file().map(|file| vec![file])
            }
        })
        .await
        .map_err(|_| "visual_assets_picker_unavailable")?;
        match selected {
            Some(files) if files.len() > super::import_batch::MAX_FILES => {
                return Err("visual_assets_batch_limit".into());
            }
            Some(files) if !files.is_empty() => Some(
                files
                    .into_iter()
                    .map(|file| file.into_path().map_err(|_| "visual_assets_invalid_source"))
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            _ => return Ok(json!({"cancelled": true})),
        }
    } else {
        None
    };
    #[cfg(not(windows))]
    {
        let _ = app;
        if matches!(
            request,
            Request::Import
                | Request::ImportBatch
                | Request::ImportReferences
                | Request::ReauthorizeReference { .. }
        ) {
            return Err("visual_assets_worker_platform_unavailable".into());
        }
    }
    if crate::resource_export_picker::context(&window, &workspace_id)? != context {
        return Err("visual_assets_window_changed".into());
    }
    let profile = crate::app_paths::data_root()?;
    let root = profile.join("visual-assets");
    let output = tauri::async_runtime::spawn_blocking(move || {
        if crate::resource_export_picker::context(&window, &workspace_id)? != context {
            return Err("visual_assets_window_changed".to_string());
        }
        // First open reconciles publication before any list/import can touch the catalog.
        #[cfg(windows)]
        super::backup_commands::store()?;
        let _guard = LIBRARY.try_lock().map_err(|_| "visual_assets_busy")?;
        // Recheck after queueing, before reading or modifying any library data.
        if crate::resource_export_picker::context(&window, &workspace_id)? != context {
            return Err("visual_assets_window_changed".to_string());
        }
        std::fs::create_dir_all(&root).map_err(|_| "visual_assets_storage_unavailable")?;
        let mut db = catalog::open(&root).map_err(|_| "visual_assets_catalog_unavailable")?;
        #[cfg(windows)]
        if matches!(request, Request::ImportReferences) {
            let selected = reference.as_ref().ok_or("visual_assets_invalid_source")?;
            let items = super::reference_import::import_selected(
                &mut db,
                &root,
                &profile,
                &selected.root,
                &selected.files,
                &|_| {},
            )
            .map_err(super::reference_import::public_error)?;
            if crate::resource_export_picker::context(&window, &workspace_id)? != context {
                return Err("visual_assets_window_changed".into());
            }
            return Ok(json!({"items": items}));
        }
        #[cfg(windows)]
        if matches!(request, Request::ImportBatch) {
            let sources = sources.as_deref().ok_or("visual_assets_invalid_source")?;
            let items = super::import_batch::import_selected(&mut db, &root, sources, &|_| {})
                .map_err(|_| "visual_assets_import_failed")?;
            if crate::resource_export_picker::context(&window, &workspace_id)? != context {
                return Err("visual_assets_window_changed".into());
            }
            return Ok(json!({"items": items}));
        }
        #[cfg(windows)]
        if let Request::Characters { library_id, action } = request {
            return super::character_commands::apply(&mut db, &root, &library_id, action, &|_| {})
                .map_err(|error| {
                    let code = error.to_string();
                    if code.starts_with("visual_assets_") {
                        code
                    } else {
                        "visual_assets_character_operation_failed".into()
                    }
                });
        }
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| "visual_assets_busy")?;
        #[cfg(windows)]
        super::imports::recover(&tx, &root).map_err(|_| "visual_assets_recovery_failed")?;
        let library_id: String = tx
            .query_row("SELECT id FROM library", [], |row| row.get(0))
            .map_err(|_| "visual_assets_catalog_unavailable")?;
        let owner = Owner {
            window: context.window.clone(),
            workspace: context.workspace.clone(),
            route: context.route.clone(),
        };
        let result = match request {
            #[cfg(windows)]
            Request::Characters { .. }
            | Request::Generation { .. }
            | Request::NovelDrafts { .. } => unreachable!(),
            Request::ImportBatch
            | Request::ImportReferences
            | Request::StartBackup { .. }
            | Request::StartRestore
            | Request::StartAnimation { .. }
            | Request::PreviewAnimation { .. }
            | Request::PlanAnimationInstall { .. }
            | Request::ConfirmAnimationInstall { .. }
            | Request::CancelAnimationInstall { .. }
            | Request::PlanAnimationRetry { .. }
            | Request::ConfirmAnimationRetry { .. }
            | Request::CancelAnimationRetry { .. }
            | Request::BackupStatus
            | Request::CancelBackup { .. } => {
                unreachable!()
            }
            Request::Preview {
                library_id,
                asset_id,
                revision,
            } => {
                let ticket = PREVIEWS
                    .lock()
                    .map_err(|_| "visual_assets_unavailable")?
                    .issue(&tx, owner, &library_id, asset_id, revision)?;
                json!(ticket)
            }
            Request::ReadPreview { handle } => {
                let bytes = PREVIEWS
                    .lock()
                    .map_err(|_| "visual_assets_unavailable")?
                    .read(&tx, &root, &owner, &handle)?;
                json!({"mimeType": "image/png", "base64": bytes})
            }
            Request::ReauthorizeReference {
                library_id: expected,
                asset_id,
                revision,
            } => {
                #[cfg(windows)]
                {
                    if expected != library_id {
                        return Err("visual_assets_library_changed".into());
                    }
                    let selected = reference.as_ref().ok_or("visual_assets_invalid_source")?;
                    super::reference_import::reauthorize(
                        &tx,
                        &profile,
                        asset_id,
                        revision,
                        &selected.root,
                    )
                    .map_err(super::reference_import::public_error)?;
                    json!({"updated": true})
                }
                #[cfg(not(windows))]
                {
                    let _ = (expected, asset_id, revision);
                    return Err("visual_assets_worker_platform_unavailable".into());
                }
            }
            Request::List {
                after,
                query,
                tag,
                collection_id,
                duplicates_only,
            } => {
                let query = query.as_deref().unwrap_or_default().trim();
                let tag = tag.as_deref().unwrap_or_default().trim();
                if query
                    .chars()
                    .take(super::name_search::MAX_QUERY_CHARS + 1)
                    .count()
                    > super::name_search::MAX_QUERY_CHARS
                {
                    return Err("visual_assets_search_limit".into());
                }
                if !tag.is_empty() && !super::tags::valid(tag) {
                    return Err("visual_assets_invalid_tags".into());
                }
                let page = catalog::listing(
                    &tx,
                    after.unwrap_or(0),
                    query,
                    tag,
                    collection_id.as_deref(),
                    duplicates_only,
                )
                .map_err(|_| "visual_assets_query_failed")?;
                let collections =
                    collections::list(&tx).map_err(|_| "visual_assets_query_failed")?;
                #[cfg(windows)]
                let has_characters = super::characters::has_records(&tx)
                    .map_err(|_| "visual_assets_query_failed")?;
                #[cfg(not(windows))]
                let has_characters = false;
                json!({"libraryId": library_id, "page": page, "collections": collections,
                    "charactersAvailable": cfg!(windows), "hasCharacters": has_characters})
            }
            Request::ChangeCollections {
                library_id: expected_library,
                edit,
            } => {
                if library_id != expected_library {
                    return Err("visual_assets_library_changed".into());
                }
                let id = collections::apply(&tx, edit)?;
                json!({"id": id})
            }
            Request::SetTags {
                library_id: expected_library,
                asset_id,
                previous,
                tags,
            } => {
                if library_id != expected_library {
                    return Err("visual_assets_library_changed".into());
                }
                let tags = super::tags::replace(&tx, asset_id, &previous, &tags)?;
                json!({"tags": tags})
            }
            Request::Import => {
                #[cfg(windows)]
                {
                    let source = sources
                        .as_deref()
                        .and_then(|sources| sources.first())
                        .ok_or("visual_assets_invalid_source")?;
                    let id = super::imports::import(&tx, &root, source, &|_| {})
                        .map_err(|_| "visual_assets_import_failed")?;
                    json!({"libraryId": library_id, "assetId": id})
                }
                #[cfg(not(windows))]
                return Err("visual_assets_worker_platform_unavailable".into());
            }
        };
        tx.commit().map_err(|_| "visual_assets_commit_failed")?;
        if crate::resource_export_picker::context(&window, &workspace_id)? != context {
            return Err("visual_assets_window_changed".into());
        }
        Ok(result)
    })
    .await
    .map_err(|_| "visual_assets_unavailable")?;
    output
}
