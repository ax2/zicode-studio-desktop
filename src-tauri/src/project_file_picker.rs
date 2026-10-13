//! File choice is not read authority. Content sharing still requires Host confirmation.
use crate::{
    explorer_launch_state::{EntryIntent, ExplorerLaunchState},
    host_server::HostServer,
    WindowWorkspaceState,
};
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

fn relative_directory(root: &Path, selected: &Path) -> Result<String, String> {
    let selected = selected.canonicalize().map_err(|_| "Selected directory is unavailable")?;
    let path = selected.strip_prefix(root).map_err(|_| "Choose a directory inside the current project")?;
    if !selected.is_dir() { return Err("Choose a project directory".into()); }
    if path.as_os_str().is_empty() { return Ok(".".into()); }
    let parts = path.components().map(|component| match component {
        std::path::Component::Normal(value) => value.to_str().ok_or("Unsupported directory name"),
        _ => Err("Unsupported directory name"),
    }).collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join("/"))
}

#[tauri::command]
pub async fn select_project_resource_directory(
    app: AppHandle, window: WebviewWindow, workspace_id: String,
) -> Result<Option<String>, String> {
    current(&window, &workspace_id)?;
    let root = app.state::<HostServer>().project_resource_root(&workspace_id)?;
    let initial = root.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_directory(initial).blocking_pick_folder()
    }).await.map_err(|_| "Directory picker is unavailable")?;
    current(&window, &workspace_id)?;
    if window.state::<HostServer>().project_resource_root(&workspace_id)? != root {
        return Err("Project changed; choose the directory again".into());
    }
    picked.map(|directory| relative_directory(&root,
        directory.as_path().ok_or("Choose a local project directory")?)).transpose()
}

#[tauri::command]
pub fn get_project_resource_entry(
    window: WebviewWindow,
    workspace_id: String,
) -> Result<Option<String>, String> {
    current(&window, &workspace_id)?;
    let route = window.url().map_err(|error| error.to_string())?;
    let intent = window
        .state::<ExplorerLaunchState>()
        .intent(window.label(), route.path())?;
    let Some(EntryIntent::File(file)) = intent else {
        return Ok(None);
    };
    let root = window
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    // A launch file is scoped to its original parent project. Never carry it
    // into another window/project or expose its absolute path to plugins.
    if file.parent() != Some(root.as_path()) {
        return Ok(None);
    }
    relative(&root, &file).map(Some)
}

/// Returns launch names only; no file bytes or absolute paths cross this boundary.
/// Recheck the current window, project and session on every query.
#[tauri::command]
pub fn get_project_resource_entries(
    window: WebviewWindow,
    workspace_id: String,
) -> Result<Vec<String>, String> {
    current(&window, &workspace_id)?;
    let route = window.url().map_err(|error| error.to_string())?;
    let intent = window
        .state::<ExplorerLaunchState>()
        .intent(window.label(), route.path())?;
    let files = match intent {
        Some(EntryIntent::File(file)) => vec![file],
        Some(EntryIntent::Selection(files)) => files,
        _ => return Ok(Vec::new()),
    };
    let root = window
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    files.iter().map(|file| {
        if file.parent() != Some(root.as_path()) {
            return Err("Selected files no longer belong to this project".into());
        }
        relative(&root, file)
    }).collect()
}

/// A folder launch is only a directory-tool discovery hint. It grants no read
/// access and never exposes the absolute Explorer path to the WebView.
#[tauri::command]
pub fn get_project_directory_entry(
    window: WebviewWindow,
    workspace_id: String,
) -> Result<Option<&'static str>, String> {
    current(&window, &workspace_id)?;
    let route = window.url().map_err(|error| error.to_string())?;
    let intent = window
        .state::<ExplorerLaunchState>()
        .intent(window.label(), route.path())?;
    let Some(EntryIntent::Folder(selected)) = intent else {
        return Ok(None);
    };
    let root = window
        .state::<HostServer>()
        .project_resource_root(&workspace_id)?;
    Ok(directory_entry(&root, Some(&selected), false))
}

fn directory_entry(root: &Path, selected: Option<&Path>, drive_root: bool) -> Option<&'static str> {
    (!drive_root && selected == Some(root)).then_some(".")
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
    fn folder_launch_hint_is_scoped_to_the_selected_project_and_not_the_drive() {
        let selected = Path::new("selected-project");
        let other = Path::new("other-project");
        assert_eq!(directory_entry(selected, Some(selected), false), Some("."));
        assert_eq!(directory_entry(other, Some(selected), false), None);
        assert_eq!(directory_entry(selected, Some(selected), true), None);
        assert_eq!(directory_entry(selected, None, false), None);
    }
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
        assert_eq!(relative_directory(&project, &project).unwrap(), ".");
        assert_eq!(relative_directory(&project, &project.join("中文 空格&")).unwrap(), "中文 空格&");
        assert!(relative_directory(&project, &root).is_err());
        assert!(relative_directory(&project, &project.join("中文 空格&/a.zip")).is_err());
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
