//! Bounded, read-only discovery and resolution of command directories inside a workspace.
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

const MANIFESTS: [&str; 12] = [
    "package.json",
    "Cargo.toml",
    "go.mod",
    "go.work",
    "pyproject.toml",
    "requirements.txt",
    "CMakeLists.txt",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
];
const MAX_DEPTH: usize = 4;
const MAX_ENTRIES: usize = 2048;
const MAX_PROJECTS: usize = 64;

pub(super) fn has_manifest(path: &Path) -> bool {
    MANIFESTS
        .iter()
        .any(|name| std::fs::symlink_metadata(path.join(name)).is_ok())
        || super::dotnet_tasks::manifest_names(path).is_ok_and(|names| !names.is_empty())
}

#[derive(Serialize)]
pub struct Directory {
    pub path: String,
    pub manifests: Vec<String>,
}

#[derive(Serialize)]
pub struct Discovery {
    pub directories: Vec<Directory>,
    pub incomplete: bool,
}

pub(super) fn linked(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn resolve(root: &Path, directory: &str) -> Result<PathBuf, String> {
    if directory.is_empty() {
        return Ok(root.to_path_buf());
    }
    if directory.len() > 2048 || directory.contains(['\\', ':', '\0']) {
        return Err("task_directory_invalid".into());
    }
    let mut path = root.to_path_buf();
    for part in directory.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err("task_directory_invalid".into());
        }
        path.push(part);
        let metadata =
            std::fs::symlink_metadata(&path).map_err(|_| "task_directory_unavailable")?;
        if linked(&metadata) || !metadata.is_dir() {
            return Err("task_directory_invalid".into());
        }
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "task_directory_unavailable")?;
    if !canonical.starts_with(root) {
        return Err("task_directory_invalid".into());
    }
    Ok(canonical)
}

pub(super) fn skipped(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules"
                | "target"
                | "dist"
                | "build"
                | "vendor"
                | "venv"
                | "__pycache__"
                | "site-packages"
        )
}

pub fn discover(root: &Path) -> Result<Discovery, String> {
    let members = super::workspace_declarations::discover(root);
    let mut result = Discovery {
        directories: vec![],
        incomplete: members.incomplete,
    };
    let mut queue = VecDeque::from([(String::new(), usize::MAX)]);
    // Inspect declared directories first, but do not recursively scan beneath them.
    queue.extend(members.paths.into_iter().map(|path| (path, usize::MAX)));
    queue.push_back((String::new(), 0));
    let mut visited = 0;
    while let Some((relative, depth)) = queue.pop_front() {
        let path = match resolve(root, &relative) {
            Ok(path) => path,
            Err(_) => {
                result.incomplete = true;
                continue;
            }
        };
        // Extra ecosystem and version files make subprojects selectable without
        // changing the manifest rule used to validate declared workspace members.
        let mut manifests: Vec<String> = MANIFESTS
            .iter()
            .chain(
                [
                    ".tool-versions",
                    ".ruby-version",
                    "Gemfile",
                    ".php-version",
                    "composer.json",
                    "deno.json",
                    "deno.jsonc",
                ]
                .iter(),
            )
            .chain(crate::host_data::mise_config_names().iter())
            .filter(|name| std::fs::symlink_metadata(path.join(name)).is_ok())
            .map(|name| (*name).into())
            .collect();
        match super::dotnet_tasks::manifest_names(&path) {
            Ok(names) => manifests.extend(names),
            Err(_) => result.incomplete = true,
        }
        if (relative.is_empty() || !manifests.is_empty())
            && !result.directories.iter().any(|item| item.path == relative)
        {
            result.directories.push(Directory {
                path: relative.clone(),
                manifests,
            });
            if result.directories.len() >= MAX_PROJECTS {
                result.incomplete = true;
                break;
            }
        }
        if depth == usize::MAX {
            if !result.directories.iter().any(|item| item.path == relative) {
                result.incomplete = true;
            }
            continue;
        }
        let entries = match std::fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) if relative.is_empty() => return Err("task_directory_unavailable".into()),
            Err(_) => {
                result.incomplete = true;
                continue;
            }
        };
        let mut children = vec![];
        for entry in entries {
            visited += 1;
            if visited > MAX_ENTRIES {
                result.incomplete = true;
                break;
            }
            let Ok(entry) = entry else {
                result.incomplete = true;
                continue;
            };
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                result.incomplete = true;
                continue;
            };
            if skipped(name) {
                continue;
            }
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                result.incomplete = true;
                continue;
            };
            if !metadata.is_dir() || linked(&metadata) {
                continue;
            }
            if depth >= MAX_DEPTH {
                result.incomplete = true;
                continue;
            }
            children.push(if relative.is_empty() {
                name.to_owned()
            } else {
                format!("{relative}/{name}")
            });
        }
        children.sort();
        queue.extend(children.into_iter().map(|path| (path, depth + 1)));
        if visited > MAX_ENTRIES {
            break;
        }
    }
    result
        .directories
        .sort_by(|left, right| left.path.cmp(&right.path));
    Ok(result)
}
