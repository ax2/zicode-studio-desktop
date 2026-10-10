//! Conservative, bounded discovery of local modules declared by go.work.
use super::{catalog::read_manifest, directories};
use std::collections::BTreeSet;
use std::path::Path;

const MAX_MODULES: usize = 63;

pub(super) struct Module {
    pub path: String,
    pub manifest: Vec<u8>,
}

pub(super) struct Workspace {
    pub bytes: Vec<u8>,
    pub modules: Vec<Module>,
    pub incomplete: bool,
}

fn path(value: &str) -> Option<String> {
    let value = value.trim();
    let (value, quoted) =
        if let Some(inner) = value.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
            // Only plain quoted paths are recognized; escaped Go strings need a full workfile parser.
            if inner.contains(['"', '\\']) {
                return None;
            }
            (inner, true)
        } else {
            (value, false)
        };
    if value == "." {
        return Some(String::new());
    }
    let relative = value.strip_prefix("./")?;
    if relative.is_empty()
        || relative.len() > 2048
        || !relative.chars().all(|ch| {
            ch.is_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/') || (quoted && ch == ' ')
        })
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    Some(relative.to_owned())
}

fn strip_line_comment(line: &str) -> &str {
    let mut quoted = false;
    let mut escaped = false;
    for (offset, ch) in line.char_indices() {
        if quoted && escaped {
            escaped = false;
            continue;
        }
        if quoted && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
        } else if !quoted && ch == '/' && line[offset + 1..].starts_with('/') {
            return &line[..offset];
        }
    }
    line
}

pub(super) fn read(root: &Path) -> Result<Option<Workspace>, ()> {
    let Some(bytes) = read_manifest(root, "go.work").map_err(|_| ())? else {
        return Ok(None);
    };
    let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
    let mut paths = BTreeSet::new();
    let mut incomplete = false;
    let mut block: Option<bool> = None; // true: use block; false: another directive block
    let mut block_comment = false;
    for raw in text.lines() {
        let line = strip_line_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        if block_comment {
            if line.contains("*/") {
                block_comment = false;
            }
            continue;
        }
        if line.contains("/*") || line.contains("*/") {
            incomplete = true;
            block_comment = line.contains("/*") && !line.contains("*/");
            continue;
        }
        if let Some(use_block) = block {
            if line == ")" {
                block = None;
            } else if use_block {
                match path(line) {
                    Some(path) => {
                        paths.insert(path);
                    }
                    None => incomplete = true,
                }
            }
            continue;
        }
        if line.ends_with('(') {
            block = Some(line.trim_end_matches('(').trim() == "use");
            continue;
        }
        if let Some(value) = line
            .strip_prefix("use")
            .filter(|value| value.chars().next().is_some_and(char::is_whitespace))
        {
            match path(value) {
                Some(path) => {
                    paths.insert(path);
                }
                None => incomplete = true,
            }
        } else if line == "use" || line.starts_with("use(") {
            incomplete = true;
        }
        if paths.len() > MAX_MODULES {
            incomplete = true;
            break;
        }
    }
    if block.is_some() || block_comment {
        incomplete = true;
    }
    let mut modules = Vec::new();
    for relative in paths.into_iter().take(MAX_MODULES) {
        let Ok(module) = directories::resolve(root, &relative) else {
            incomplete = true;
            continue;
        };
        let Ok(Some(manifest)) = read_manifest(&module, "go.mod") else {
            incomplete = true;
            continue;
        };
        modules.push(Module {
            path: relative,
            manifest,
        });
    }
    Ok(Some(Workspace {
        bytes,
        modules,
        incomplete,
    }))
}

/// Return the nearest workfile only when it explicitly names this module root.
pub(crate) fn member_workfile(
    root: &Path,
    workspace_root: &Path,
) -> Option<(std::path::PathBuf, Vec<u8>)> {
    // A local workfile takes precedence; even an unreadable one must not make
    // a more distant ancestor look like the active workspace.
    if !matches!(read_manifest(root, "go.work"), Ok(None)) {
        return None;
    }
    let mut ancestor = root.parent()?;
    for _ in 0..32 {
        if !ancestor.starts_with(workspace_root) {
            return None;
        }
        match read(ancestor) {
            Ok(Some(workspace)) => {
                if workspace.incomplete {
                    return None;
                }
                let relative = root
                    .strip_prefix(ancestor)
                    .ok()?
                    .iter()
                    .map(|part| part.to_str())
                    .collect::<Option<Vec<_>>>()?
                    .join("/");
                return workspace
                    .modules
                    .iter()
                    .any(|module| module.path == relative)
                    .then(|| (ancestor.join("go.work"), workspace.bytes));
            }
            Ok(None) => {}
            Err(()) => return None,
        }
        if ancestor == workspace_root {
            break;
        }
        ancestor = ancestor.parent()?;
    }
    None
}
