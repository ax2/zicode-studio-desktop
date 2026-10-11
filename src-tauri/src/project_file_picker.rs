//! File choice is not read authority. Content sharing still requires Host confirmation.
use crate::{host_server::HostServer, WindowWorkspaceState};
use std::path::Path;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn current(window: &WebviewWindow, workspace: &str) -> Result<(), String> {
    crate::require_workspace_window(window)?;
    let state = window
        .try_state::<WindowWorkspaceState>()
        .ok_or("Project is unavailable")?;
    let entries = state.0.lock().map_err(|_| "Project is unavailable")?;
    if entries.get(window.label()).map(String::as_str) != Some(workspace) {
        return Err("Project changed; choose the file again".into());
    }
    Ok(())
}
fn relative(root: &Path, selected: &Path) -> Result<String, String> {
    let selected = selected
        .canonicalize()
        .map_err(|_| "Selected file is unavailable")?;
    let path = selected
        .strip_prefix(root)
        .map_err(|_| "Choose a file inside the current project")?;
    if !selected.is_file() || path.as_os_str().is_empty() {
        return Err("Choose a project file".into());
    }
    let parts = path
        .components()
        .map(|p| match p {
            std::path::Component::Normal(value) => value.to_str().ok_or("Unsupported file name"),
            _ => Err("Unsupported file name"),
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join("/"))
}

#[tauri::command]
pub async fn select_project_resource_file(
    app: AppHandle,
    window: WebviewWindow,
    workspace_id: String,
) -> Result<Option<String>, String> {
    current(&window, &workspace_id)?;
    let root = app
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    let initial = root.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_directory(initial)
            .blocking_pick_file()
    })
    .await
    .map_err(|_| "File picker is unavailable")?;
    current(&window, &workspace_id)?;
    if window
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?
        != root
    {
        return Err("Project changed; choose the file again".into());
    }
    picked
        .map(|file| relative(&root, file.as_path().ok_or("Choose a local project file")?))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_file_must_be_inside_project_and_only_relative_name_is_returned() {
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("project-picker-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("project/中文 空格&")).unwrap();
        std::fs::write(
            root.join("owner.json"),
            br#"{"purpose":"project picker boundaries; remove own fixture on success"}"#,
        )
        .unwrap();
        std::fs::write(root.join("project/中文 空格&/a.zip"), b"input").unwrap();
        std::fs::write(root.join("outside.zip"), b"outside").unwrap();
        let project = root.join("project").canonicalize().unwrap();
        assert_eq!(
            relative(&project, &project.join("中文 空格&/a.zip")).unwrap(),
            "中文 空格&/a.zip"
        );
        assert!(relative(&project, &root.join("outside.zip")).is_err());
        assert!(relative(&project, &project).is_err());
        assert!(relative(&project, &project.join("missing")).is_err());
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
