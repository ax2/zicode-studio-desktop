//! The native picker passes paths directly to one-use Host grants.
use super::{export::Context, *};
use std::collections::HashSet;

const PROFILE: &str = "resource.local-file.native-selection.draft1";

pub(super) struct PickedFile {
    pub(super) context: Context,
    pub(super) directory: PathBuf,
}

fn owner(value: Value) -> Result<Owner, String> {
    serde_json::from_value(value).map_err(|_| "resource_scope_invalid".to_owned())
}

fn error_code((_, Json(error)): ApiError) -> String {
    error["error"]["code"]
        .as_str()
        .unwrap_or("resource_store_unavailable")
        .to_owned()
}

impl HostServer {
    pub(crate) async fn prepare_native_digest_files(
        &self,
        context: Context,
        owner_value: Value,
        paths: Vec<PathBuf>,
    ) -> Result<Value, String> {
        let owner = owner(owner_value)?;
        let state = self.state.clone();
        blocking(state.clone(), move || {
            if !file_reference::is_source(&owner) {
                return Err(rejected("resource_scope_invalid"));
            }
            if paths.is_empty()
                || paths.len() > crate::plugin_resource_execution::file_digest::MAX_FILES
            {
                return Err(rejected("resource_file_selection_invalid"));
            }
            let (root, proof) = scope_in_workspace(&state, &owner, Some(&context.workspace))?;
            let mut grants = Vec::with_capacity(paths.len());
            let mut summaries = Vec::with_capacity(paths.len());
            let mut identities = HashSet::new();
            let mut total = 0usize;
            let expires = Instant::now() + TTL;
            for path in paths {
                let directory = path
                    .parent()
                    .ok_or_else(|| rejected("resource_file_path_invalid"))?;
                let relative = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .filter(|name| {
                        !name.chars().any(
                            |ch| matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'),
                        )
                    })
                    .ok_or_else(|| rejected("resource_file_path_invalid"))?;
                let file = local_directory::open_picked_file(directory, relative)?;
                let (stamp, length) = files::stamp(&file)?;
                if !identities.insert(stamp.clone()) {
                    return Err(rejected("resource_file_selection_invalid"));
                }
                total = total
                    .checked_add(length)
                    .filter(|total| *total <= MAX_BYTES)
                    .ok_or_else(|| rejected("resource_input_too_large"))?;
                grants.push(Grant {
                    owner: owner.clone(),
                    proof: proof.clone(),
                    root: root.clone(),
                    relative: relative.to_owned(),
                    stamp,
                    expires,
                    picked: Some(PickedFile {
                        context: context.clone(),
                        directory: directory.to_owned(),
                    }),
                });
                summaries.push((relative.to_owned(), length));
            }
            if scope_in_workspace(&state, &owner, Some(&context.workspace))? != (root, proof) {
                return Err(rejected("resource_authorization_changed"));
            }
            let ids = state
                .plugin_resources
                .lock()
                .map_err(|_| rejected("resource_store_unavailable"))?
                .file_imports
                .insert_batch(grants)?;
            let files = summaries
                .into_iter()
                .zip(ids)
                .map(|((name, length), id)| json!({"grantId":id,"name":name,"byteLength":length}))
                .collect::<Vec<_>>();
            Ok(
                json!({"schemaVersion":1,"profile":PROFILE,"owner":owner,"expiresInSeconds":120,
                "contentRead":false,"confirmed":false,"files":files}),
            )
        })
        .await
        .map(|Json(value)| value)
        .map_err(error_code)
    }

    pub(crate) async fn commit_native_digest_file(
        &self,
        context: Context,
        owner_value: Value,
        grant_id: String,
        confirmed: bool,
    ) -> Result<Value, String> {
        let request = FileGrant {
            schema_version: 1,
            owner: owner(owner_value)?,
            grant_id,
            confirmed,
        };
        commit_grant(self.state.clone(), request, Some(context))
            .await
            .map(|Json(value)| value)
            .map_err(error_code)
    }

    pub(crate) fn cancel_native_digest_file(
        &self,
        context: &Context,
        owner_value: Value,
        grant_id: String,
    ) -> Result<Value, String> {
        let request = FileGrant {
            schema_version: 1,
            owner: owner(owner_value)?,
            grant_id,
            confirmed: false,
        };
        self.state
            .plugin_resources
            .lock()
            .map_err(|_| "resource_store_unavailable".to_owned())?
            .file_imports
            .cancel(&request, Some(context))
            .map_err(error_code)
    }

    pub(crate) fn discard_native_resource(&self, result: &Value) {
        if let Ok(access) = serde_json::from_value::<Access>(result["access"].clone()) {
            if let Ok(mut store) = self.state.plugin_resources.lock() {
                let _ = store.revoke(&access);
            }
        }
    }
}
