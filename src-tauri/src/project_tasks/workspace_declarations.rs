//! A bounded subset of root workspace declarations, without running package managers.
use super::{
    catalog::read_manifest,
    deno_tasks, directories, pnpm_workspace,
    workspace_patterns::{Part, WorkspacePattern},
};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet, VecDeque};
use std::path::Path;

const MAX_PATTERNS: usize = 128;
const MAX_STEPS: usize = 2048;
const MAX_MEMBERS: usize = 63;

#[derive(Default)]
pub(super) struct Members {
    pub paths: BTreeSet<String>,
    pub incomplete: bool,
}

struct Declaration {
    includes: Vec<WorkspacePattern>,
    excludes: Vec<WorkspacePattern>,
}

fn patterns(value: Option<&Value>) -> Result<Vec<WorkspacePattern>, ()> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let array = value.as_array().ok_or(())?;
    if array.len() > MAX_PATTERNS {
        return Err(());
    }
    array
        .iter()
        .map(|item| WorkspacePattern::parse(item.as_str().ok_or(())?))
        .collect()
}

fn declaration(root: &Path, cargo: bool) -> Result<Option<Declaration>, ()> {
    let name = if cargo { "Cargo.toml" } else { "package.json" };
    let Some(bytes) = read_manifest(root, name).map_err(|_| ())? else {
        return Ok(None);
    };
    let value: Value = if cargo {
        let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
        let table: toml::Value = toml::from_str(text).map_err(|_| ())?;
        serde_json::to_value(table).map_err(|_| ())?
    } else {
        serde_json::from_slice(&bytes).map_err(|_| ())?
    };
    if !value.is_object() {
        return Err(());
    }
    let Some(workspace) = value.get(if cargo { "workspace" } else { "workspaces" }) else {
        return Ok(None);
    };
    let (includes, excludes) = if cargo {
        if !workspace.is_object() {
            return Err(());
        }
        (
            patterns(workspace.get("members"))?,
            patterns(workspace.get("exclude"))?,
        )
    } else if workspace.is_array() {
        (patterns(Some(workspace))?, vec![])
    } else if workspace.is_object() && workspace.get("packages").is_some() {
        (patterns(workspace.get("packages"))?, vec![])
    } else {
        return Err(());
    };
    if includes.len() + excludes.len() > MAX_PATTERNS {
        return Err(());
    }
    Ok(Some(Declaration { includes, excludes }))
}

fn uv_declaration(root: &Path) -> Result<Option<Declaration>, ()> {
    let Some(bytes) = read_manifest(root, "pyproject.toml").map_err(|_| ())? else {
        return Ok(None);
    };
    let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
    let table: toml::Value = toml::from_str(text).map_err(|_| ())?;
    let value = serde_json::to_value(table).map_err(|_| ())?;
    let Some(workspace) = value
        .get("tool")
        .and_then(|tool| tool.get("uv"))
        .and_then(|uv| uv.get("workspace"))
    else {
        return Ok(None);
    };
    if !workspace.is_object() {
        return Err(());
    }
    let includes = patterns(workspace.get("members"))?;
    let excludes = patterns(workspace.get("exclude"))?;
    if includes.len() + excludes.len() > MAX_PATTERNS {
        return Err(());
    }
    Ok(Some(Declaration { includes, excludes }))
}

fn deno_declaration(root: &Path) -> Result<Option<Declaration>, ()> {
    let mut config = None;
    for name in ["deno.json", "deno.jsonc"] {
        if let Some(bytes) = read_manifest(root, name).map_err(|_| ())? {
            config = Some(bytes);
            break;
        }
    }
    let Some(bytes) = config else {
        return Ok(None);
    };
    let value = deno_tasks::parse_config(&bytes)?;
    let document = value.as_object().ok_or(())?;
    let Some(workspace) = document.get("workspace") else {
        return Ok(None);
    };
    Ok(Some(Declaration {
        includes: patterns(Some(workspace))?,
        excludes: vec![],
    }))
}

