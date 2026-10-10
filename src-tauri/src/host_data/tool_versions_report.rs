use super::{read_manifest, ProjectManifest, Requirement};
use std::collections::HashSet;
use std::path::Path;

const FILE: &str = ".tool-versions";
const MAX_TOOLS: usize = 64;
const MAX_TOOL_NAME: usize = 64;

fn present(directory: &Path) -> bool {
    !matches!(
        std::fs::symlink_metadata(directory.join(FILE)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    )
}

pub(super) fn inherited(root: &Path, workspace_root: &Path) -> Option<ProjectManifest> {
    if present(root) {
        return None;
    }
    let mut ancestor = root;
    for _ in 0..32 {
        let parent = ancestor.parent()?;
        if !parent.starts_with(workspace_root) {
            return None;
        }
        ancestor = parent;
        if present(ancestor) {
            return Some(report(ancestor, workspace_root));
        }
        if ancestor == workspace_root {
            break;
        }
    }
    None
}

fn report(directory: &Path, workspace_root: &Path) -> ProjectManifest {
    let path = directory.join(FILE);
    let name = path
        .strip_prefix(workspace_root)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .replace('\\', "/");
    let mut report = ProjectManifest {
        name,
        kind: "tool-versions",
        status: "detected",
        requirements: vec![],
    };
    let canonical = match path.canonicalize() {
        Ok(canonical) => canonical,
        Err(_) => {
            report.status = "unreadable";
            return report;
        }
    };
    if !canonical.starts_with(directory) || !canonical.is_file() {
        report.status = "outside_project";
        return report;
    }
    match read_manifest(&canonical).and_then(|text| parse(&text)) {
        Ok(requirements) => report.requirements = requirements,
        Err(status) => report.status = status,
    }
    report
}

pub(super) fn parse(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let mut requirements = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines() {
        let declaration = line.split('#').next().unwrap_or("").trim();
        if declaration.is_empty() {
            continue;
        }
        let mut parts = declaration.split_whitespace();
        let source = parts.next().ok_or("invalid")?;
        if source.len() > MAX_TOOL_NAME
            || !source
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            || !seen.insert(source)
            || seen.len() > MAX_TOOLS
        {
            return Err("invalid");
        }
        let versions: Vec<_> = parts.collect();
        if versions.is_empty() {
            return Err("invalid");
        }
        let constraint = versions.join(" ");
        requirements.push(Requirement {
            tool: source.into(),
            constraint: constraint.chars().take(200).collect(),
            truncated: constraint.chars().count() > 200,
            kind: Some("version-manager"),
            assessment: None,
        });
    }
    Ok(requirements)
}
