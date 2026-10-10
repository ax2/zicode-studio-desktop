use super::{language_requirements, read_manifest, ProjectManifest};
use std::path::Path;

const FILES: [&str; 2] = ["rust-toolchain.toml", "rust-toolchain"];

fn present(directory: &Path, name: &str) -> bool {
    !matches!(
        std::fs::symlink_metadata(directory.join(name)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    )
}

pub(super) fn inherited(root: &Path, workspace_root: &Path) -> Vec<ProjectManifest> {
    if FILES.iter().any(|name| present(root, name)) {
        return vec![];
    }
    let mut ancestor = root;
    for _ in 0..32 {
        let Some(parent) = ancestor.parent() else {
            break;
        };
        if !parent.starts_with(workspace_root) {
            break;
        }
        ancestor = parent;
        let found: Vec<_> = FILES
            .iter()
            .copied()
            .filter(|name| present(ancestor, name))
            .collect();
        if !found.is_empty() {
            let conflicting = found.len() > 1;
            return found
                .into_iter()
                .map(|name| report(ancestor, workspace_root, name, conflicting))
                .collect();
        }
        if ancestor == workspace_root {
            break;
        }
    }
    vec![]
}

fn report(
    directory: &Path,
    workspace_root: &Path,
    file: &str,
    conflicting: bool,
) -> ProjectManifest {
    let path = directory.join(file);
    let name = path
        .strip_prefix(workspace_root)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .replace('\\', "/");
    let mut report = ProjectManifest {
        name,
        kind: "rust",
        status: if conflicting {
            "conflicting"
        } else {
            "detected"
        },
        requirements: vec![],
    };
    if conflicting {
        return report;
    }
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
    match read_manifest(&canonical).and_then(|text| language_requirements::parse(file, &text)) {
        Ok(requirements) => report.requirements = requirements,
        Err(status) => report.status = status,
    }
    report
}
