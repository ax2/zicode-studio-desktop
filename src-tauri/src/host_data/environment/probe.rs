use super::ToolReport;
use crate::project_environment::python_runtime;
use crate::project_tasks::{catalog, process_tree};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};

pub(super) fn find_executable(
    root: &Path,
    candidates: &[&str],
    path: &std::ffi::OsStr,
) -> Option<PathBuf> {
    for directory in std::env::split_paths(path) {
        if !directory.is_absolute() {
            continue;
        }
        #[cfg(windows)]
        if directory
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("windowsapps")
        {
            continue;
        }
        for name in candidates {
            let name = if cfg!(windows) {
                format!("{name}.exe")
            } else {
                (*name).to_owned()
            };
            let executable = directory.join(name);
            if !executable.is_file() {
                continue;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if executable
                    .metadata()
                    .map(|metadata| metadata.permissions().mode() & 0o111 == 0)
                    .unwrap_or(true)
                {
                    continue;
                }
            }
            let Ok(canonical) = executable.canonicalize() else {
                continue;
            };
            if canonical.starts_with(root) {
                continue;
            }
            // Keep the invocation name: rustup shims dispatch based on argv[0].
            return Some(executable);
        }
    }
    None
}

pub(super) async fn read_version(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, &'static str> {
    let mut data = vec![];
    reader
        .take(16 * 1024 + 1)
        .read_to_end(&mut data)
        .await
        .map_err(|_| "failed")?;
    if data.len() > 16 * 1024 {
        return Err("failed");
    }
    Ok(data)
}

fn dotnet_sdk_version(value: &str) -> bool {
    if value.ends_with('-') {
        return false;
    }
    let (release, suffix) = value.split_once('-').unwrap_or((value, ""));
    if !suffix.is_empty()
        && !suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
    {
        return false;
    }
    let parts: Vec<_> = release.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

#[cfg(test)]
pub(super) async fn probe(
    root: &Path,
    id: &'static str,
    candidates: &[&str],
    argument: &str,
) -> ToolReport {
    probe_environment(root, root, id, candidates, argument, &Default::default()).await
}
pub(super) async fn probe_environment(
    root: &Path,
    workspace_root: &Path,
    id: &'static str,
    candidates: &[&str],
    argument: &str,
    environment: &crate::project_environment::Environment,
) -> ToolReport {
    probe_environment_at(
        root,
        workspace_root,
        id,
        candidates,
        argument,
        environment,
        &std::env::temp_dir(),
    )
    .await
}

pub(super) async fn probe_environment_at(
    root: &Path,
    workspace_root: &Path,
    id: &'static str,
    candidates: &[&str],
    argument: &str,
    environment: &crate::project_environment::Environment,
    probe_directory: &Path,
) -> ToolReport {
    let mut report = ToolReport {
        id,
        status: "missing",
        version: None,
        executable: None,
        source: None,
    };
    let python = if id == "python" {
        match python_runtime::resolve_environment(root, workspace_root, environment) {
            Ok(interpreter) => Some(interpreter),
            Err(error) => {
                if error == "task_python_environment_invalid"
                    || error == "task_python_conda_invalid"
                {
                    report.status = "invalid-environment";
                    report.source = Some(if error == "task_python_conda_invalid" {
                        "project-conda"
                    } else {
                        "project-venv"
                    });
                }
                return report;
            }
        }
    } else {
        None
    };
    let manager = [
        "bun",
        "deno",
        "npm",
        "pnpm",
        "yarn",
        "mvn",
        "gradle",
        "bundle",
        "composer",
        "poetry",
        "uv",
        "dotnet",
        "dotnet-project",
        "make",
    ]
    .contains(&id);
    let executable = if let Some(interpreter) = &python {
        report.source = Some(interpreter.source);
        Some(interpreter.executable.clone())
    } else {
        let isolated_python_manager = id == "poetry" || id == "uv";
        let selected = if isolated_python_manager {
            environment.selected_tool(candidates)
        } else {
            environment.selected(candidates)
        };
        selected.or_else(|| {
            if manager {
                let manager = if id == "dotnet-project" { "dotnet" } else { id };
                let excluded = if isolated_python_manager {
                    environment.selected_python_paths()
                } else {
                    &[]
                };
                let path = if isolated_python_manager {
                    environment.tool_path()
                } else {
                    environment.path()
                };
                path.ok().and_then(|path| {
                    catalog::executable_on_path_excluding(workspace_root, manager, excluded, &path)
                        .ok()
                })
            } else {
                environment
                    .path()
                    .ok()
                    .and_then(|path| find_executable(workspace_root, candidates, &path))
            }
        })
    };
    let Some(executable) = executable else {
        return report;
    };
    report.executable = Some(executable.to_string_lossy().into_owned());
    if matches!(report.source, Some("project-venv" | "project-conda")) {
        // Discovery is not consent to execute a project's interpreter during a read.
        // An explicit environment selection opts into the existing version probe.
        report.status = "unverified";
        return report;
    }
    let mut command = match catalog::version_command(&executable, argument) {
        Ok(command) => command,
        Err(_) => {
            report.status = "failed";
            return report;
        }
    };
    let configured = if id == "poetry" || id == "uv" {
        environment.configure_python_manager(&mut command)
    } else {
        environment.configure(&mut command)
    };
    if configured.is_err()
        || python.as_ref().is_some_and(|interpreter| {
            python_runtime::configure(&mut command, interpreter).is_err()
        })
    {
        report.status = "failed";
        return report;
    }
    command
        .current_dir(probe_directory)
        .env("RUSTUP_AUTO_INSTALL", "0")
        .env("GOTOOLCHAIN", "local")
        .env("COREPACK_ENABLE_NETWORK", "0")
        .env("COREPACK_ENABLE_PROJECT_SPEC", "0")
        .env("COREPACK_ENABLE_DOWNLOAD_PROMPT", "0")
        .env("YARN_IGNORE_PATH", "1")
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1")
        .env("DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE", "1")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .env_remove("BUN_OPTIONS")
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .env_remove("RUBYOPT")
        .env_remove("RUBYLIB")
        .env_remove("BUNDLE_GEMFILE")
        .env_remove("BUNDLE_APP_CONFIG")
        .env_remove("COMPOSER")
        .env_remove("PHPRC")
        .env_remove("PHP_INI_SCAN_DIR")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    process_tree::prepare(&mut command);
    let Ok(mut child) = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
    else {
        report.status = "failed";
        return report;
    };
    let tree = match process_tree::ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(_) => {
            let _ = child.kill().await;
            report.status = "failed";
            return report;
        }
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        let (stdout, stderr, status) =
            tokio::try_join!(read_version(stdout), read_version(stderr), async {
                child.wait().await.map_err(|_| "failed")
            })?;
        if !status.success() {
            return Err("failed");
        }
        let output = if stdout.is_empty() { stderr } else { stdout };
        let version: String = String::from_utf8_lossy(&output)
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_default()
            .chars()
            .filter(|ch| !ch.is_control())
            .take(200)
            .collect();
        if version.is_empty() {
            return Err("failed");
        }
        Ok(version)
    })
    .await
    .unwrap_or(Err("timeout"));
    tree.terminate();
    match result {
        Ok(version) => {
            if id == "dotnet-project" && !dotnet_sdk_version(&version) {
                report.status = "failed";
            } else {
                report.status = "ready";
                report.version = Some(version);
            }
        }
        Err(status) => {
            let _ = child.kill().await;
            report.status = status;
        }
    }
    report
}
