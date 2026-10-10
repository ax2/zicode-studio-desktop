//! Project-scoped SDK selection, without evaluating a solution or MSBuild target.
use super::ToolReport;
use std::path::Path;

pub(super) async fn inspect(
    root: &Path,
    workspace_root: &Path,
    environment: &crate::project_environment::Environment,
) -> Option<ToolReport> {
    let has_target = crate::project_tasks::dotnet_tasks::manifest_names(root)
        .is_ok_and(|names| !names.is_empty());
    let has_sdk = crate::project_tasks::dotnet_tasks::sdk_manifest(root, workspace_root)
        .is_ok_and(|manifest| manifest.is_some());
    if !has_target && !has_sdk {
        return None;
    }
    let mut report = super::probe::probe_environment_at(
        root,
        workspace_root,
        "dotnet-project",
        &["dotnet"],
        "--version",
        environment,
        root,
    )
    .await;
    report.source = Some("project-directory");
    Some(report)
}
