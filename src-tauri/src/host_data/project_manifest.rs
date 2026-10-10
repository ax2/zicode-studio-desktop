use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;

const MAX_MANIFEST: u64 = 256 * 1024;

#[path = "bundler_lock_report.rs"]
mod bundler_lock_report;
#[path = "composer_report.rs"]
mod composer_report;
#[path = "language_requirements.rs"]
mod language_requirements;
#[path = "mise_report.rs"]
mod mise_report;
#[path = "node_version_report.rs"]
mod node_version_report;
#[path = "php_version_report.rs"]
mod php_version_report;
#[path = "python_requirements.rs"]
pub(crate) mod python_requirements;
#[path = "python_version_report.rs"]
mod python_version_report;
#[path = "ruby_version_report.rs"]
mod ruby_version_report;
#[path = "rust_toolchain_report.rs"]
mod rust_toolchain_report;
#[path = "tool_versions_report.rs"]
mod tool_versions_report;

pub(super) fn mise_config_names() -> &'static [&'static str] {
    &mise_report::FILES
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub name: String,
    pub kind: &'static str,
    pub status: &'static str,
    pub requirements: Vec<Requirement>,
}

#[derive(Debug, Serialize)]
pub struct Requirement {
    pub tool: String,
    pub constraint: String,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assessment: Option<RequirementAssessment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementAssessment {
    pub status: &'static str,
    pub version: Option<String>,
    pub observed_version: Option<String>,
}

pub fn inspect(root: &Path) -> Vec<ProjectManifest> {
    let mut reports: Vec<_> = [
        ("package.json", "javascript"),
        ("deno.json", "deno"),
        ("deno.jsonc", "deno"),
        (".nvmrc", "javascript"),
        (".node-version", "javascript"),
        (".tool-versions", "tool-versions"),
        (".python-version", "python"),
        (".ruby-version", "ruby"),
        ("Gemfile", "ruby"),
        ("Gemfile.lock", "ruby"),
        (".php-version", "php"),
        ("composer.json", "php"),
        ("Cargo.toml", "rust"),
        ("rust-toolchain.toml", "rust"),
        ("rust-toolchain", "rust"),
        ("pyproject.toml", "python"),
        ("requirements.txt", "python"),
        ("go.mod", "go"),
        ("go.work", "go"),
        ("CMakeLists.txt", "cmake"),
        ("CMakePresets.json", "cmake"),
        ("CMakeUserPresets.json", "cmake"),
        ("GNUmakefile", "make"),
        ("makefile", "make"),
        ("Makefile", "make"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("build.gradle.kts", "java"),
        ("settings.gradle", "java"),
        ("settings.gradle.kts", "java"),
    ]
    .into_iter()
    .chain(
        mise_report::FILES
            .into_iter()
            .map(|name| (name, "tool-versions")),
    )
    .filter_map(|(name, kind)| {
        let path = root.join(name);
        match std::fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            _ => {}
        }
        let mut result = ProjectManifest {
            name: name.into(),
            kind,
            status: "detected",
            requirements: vec![],
        };
        let Ok(canonical) = path.canonicalize() else {
            result.status = "unreadable";
            return Some(result);
        };
        if !canonical.starts_with(root) || !canonical.is_file() {
            result.status = "outside_project";
            return Some(result);
        }
        if matches!(name, "rust-toolchain" | "rust-toolchain.toml")
            && std::fs::symlink_metadata(root.join("rust-toolchain")).is_ok()
            && std::fs::symlink_metadata(root.join("rust-toolchain.toml")).is_ok()
        {
            result.status = "conflicting";
            return Some(result);
        }
        if mise_report::FILES.contains(&name)
            || matches!(
                name,
                "package.json"
                    | "Cargo.toml"
                    | "rust-toolchain.toml"
                    | "rust-toolchain"
                    | "go.mod"
                    | "go.work"
                    | "pyproject.toml"
                    | ".nvmrc"
                    | ".node-version"
                    | ".tool-versions"
                    | ".python-version"
                    | ".ruby-version"
                    | ".php-version"
                    | "composer.json"
                    | "Gemfile.lock"
            )
        {
            let requirements = read_manifest(&canonical).and_then(|text| {
                if name == "package.json" {
                    read_package(&text)
                } else if matches!(name, ".nvmrc" | ".node-version") {
                    read_node_version(&text)
                } else if name == ".tool-versions" {
                    tool_versions_report::parse(&text)
                } else if mise_report::FILES.contains(&name) {
                    mise_report::parse(&text)
                } else if name == ".python-version" {
                    python_version_report::parse(&text)
                } else if name == ".ruby-version" {
                    ruby_version_report::parse(&text)
                } else if name == ".php-version" {
                    php_version_report::parse(&text)
                } else if name == "composer.json" {
                    composer_report::parse(&text)
                } else if name == "Gemfile.lock" {
                    bundler_lock_report::parse(&text)
                } else if name == "pyproject.toml" {
                    python_requirements::parse(&text)
                } else {
                    language_requirements::parse(name, &text)
                }
            });
            match requirements {
                Ok(requirements) => result.requirements = requirements,
                Err(status) => result.status = status,
            }
        }
        Some(result)
    })
    .collect();
    if let Ok(names) = crate::project_tasks::dotnet_tasks::manifest_names(root) {
        for name in names {
            let path = root.join(&name);
            let status = match path.canonicalize() {
                Ok(path) if path.starts_with(root) && path.is_file() => "detected",
                Ok(_) => "outside_project",
                Err(_) => "unreadable",
            };
            reports.push(ProjectManifest {
                name,
                kind: "dotnet",
                status,
                requirements: vec![],
            });
        }
    }
    let nvm = reports.iter().position(|item| item.name == ".nvmrc");
    let node = reports.iter().position(|item| item.name == ".node-version");
    if let (Some(nvm), Some(node)) = (nvm, node) {
        if reports[nvm].status == "detected"
            && reports[node].status == "detected"
            && !same_node_version(
                &reports[nvm].requirements[0],
                &reports[node].requirements[0],
            )
        {
            reports[nvm].status = "conflicting";
            reports[node].status = "conflicting";
            reports[nvm].requirements.clear();
            reports[node].requirements.clear();
        }
    }
    reports
}

pub fn inherited_rust_toolchain_reports(
    root: &Path,
    workspace_root: &Path,
) -> Vec<ProjectManifest> {
    rust_toolchain_report::inherited(root, workspace_root)
}

pub fn inherited_node_version_reports(root: &Path, workspace_root: &Path) -> Vec<ProjectManifest> {
    node_version_report::inherited(root, workspace_root)
}

pub fn inherited_tool_versions_report(
    root: &Path,
    workspace_root: &Path,
) -> Option<ProjectManifest> {
    tool_versions_report::inherited(root, workspace_root)
}

pub fn inherited_mise_reports(root: &Path, workspace_root: &Path) -> Vec<ProjectManifest> {
    mise_report::inherited(root, workspace_root)
}

pub fn inherited_python_version_report(
    root: &Path,
    workspace_root: &Path,
) -> Option<ProjectManifest> {
    python_version_report::inherited(root, workspace_root)
}

pub fn inherited_ruby_version_report(
    root: &Path,
    workspace_root: &Path,
) -> Option<ProjectManifest> {
    ruby_version_report::inherited(root, workspace_root)
}

pub fn inherited_php_version_report(root: &Path, workspace_root: &Path) -> Option<ProjectManifest> {
    php_version_report::inherited(root, workspace_root)
}

pub fn dotnet_sdk_report(root: &Path, workspace_root: &Path) -> Option<ProjectManifest> {
    let (path, bytes) = match crate::project_tasks::dotnet_tasks::sdk_manifest(root, workspace_root)
    {
        Ok(Some(manifest)) => manifest,
        Ok(None) => return None,
        Err(_) => {
            return Some(ProjectManifest {
                name: "global.json".into(),
                kind: "dotnet",
                status: "unreadable",
                requirements: vec![],
            });
        }
    };
    let name = path
        .strip_prefix(workspace_root)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .replace('\\', "/");
    let mut report = ProjectManifest {
        name,
        kind: "dotnet",
        status: "detected",
        requirements: vec![],
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        report.status = "invalid";
        return Some(report);
    };
    let Some(document) = value.as_object() else {
        report.status = "invalid";
        return Some(report);
    };
    if let Some(sdk) = document.get("sdk") {
        let Some(sdk) = sdk.as_object() else {
            report.status = "invalid";
            return Some(report);
        };
        if let Some(version) = sdk.get("version") {
            let Some(version) = version.as_str() else {
                report.status = "invalid";
                return Some(report);
            };
            if version.is_empty() || version.chars().any(char::is_control) {
                report.status = "invalid";
                return Some(report);
            }
            report.requirements.push(Requirement {
                tool: "dotnet".into(),
                constraint: version.chars().take(200).collect(),
                truncated: version.chars().count() > 200,
                kind: Some("dotnet-sdk"),
                assessment: None,
            });
        }
    }
    Some(report)
}

pub fn inherited_go_work_report(root: &Path, workspace_root: &Path) -> Option<ProjectManifest> {
    let (path, bytes) = crate::project_tasks::go_work::member_workfile(root, workspace_root)?;
    let name = path
        .strip_prefix(workspace_root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let mut report = ProjectManifest {
        name,
        kind: "go",
        status: "detected",
        requirements: vec![],
    };
    let requirements = std::str::from_utf8(&bytes)
        .map_err(|_| "invalid")
        .and_then(|text| language_requirements::parse("go.work", text));
    match requirements {
        Ok(requirements) => report.requirements = requirements,
        Err(status) => report.status = status,
    }
    Some(report)
}

pub fn resolve_rust_workspace_version(
    manifests: &mut [ProjectManifest],
    root: &Path,
    workspace_root: &Path,
) {
    let Some(cargo) = manifests
        .iter_mut()
        .find(|manifest| manifest.name == "Cargo.toml" && manifest.status == "detected")
    else {
        return;
    };
    let Some(requirement) = cargo
        .requirements
        .iter_mut()
        .find(|requirement| requirement.tool == "rustc" && requirement.kind == Some("inherited"))
    else {
        return;
    };
    let explicit = match crate::project_tasks::workspace_declarations::rust_workspace_pointer(
        root,
        workspace_root,
    ) {
        Ok(explicit) => explicit,
        Err(()) => return,
    };
    if let Some(ancestor) = explicit {
        let Ok(relative) = root.strip_prefix(&ancestor) else {
            return;
        };
        let Some(parts) = relative
            .iter()
            .map(|part| part.to_str())
            .collect::<Option<Vec<_>>>()
        else {
            return;
        };
        if let Ok(Some(Some(version))) =
            crate::project_tasks::workspace_declarations::rust_member_version(
                &ancestor,
                &parts.join("/"),
                true,
            )
        {
            requirement.constraint = version.chars().take(200).collect();
            requirement.truncated = version.chars().count() > 200;
            requirement.kind = Some("workspace-minimum");
        }
        return;
    }
    let mut ancestor = root;
    for _ in 0..32 {
        let Some(parent) = ancestor.parent() else {
            return;
        };
        if !parent.starts_with(workspace_root) {
            return;
        }
        ancestor = parent;
        let Ok(relative) = root.strip_prefix(ancestor) else {
            return;
        };
        let Some(parts) = relative
            .iter()
            .map(|part| part.to_str())
            .collect::<Option<Vec<_>>>()
        else {
            return;
        };
        match crate::project_tasks::workspace_declarations::rust_member_version(
            ancestor,
            &parts.join("/"),
            false,
        ) {
            Ok(Some(Some(version))) => {
                requirement.constraint = version.chars().take(200).collect();
                requirement.truncated = version.chars().count() > 200;
                requirement.kind = Some("workspace-minimum");
                return;
            }
            Ok(Some(None)) | Err(()) => return,
            Ok(None) => {}
        }
        if ancestor == workspace_root {
            return;
        }
    }
}

fn same_node_version(left: &Requirement, right: &Requirement) -> bool {
    if left.truncated != right.truncated {
        return false;
    }
    normalized_node_version(&left.constraint)
        .eq_ignore_ascii_case(normalized_node_version(&right.constraint))
}

fn normalized_node_version(value: &str) -> &str {
    value
        .strip_prefix('v')
        .filter(|rest| rest.starts_with(|ch: char| ch.is_ascii_digit()))
        .unwrap_or(value)
}

fn read_node_version(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let mut lines = text
        .lines()
        .map(|line| line.split('#').next().unwrap_or("").trim())
        .filter(|line| !line.is_empty());
    let constraint = lines.next().ok_or("invalid")?;
    if lines.next().is_some() || constraint.chars().any(char::is_whitespace) {
        return Err("invalid");
    }
    Ok(vec![Requirement {
        tool: "node".into(),
        constraint: constraint.chars().take(200).collect(),
        truncated: constraint.chars().count() > 200,
        kind: Some("node-version-file"),
        assessment: None,
    }])
}

fn read_manifest(path: &Path) -> Result<String, &'static str> {
    let file = std::fs::File::open(path).map_err(|_| "unreadable")?;
    let mut bytes = vec![];
    file.take(MAX_MANIFEST + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "unreadable")?;
    if bytes.len() as u64 > MAX_MANIFEST {
        return Err("too_large");
    }
    String::from_utf8(bytes).map_err(|_| "invalid")
}

fn read_package(text: &str) -> Result<Vec<Requirement>, &'static str> {
    let value: Value = serde_json::from_str(text).map_err(|_| "invalid")?;
    if !value.is_object() {
        return Err("invalid");
    }
    let mut requirements = Vec::new();
    if value
        .get("engines")
        .is_some_and(|engines| !engines.is_object())
    {
        return Err("invalid");
    }
    for tool in ["node", "bun", "npm", "pnpm", "yarn"] {
        if let Some(declared) = value.get("engines").and_then(|engines| engines.get(tool)) {
            let constraint = declared.as_str().ok_or("invalid")?;
            requirements.push(Requirement {
                tool: tool.into(),
                constraint: constraint.chars().take(200).collect(),
                truncated: constraint.chars().count() > 200,
                kind: None,
                assessment: None,
            });
        }
    }
    if let Some(declared) = value.get("packageManager") {
        let manager = declared.as_str().ok_or("invalid")?;
        requirements.push(Requirement {
            tool: "packageManager".into(),
            constraint: manager.chars().take(200).collect(),
            truncated: manager.chars().count() > 200,
            kind: None,
            assessment: None,
        });
    }
    Ok(requirements)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_truncated_requirements_and_rejects_wrong_json_types() {
        let root =
            std::env::temp_dir().join(format!("zicode-requirements-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let long = format!(">=22{}", " ".repeat(250));
        std::fs::write(
            root.join("package.json"),
            serde_json::json!({"engines":{"node":long}}).to_string(),
        )
        .unwrap();
        let reports = inspect(&root);
        assert!(reports[0].requirements[0].truncated);
        assert_eq!(reports[0].requirements[0].constraint.len(), 200);
        for value in [
            serde_json::json!({"engines":{"node":22}}),
            serde_json::json!({"engines":[]}),
            serde_json::json!({"packageManager":false}),
        ] {
            std::fs::write(root.join("package.json"), value.to_string()).unwrap();
            assert_eq!(inspect(&root)[0].status, "invalid");
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recognizes_manifests_and_only_reads_declared_requirements() {
        let root = std::env::temp_dir().join(format!("zicode-manifest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        std::fs::write(root.join("package.json"), r#"{"engines":{"node":">=22","bun":"1.x"},"packageManager":"bun@1.3.14","scripts":{"postinstall":"not executed"},"privateValue":"not returned"}"#).unwrap();
        std::fs::write(root.join("Cargo.toml"), "[package]").unwrap();
        let reports = inspect(&root);
        assert_eq!(reports.len(), 2);
        assert_eq!(reports[0].requirements.len(), 3);
        assert_eq!(reports[0].requirements[0].constraint, ">=22");
        assert!(!serde_json::to_string(&reports)
            .unwrap()
            .contains("privateValue"));
        std::fs::write(root.join("package.json"), "invalid").unwrap();
        assert_eq!(inspect(&root)[0].status, "invalid");
        std::fs::write(
            root.join("package.json"),
            vec![b'x'; MAX_MANIFEST as usize + 1],
        )
        .unwrap();
        assert_eq!(inspect(&root)[0].status, "too_large");
        std::fs::remove_dir_all(root).unwrap();
    }
}
