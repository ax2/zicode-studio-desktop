//! Keep the automation executor's workspace registry in sync with other
//! desktop processes that can register or remove projects independently.

use super::lifecycle::HostLifecycle;
use crate::metadata_store::MetadataStore;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

type WorkspaceRoots = Arc<RwLock<HashMap<String, PathBuf>>>;

pub(super) async fn refresh_until_ready(roots: &WorkspaceRoots, lifecycle: &HostLifecycle) {
    // Host contract tests supply isolated workspace roots and must not read
    // the real user's shared registry.
    if cfg!(test) {
        return;
    }
    loop {
        if refresh(roots.clone(), lifecycle).await {
            return;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

pub(super) async fn run(roots: WorkspaceRoots, lifecycle: HostLifecycle) {
    if cfg!(test) {
        return;
    }
    let mut ticker = tokio::time::interval(Duration::from_secs(15));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // The initial refresh is completed before the automation loops start.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        refresh(roots.clone(), &lifecycle).await;
    }
}

async fn refresh(roots: WorkspaceRoots, lifecycle: &HostLifecycle) -> bool {
    match lifecycle.blocking(move || refresh_blocking(&roots)).await {
        Ok(Ok(count)) => {
            log::debug!("[automation] synchronized {count} registered workspaces");
            true
        }
        Ok(Err(error)) => {
            log::warn!("[automation] workspace registry refresh failed: {error}");
            false
        }
        Err(error) => {
            log::warn!("[automation] workspace registry refresh stopped: {error}");
            false
        }
    }
}

fn refresh_blocking(roots: &WorkspaceRoots) -> Result<usize, String> {
    let metadata_path = crate::app_paths::metadata_path()?;
    let metadata = MetadataStore::open_read_only(&metadata_path)?;
    let mut next = HashMap::new();
    for (id, path) in metadata.list_workspaces()? {
        let Ok(root) = PathBuf::from(path).canonicalize() else {
            continue;
        };
        if root.is_dir() {
            next.insert(id, root);
        }
    }
    let count = next.len();
    *roots
        .write()
        .map_err(|_| "workspace registry is unavailable".to_string())? = next;
    Ok(count)
}