fn expand(
    root: &Path,
    declaration: Declaration,
    result: &mut Members,
    steps: &mut usize,
    allow_deno: bool,
) {
    for pattern in declaration.includes {
        let mut queue = VecDeque::from([(String::new(), 0)]);
        let mut seen = HashSet::new();
        while let Some((relative, index)) = queue.pop_front() {
            if *steps >= MAX_STEPS {
                result.incomplete = true;
                return;
            }
            *steps += 1;
            if !seen.insert((relative.clone(), index)) {
                continue;
            }
            let Ok(path) = directories::resolve(root, &relative) else {
                result.incomplete = true;
                continue;
            };
            if index == pattern.parts.len() {
                if !relative.is_empty()
                    && !declaration
                        .excludes
                        .iter()
                        .any(|pattern| pattern.matches(&relative))
                {
                    // Recursive patterns visit intermediate directories, which need not be projects.
                    let has_deno_config = allow_deno
                        && ["deno.json", "deno.jsonc"]
                            .iter()
                            .any(|name| std::fs::symlink_metadata(path.join(name)).is_ok());
                    if !directories::has_manifest(&path) && !has_deno_config {
                        if pattern
                            .parts
                            .iter()
                            .all(|part| matches!(part, Part::Literal(_)))
                        {
                            result.incomplete = true;
                        }
                        continue;
                    }
                    if result.paths.len() >= MAX_MEMBERS && !result.paths.contains(&relative) {
                        result.incomplete = true;
                        return;
                    }
                    result.paths.insert(relative);
                }
                continue;
            }
            let part = &pattern.parts[index];
            let recursive = matches!(part, Part::Recursive);
            if recursive {
                queue.push_back((relative.clone(), index + 1));
            }
            let depth = if relative.is_empty() {
                0
            } else {
                relative.split('/').count()
            };
            if depth >= 32 {
                result.incomplete = true;
                continue;
            }
            let mut children = vec![];
            if let Part::Literal(name) = part {
                if directories::skipped(name) {
                    result.incomplete = true;
                } else {
                    children.push(name.clone());
                }
            } else {
                let Ok(entries) = std::fs::read_dir(path) else {
                    result.incomplete = true;
                    continue;
                };
                for entry in entries {
                    if *steps >= MAX_STEPS {
                        result.incomplete = true;
                        break;
                    }
                    *steps += 1;
                    let Ok(entry) = entry else {
                        result.incomplete = true;
                        continue;
                    };
                    let name = entry.file_name();
                    let Some(name) = name.to_str() else {
                        result.incomplete = true;
                        continue;
                    };
                    if directories::skipped(name) || !part.matches(name) {
                        continue;
                    }
                    let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                        result.incomplete = true;
                        continue;
                    };
                    if metadata.is_dir() && !directories::linked(&metadata) {
                        children.push(name.to_owned());
                    }
                }
                children.sort();
            }
            for child in children {
                let child = if relative.is_empty() {
                    child
                } else {
                    format!("{relative}/{child}")
                };
                queue.push_back((child, if recursive { index } else { index + 1 }));
            }
        }
    }
}

fn pnpm_declaration(root: &Path) -> Result<Option<Declaration>, ()> {
    let Some(packages) = pnpm_workspace::read(root)? else {
        return Ok(None);
    };
    let mut declaration = Declaration {
        includes: vec![],
        excludes: vec![],
    };
    for value in packages {
        if let Some(value) = value.strip_prefix('!') {
            declaration.excludes.push(WorkspacePattern::parse(value)?);
        } else {
            declaration.includes.push(WorkspacePattern::parse(&value)?);
        }
    }
    Ok(Some(declaration))
}

