use super::project_manifest::{self, ProjectManifest};
use serde::Serialize;
use std::path::Path;
mod dotnet_probe;
mod probe;
use probe::probe_environment;
#[cfg(test)]
use probe::{find_executable, probe, read_version};

#[cfg(test)]
#[path = "environment_contract_tests.rs"]
mod contract_tests;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub directory: String,
    pub platform: &'static str,
    pub architecture: &'static str,
    pub pi_version: &'static str,
    pub checked_at: String,
    pub manifests: Vec<ProjectManifest>,
    pub tools: Vec<ToolReport>,
    pub project_wrappers: Vec<&'static str>,
    pub package_manager: Option<crate::project_tasks::package_manager::Selection>,
    pub package_manager_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ToolReport {
    pub id: &'static str,
    pub status: &'static str,
    pub version: Option<String>,
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<&'static str>,
}

#[cfg(test)]
pub async fn inspect_with_environment(
    root: &Path,
    environment: &crate::project_environment::Environment,
) -> EnvironmentReport {
    inspect_directory(root, root, "", environment).await
}

pub async fn inspect_directory(
    root: &Path,
    workspace_root: &Path,
    directory: &str,
    environment: &crate::project_environment::Environment,
) -> EnvironmentReport {
    let (
        git,
        node,
        bun,
        deno,
        python,
        ruby,
        bundle,
        php,
        composer,
        cargo,
        go,
        cmake,
        ctest,
        make,
        java,
        mvn,
        gradle,
        poetry,
        uv,
        dotnet,
        dotnet_project,
        npm,
        pnpm,
        yarn,
        rustc,
    ) = tokio::join!(
        probe_environment(
            root,
            workspace_root,
            "git",
            &["git"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "node",
            &["node"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "bun",
            &["bun"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "deno",
            &["deno"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "python",
            &["python3", "python"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "ruby",
            &["ruby"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "bundle",
            &["bundle"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "php",
            &["php"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "composer",
            &["composer"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "cargo",
            &["cargo"],
            "--version",
            environment
        ),
        probe_environment(root, workspace_root, "go", &["go"], "version", environment),
        probe_environment(
            root,
            workspace_root,
            "cmake",
            &["cmake"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "ctest",
            &["ctest"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "make",
            &["make"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "java",
            &["java"],
            "-version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "mvn",
            &["mvn"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "gradle",
            &["gradle"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "poetry",
            &["poetry"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "uv",
            &["uv"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "dotnet",
            &["dotnet"],
            "--version",
            environment
        ),
        dotnet_probe::inspect(root, workspace_root, environment),
        probe_environment(
            root,
            workspace_root,
            "npm",
            &["npm"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "pnpm",
            &["pnpm"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "yarn",
            &["yarn"],
            "--version",
            environment
        ),
        probe_environment(
            root,
            workspace_root,
            "rustc",
            &["rustc"],
            "--version",
            environment
        ),
    );
    let mut manifests = project_manifest::inspect(root);
    manifests.extend(project_manifest::inherited_node_version_reports(
        root,
        workspace_root,
    ));
    if let Some(versions) = project_manifest::inherited_tool_versions_report(root, workspace_root) {
        manifests.push(versions);
    }
    manifests.extend(project_manifest::inherited_mise_reports(
        root,
        workspace_root,
    ));
    if let Some(version) = project_manifest::inherited_python_version_report(root, workspace_root) {
        manifests.push(version);
    }
    if let Some(version) = project_manifest::inherited_ruby_version_report(root, workspace_root) {
        manifests.push(version);
    }
    if let Some(version) = project_manifest::inherited_php_version_report(root, workspace_root) {
        manifests.push(version);
    }
    manifests.extend(project_manifest::inherited_rust_toolchain_reports(
        root,
        workspace_root,
    ));
    project_manifest::resolve_rust_workspace_version(&mut manifests, root, workspace_root);
    if let Some(workfile) = project_manifest::inherited_go_work_report(root, workspace_root) {
        manifests.push(workfile);
    }
    if let Some(sdk) = project_manifest::dotnet_sdk_report(root, workspace_root) {
        manifests.push(sdk);
    }
    let (package_manager, package_manager_error) =
        match crate::project_tasks::package_manager::inspect(root, workspace_root) {
            Ok(selection) => (selection, None),
            Err(error) => (None, Some(error)),
        };
    project_manifest::python_requirements::assess(
        &mut manifests,
        python.status,
        python.version.as_deref(),
    );
    let mut tools = vec![
        git, node, bun, deno, python, ruby, bundle, php, composer, cargo, go, cmake, ctest, make,
        java, mvn, gradle, poetry, uv, dotnet, npm, pnpm, yarn, rustc,
    ];
    if let Some(dotnet_project) = dotnet_project {
        tools.push(dotnet_project);
    }
    let project_wrappers = ["mvn", "gradle"]
        .into_iter()
        .filter(|manager| {
            let has_manifest = manifests.iter().any(|manifest| {
                manifest.status == "detected"
                    && match *manager {
                        "mvn" => manifest.name == "pom.xml",
                        "gradle" => matches!(
                            manifest.name.as_str(),
                            "build.gradle"
                                | "build.gradle.kts"
                                | "settings.gradle"
                                | "settings.gradle.kts"
                        ),
                        _ => false,
                    }
            });
            has_manifest && crate::project_tasks::java_tasks::has_usable_wrapper(root, manager)
        })
        .collect();
    EnvironmentReport {
        directory: directory.to_owned(),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        pi_version: crate::pi_launch::locked_pi_version(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        manifests,
        package_manager,
        package_manager_error,
        tools,
        project_wrappers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probes_installed_git_and_distinguishes_missing_tools() {
        let root =
            std::env::temp_dir().join(format!("zicode-environment-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let git = probe(&root, "git", &["git"], "--version").await;
        assert_eq!(git.status, "ready");
        assert!(git.version.as_deref().unwrap().starts_with("git version "));
        let missing = probe(
            &root,
            "missing",
            &["zicode-nonexistent-tool-97ec6a"],
            "--version",
        )
        .await;
        assert_eq!(missing.status, "missing");
        assert!(missing.version.is_none());
        assert!(missing.executable.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn bounds_version_output() {
        let bytes = vec![b'x'; 16 * 1024 + 1];
        assert!(read_version(bytes.as_slice()).await.is_err());
    }

    #[test]
    fn ignores_relative_path_entries_and_project_executables() {
        let root = std::env::temp_dir().join(format!("zicode-tools-{}", uuid::Uuid::new_v4()));
        let project = root.join("project");
        let installed = root.join("installed");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&installed).unwrap();
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        std::fs::write(project.join(name), "not executed").unwrap();
        std::fs::write(installed.join(name), "not executed").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(project.join(name), std::fs::Permissions::from_mode(0o755))
                .unwrap();
            std::fs::set_permissions(installed.join(name), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        let path = std::env::join_paths([Path::new("."), &project, &installed]).unwrap();
        assert_eq!(
            find_executable(&project.canonicalize().unwrap(), &["node"], &path),
            Some(installed.join(name))
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
