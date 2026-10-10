use super::{read_manifest, read_node_version, same_node_version, ProjectManifest};
use std::path::Path;

const FILES: [&str; 2] = [".nvmrc", ".node-version"];

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
            let mut reports: Vec<_> = found
                .into_iter()
                .map(|name| report(ancestor, workspace_root, name))
                .collect();
            if reports.len() == 2
                && reports.iter().all(|report| report.status == "detected")
                && !same_node_version(&reports[0].requirements[0], &reports[1].requirements[0])
            {
                for report in &mut reports {
                    report.status = "conflicting";
                    report.requirements.clear();
                }
            }
            return reports;
        }
        if ancestor == workspace_root {
            break;
        }
    }
    vec![]
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
        kind: "javascript",
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
    match read_manifest(&canonical).and_then(|text| read_node_version(&text)) {
        Ok(requirements) => report.requirements = requirements,
        Err(status) => report.status = status,
    }
    report
}
