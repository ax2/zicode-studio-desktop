//! Resolve JavaScript tooling from local evidence or a declared ancestor workspace.
use super::{catalog::read_manifest, pnpm_workspace, workspace_declarations};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Selection {
    pub manager: String,
    pub source: String,
    pub directory: String,
    pub inherited: bool,
    pub requirement: Option<String>,
}

fn relative(root: &Path, directory: &Path) -> Result<String, String> {
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| "task_directory_invalid")?;
    let parts = relative
        .iter()
        .map(|part| part.to_str().ok_or("task_directory_invalid"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join("/"))
}

fn package(root: &Path) -> Result<Option<Value>, String> {
    let Some(bytes) = read_manifest(root, "package.json")? else {
        return Ok(None);
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "task_manifest_invalid")?;
    if !value.is_object() {
        return Err("task_manifest_invalid".into());
    }
    Ok(Some(value))
}

fn file(root: &Path, name: &str) -> Result<bool, String> {
    let path = root.join(name);
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("task_manifest_unreadable".into()),
        Ok(_) => {}
    }
    let path = path
        .canonicalize()
        .map_err(|_| "task_manifest_unreadable")?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("task_manifest_invalid".into());
    }
    Ok(true)
}

fn local(root: &Path, value: Option<&Value>) -> Result<Option<Selection>, String> {
    if let Some(declared) = value.and_then(|value| value.get("packageManager")) {
        let declared = declared.as_str().ok_or("task_manager_unsupported")?;
        let name = declared.split('@').next().unwrap_or_default();
        if declared.len() > 200 || !["bun", "npm", "pnpm", "yarn"].contains(&name) {
            return Err("task_manager_unsupported".into());
        }
        return Ok(Some(Selection {
            manager: name.into(),
            source: "package.json#packageManager".into(),
            directory: String::new(),
            inherited: false,
            requirement: Some(declared.into()),
        }));
    }
    let mut selected: Option<Selection> = None;
    for (name, manager) in [
        ("bun.lock", "bun"),
        ("bun.lockb", "bun"),
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
        ("npm-shrinkwrap.json", "npm"),
        ("pnpm-workspace.yaml", "pnpm"),
    ] {
        if !file(root, name)? {
            continue;
        }
        if name == "pnpm-workspace.yaml" {
            pnpm_workspace::read(root).map_err(|_| "task_workspace_invalid")?;
        }
        if let Some(selected) = &selected {
            if selected.manager != manager {
                return Err("task_manager_conflicting".into());
            }
        } else {
            selected = Some(Selection {
                manager: manager.into(),
                source: name.into(),
                directory: String::new(),
                inherited: false,
                requirement: None,
            });
        }
    }
    Ok(selected)
}

fn fallback() -> Selection {
    Selection {
        manager: "npm".into(),
        source: "default".into(),
        directory: String::new(),
        inherited: false,
        requirement: None,
    }
}

pub(crate) fn select(
    root: &Path,
    workspace_root: &Path,
    value: &Value,
) -> Result<Selection, String> {
    let directory = relative(workspace_root, root)?;
    if let Some(mut selection) = local(root, Some(value))? {
        selection.directory = directory;
        return Ok(selection);
    }
    let mut ancestor = root;
    let mut depth = 0;
    while ancestor != workspace_root {
        depth += 1;
        if depth > 32 {
            return Err("task_workspace_invalid".into());
        }
        ancestor = ancestor.parent().ok_or("task_directory_invalid")?;
        if !ancestor.starts_with(workspace_root) {
            return Err("task_directory_invalid".into());
        }
        let member = relative(ancestor, root)?;
        match workspace_declarations::javascript_member(ancestor, &member)
            .map_err(|_| "task_workspace_invalid")?
        {
            None => continue,
            Some(false) => break,
            Some(true) => {
                let value = package(ancestor)?;
                let mut selection = local(ancestor, value.as_ref())?.unwrap_or_else(fallback);
                selection.directory = relative(workspace_root, ancestor)?;
                selection.inherited = true;
                return Ok(selection);
            }
        }
    }
    let mut selection = fallback();
    selection.directory = directory;
    Ok(selection)
}

pub(crate) fn inspect(root: &Path, workspace_root: &Path) -> Result<Option<Selection>, String> {
    let Some(value) = package(root)? else {
        return Ok(None);
    };
    select(root, workspace_root, &value).map(Some)
}