pub(super) fn discover(root: &Path) -> Members {
    let mut result = Members::default();
    let mut steps = 0;
    let javascript = match pnpm_declaration(root) {
        Ok(None) => declaration(root, false),
        pnpm => pnpm,
    };
    for (declaration, allow_deno) in [
        (javascript, false),
        (declaration(root, true), false),
        (uv_declaration(root), false),
        (deno_declaration(root), true),
    ] {
        match declaration {
            Ok(Some(declaration)) => expand(root, declaration, &mut result, &mut steps, allow_deno),
            Ok(None) => {}
            Err(()) => result.incomplete = true,
        }
    }
    match super::go_work::read(root) {
        Ok(Some(workspace)) => {
            result.incomplete |= workspace.incomplete;
            for module in workspace.modules {
                if module.path.is_empty() {
                    continue;
                }
                if result.paths.len() >= MAX_MEMBERS && !result.paths.contains(&module.path) {
                    result.incomplete = true;
                    break;
                }
                result.paths.insert(module.path);
            }
        }
        Ok(None) => {}
        Err(()) => result.incomplete = true,
    }
    result
}

pub(super) fn uv_member(root: &Path, relative: &str) -> Result<Option<bool>, ()> {
    Ok(uv_declaration(root)?.map(|declaration| {
        declaration
            .includes
            .iter()
            .any(|pattern| pattern.matches(relative))
            && !declaration
                .excludes
                .iter()
                .any(|pattern| pattern.matches(relative))
    }))
}

/// Check the selected path directly, independently of bounded directory discovery.
pub(super) fn javascript_member(root: &Path, relative: &str) -> Result<Option<bool>, ()> {
    let declaration = match pnpm_declaration(root) {
        Ok(None) => declaration(root, false),
        pnpm => pnpm,
    }?;
    Ok(declaration.map(|declaration| {
        declaration
            .includes
            .iter()
            .any(|pattern| pattern.matches(relative))
            && !declaration
                .excludes
                .iter()
                .any(|pattern| pattern.matches(relative))
    }))
}

/// None means no Cargo workspace; Some(None) means this workspace does not
/// provide an applicable version for the selected member.
pub(crate) fn rust_member_version(
    root: &Path,
    relative: &str,
    explicit_workspace: bool,
) -> Result<Option<Option<String>>, ()> {
    let Some(declaration) = declaration(root, true)? else {
        return Ok(None);
    };
    if (!explicit_workspace
        && !declaration
            .includes
            .iter()
            .any(|pattern| pattern.matches(relative)))
        || declaration
            .excludes
            .iter()
            .any(|pattern| pattern.matches(relative))
    {
        return Ok(Some(None));
    }
    let bytes = read_manifest(root, "Cargo.toml")
        .map_err(|_| ())?
        .ok_or(())?;
    let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
    let value: toml::Value = toml::from_str(text).map_err(|_| ())?;
    let version = value
        .get("workspace")
        .and_then(|workspace| workspace.get("package"))
        .and_then(|package| package.get("rust-version"));
    match version {
        Some(toml::Value::String(version)) => Ok(Some(Some(version.clone()))),
        Some(_) => Err(()),
        None => Ok(Some(None)),
    }
}

pub(crate) fn rust_workspace_pointer(
    root: &Path,
    workspace_root: &Path,
) -> Result<Option<std::path::PathBuf>, ()> {
    let bytes = read_manifest(root, "Cargo.toml")
        .map_err(|_| ())?
        .ok_or(())?;
    let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
    let value: toml::Value = toml::from_str(text).map_err(|_| ())?;
    if value.get("workspace").is_some() {
        return Err(());
    }
    let Some(pointer) = value
        .get("package")
        .and_then(|package| package.get("workspace"))
    else {
        return Ok(None);
    };
    let pointer = pointer.as_str().ok_or(())?;
    if pointer.is_empty() || pointer.len() > 2048 || Path::new(pointer).is_absolute() {
        return Err(());
    }
    let target = root.join(pointer).canonicalize().map_err(|_| ())?;
    if !target.is_dir() || !target.starts_with(workspace_root) || !root.starts_with(&target) {
        return Err(());
    }
    Ok(Some(target))
}
