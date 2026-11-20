//! Desktop product policy. Multi-workspace infrastructure remains reusable.
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkspaceMode {
    SingleDefault,
    Multiple,
}
static MODE: OnceLock<WorkspaceMode> = OnceLock::new();
// The reusable Host defaults to Multiple until the desktop composition root
// explicitly selects the current product mode. No test-only behavior is used.
pub(crate) fn initialize_desktop() {
    MODE.get_or_init(|| WorkspaceMode::SingleDefault);
}
pub(crate) fn single_default() -> bool {
    MODE.get() == Some(&WorkspaceMode::SingleDefault)
}
pub(crate) fn app_directory(root: &Path, system: &Path) -> PathBuf {
    directory_for(
        root,
        system,
        MODE.get().copied().unwrap_or(WorkspaceMode::Multiple),
    )
}
fn directory_for(root: &Path, system: &Path, mode: WorkspaceMode) -> PathBuf {
    match mode {
        WorkspaceMode::SingleDefault => system.join(".zicode"),
        WorkspaceMode::Multiple => root.join(".zicode"),
    }
}
pub(crate) fn default_startup(
    home: String,
    latest: Option<(String, String)>,
) -> (String, Option<String>) {
    let _ = latest;
    (home, None)
}
pub(crate) fn application_visible(id: &str) -> bool {
    !single_default() || id.split(':').next() != Some("com.zicode.projects")
}

// Resource contexts may retain their own working directory, while user data
// and background work have exactly one default desktop scope.
pub(crate) fn context_allowed(path: &Path) -> bool {
    if !single_default() {
        return true;
    }
    let default = crate::app_paths::global_workspace_root()
        .ok()
        .and_then(|root| root.canonicalize().ok());
    default.is_some() && path.canonicalize().ok() == default
}
type WorkspaceRoots = std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, PathBuf>>>;
pub(crate) fn automation_roots(roots: WorkspaceRoots) -> Result<WorkspaceRoots, String> {
    if !single_default() {
        return Ok(roots);
    }
    let filtered = roots
        .read()
        .map_err(|_| "Workspace registry is unavailable")?
        .iter()
        .filter(|(_, root)| context_allowed(root))
        .map(|(id, root)| (id.clone(), root.clone()))
        .collect();
    Ok(std::sync::Arc::new(std::sync::RwLock::new(filtered)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn single_default_keeps_app_data_at_one_fixed_root_for_all_resource_contexts() {
        let system = Path::new("/fixed/system");
        for root in [
            Path::new("/external/files"),
            Path::new("/old/project"),
            system,
        ] {
            assert_eq!(
                directory_for(root, system, WorkspaceMode::SingleDefault),
                system.join(".zicode")
            );
        }
    }
    #[test]
    fn multiple_workspace_extension_retains_independent_data_roots() {
        assert_eq!(
            directory_for(
                Path::new("/project"),
                Path::new("/fixed/system"),
                WorkspaceMode::Multiple
            ),
            Path::new("/project/.zicode")
        );
    }
    #[test]
    fn startup_ignores_old_project_and_session_selection() {
        assert_eq!(
            default_startup(
                "/fixed/system".into(),
                Some(("/old/project".into(), "/old/session".into()))
            ),
            ("/fixed/system".into(), None)
        );
    }
}
