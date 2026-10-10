use super::{read_manifest, ProjectManifest, Requirement};
use std::path::Path;

pub(super) const FILES: [&str; 8] = [
    "mise.local.toml",
    ".mise.local.toml",
    "mise.toml",
    ".mise.toml",
    "mise/config.toml",
    ".mise/config.toml",
    ".config/mise.toml",
    ".config/mise/config.toml",
];
const MAX_TOOLS: usize = 64;

pub(super) fn inherited(root: &Path, workspace_root: &Path) -> Vec<ProjectManifest> {
    let mut ancestor = root;
    let mut reports = vec![];
    for _ in 0..32 {
        let Some(parent) = ancestor.parent() else {
            break;
        };
        if !parent.starts_with(workspace_root) {
            break;
        }
        ancestor = parent;
        reports.extend(
            FILES
                .iter()
                .filter(|name| present(ancestor, name))
                .map(|name| report(ancestor, workspace_root, name)),
        );
        if ancestor == workspace_root {
            break;
        }
    }
    reports
}

fn present(directory: &Path, name: &str) -> bool {
    !matches!(
        std::fs::symlink_metadata(directory.join(name)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    )
}

fn report(directory: &Path, workspace_root: &Path, file: &str) -> ProjectManifest {
    let path = directory.join(file);
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
        Ok(path) => path,
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
    let value: toml::Value = text.parse().map_err(|_| "invalid")?;
    let Some(document) = value.as_table() else {
        return Err("invalid");
    };
    let Some(tools) = document.get("tools") else {
        return Ok(vec![]);
    };
    let Some(tools) = tools.as_table() else {
        return Err("invalid");
    };
    if tools.len() > MAX_TOOLS {
        return Err("invalid");
    }
    let mut requirements = Vec::with_capacity(tools.len());
    for (tool, declaration) in tools {
        if tool.is_empty() || tool.len() > 64 || tool.chars().any(|ch| ch.is_control()) {
            return Err("invalid");
        }
        let constraint = version_text(declaration).unwrap_or_else(|| "complex declaration".into());
        requirements.push(Requirement {
            tool: tool.to_owned(),
            constraint: constraint.chars().take(200).collect(),
            truncated: constraint.chars().count() > 200,
            kind: Some("version-manager"),
            assessment: None,
        });
    }
    Ok(requirements)
}

fn version_text(value: &toml::Value) -> Option<String> {
    let value = if let Some(table) = value.as_table() {
        if table.len() != 1 {
            return None;
        }
        table.get("version")?
    } else {
        value
    };
    let versions: Vec<&str> = if let Some(single) = value.as_str() {
        vec![single]
    } else {
        value
            .as_array()?
            .iter()
            .map(toml::Value::as_str)
            .collect::<Option<_>>()?
    };
    if versions.is_empty()
        || versions
            .iter()
            .any(|value| value.is_empty() || value.chars().any(char::is_control))
    {
        return None;
    }
    Some(versions.join(" "))
}
