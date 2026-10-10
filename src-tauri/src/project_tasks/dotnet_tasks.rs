//! Bounded discovery of .NET solutions and projects in the selected directory.
use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 2048;
const MAX_TARGETS: usize = 16;

fn supported(name: &str) -> bool {
    let Some((_, extension)) = name.rsplit_once('.') else {
        return false;
    };
    ["sln", "slnx", "csproj", "fsproj", "vbproj"]
        .iter()
        .any(|value| extension.eq_ignore_ascii_case(value))
}

pub(crate) fn manifest_names(root: &Path) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(root).map_err(|_| "task_manifest_unreadable")?;
    let mut names = vec![];
    for (index, entry) in entries.enumerate() {
        if index >= MAX_ENTRIES {
            return Err("task_catalog_too_large".into());
        }
        let entry = entry.map_err(|_| "task_manifest_unreadable")?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !supported(name) {
            continue;
        }
        if name.len() > 255 || name.chars().any(char::is_control) {
            return Err("task_manifest_invalid".into());
        }
        names.push(name.to_owned());
        if names.len() > MAX_TARGETS {
            return Err("task_catalog_too_large".into());
        }
    }
    names.sort();
    Ok(names)
}

pub(crate) fn sdk_manifest(
    root: &Path,
    workspace_root: &Path,
) -> Result<Option<(PathBuf, Vec<u8>)>, String> {
    let mut directory = root;
    loop {
        if let Some(bytes) = read_manifest(directory, "global.json")? {
            return Ok(Some((directory.join("global.json"), bytes)));
        }
        if directory == workspace_root {
            break;
        }
        let parent = directory.parent().ok_or("task_directory_invalid")?;
        if !parent.starts_with(workspace_root) {
            return Err("task_directory_invalid".into());
        }
        directory = parent;
    }
    Ok(None)
}

pub(super) fn append(
    root: &Path,
    workspace_root: &Path,
    tasks: &mut Vec<Task>,
    hash: &mut Sha256,
) -> Result<(), String> {
    let names = manifest_names(root)?;
    if names.is_empty() {
        return Ok(());
    }
    if let Some((path, bytes)) = sdk_manifest(root, workspace_root)? {
        hash.update(path.as_os_str().as_encoded_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    for name in names {
        let bytes = read_manifest(root, &name)?.ok_or("task_manifest_unreadable")?;
        hash.update(name.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
        let target = format!("./{name}");
        let solution = name.to_ascii_lowercase().ends_with(".sln")
            || name.to_ascii_lowercase().ends_with(".slnx");
        let verbs: &[&str] = if solution {
            &["restore", "build", "test"]
        } else {
            &["restore", "build", "test", "publish"]
        };
        for verb in verbs {
            let command = format!("dotnet {verb} {target:?}");
            tasks.push(Task {
                id: format!("@dotnet/{verb}/{name}"),
                name: command.clone(),
                command,
                runnable: true,
                source: name.clone(),
                manager: "dotnet".into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: vec![(*verb).into(), target.clone()],
            });
        }
    }
    Ok(())
}
