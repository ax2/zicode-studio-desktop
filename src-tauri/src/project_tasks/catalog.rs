use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub manager: String,
    pub package_manager: Option<super::package_manager::Selection>,
    pub fingerprint: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub command: String,
    pub runnable: bool,
    pub source: String,
    pub manager: String,
    pub interpreter: Option<String>,
    pub unavailable_reason: Option<String>,
    #[serde(skip)]
    pub arguments: Vec<String>,
}

#[cfg(test)]
pub fn read(root: &Path) -> Result<Catalog, String> {
    read_in(root, root)
}

#[cfg(test)]
pub fn read_in(root: &Path, workspace_root: &Path) -> Result<Catalog, String> {
    read_with_environment(root, workspace_root, &Default::default())
}

pub fn read_with_environment(
    root: &Path,
    workspace_root: &Path,
    environment: &crate::project_environment::Environment,
) -> Result<Catalog, String> {
    let mut catalog = read_package(root, workspace_root)?;
    let mut hash = Sha256::new();
    hash.update(b"project-tasks-v3");
    let directory = root.to_string_lossy();
    hash.update((directory.len() as u64).to_le_bytes());
    hash.update(directory.as_bytes());
    hash.update(catalog.fingerprint.as_bytes());
    hash.update(environment.fingerprint().as_bytes());
    for (manifest, manager, commands) in [
        (
            "Cargo.toml",
            "cargo",
            vec![vec!["check"], vec!["test"], vec!["build"]],
        ),
        (
            "go.mod",
            "go",
            vec![
                vec!["test", "./..."],
                vec!["build", "./..."],
                vec!["vet", "./..."],
            ],
        ),
    ] {
        let Some(bytes) = read_manifest(root, manifest)? else {
            continue;
        };
        hash.update(manifest.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
        for args in commands {
            let command = format!("{manager} {}", args.join(" "));
            catalog.tasks.push(Task {
                id: format!("@{manager}/{}", args[0]),
                name: command.clone(),
                command,
                runnable: true,
                source: manifest.into(),
                manager: manager.into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: args.into_iter().map(str::to_owned).collect(),
            });
        }
    }
    super::cmake_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    super::java_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    super::dotnet_tasks::append(root, workspace_root, &mut catalog.tasks, &mut hash)?;
    super::python_tasks::append(
        root,
        workspace_root,
        &mut catalog.tasks,
        &mut hash,
        environment,
    )?;
    super::poetry_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    super::uv_tasks::append(root, workspace_root, &mut catalog.tasks, &mut hash)?;
    super::deno_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    super::ruby_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    super::composer_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    super::make_tasks::append(root, &mut catalog.tasks, &mut hash)?;
    if let Ok(Some(workspace)) = super::go_work::read(root) {
        hash.update(b"go-work-tasks-v1");
        hash.update((workspace.bytes.len() as u64).to_le_bytes());
        hash.update(&workspace.bytes);
        for module in workspace.modules {
            if module.path.is_empty() {
                continue;
            }
            hash.update(module.path.as_bytes());
            hash.update((module.manifest.len() as u64).to_le_bytes());
            hash.update(&module.manifest);
            for (id, args) in [
                ("test", vec!["test", "./..."]),
                ("build", vec!["build", "./..."]),
                ("vet", vec!["vet", "./..."]),
            ] {
                let mut arguments = vec!["-C".to_owned(), module.path.clone()];
                arguments.extend(args.iter().map(ToString::to_string));
                let command = format!("go -C {} {}", module.path, args.join(" "));
                catalog.tasks.push(Task {
                    id: format!("@go-work/{}/{id}", module.path),
                    name: command.clone(),
                    command,
                    runnable: true,
                    source: "go.work".into(),
                    manager: "go".into(),
                    interpreter: None,
                    unavailable_reason: None,
                    arguments,
                });
            }
        }
    }
    let mut managers = vec![];
    for task in &catalog.tasks {
        if !managers.contains(&task.manager.as_str()) {
            managers.push(task.manager.as_str());
        }
    }
    if !managers.is_empty() {
        catalog.manager = managers.join(" / ");
    }
    catalog.fingerprint = format!("{:x}", hash.finalize());
    Ok(catalog)
}

pub(super) fn read_manifest(root: &Path, name: &str) -> Result<Option<Vec<u8>>, String> {
    let path = root.join(name);
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("task_manifest_unreadable".into()),
        Ok(_) => {}
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "task_manifest_unreadable")?;
    if !canonical.starts_with(root) {
        return Err("task_manifest_outside_project".into());
    }
    if !canonical.is_file() {
        return Err("task_manifest_invalid".into());
    }
    let mut bytes = vec![];
    std::fs::File::open(canonical)
        .map_err(|_| "task_manifest_unreadable")?
        .take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "task_manifest_unreadable")?;
    if bytes.len() > 256 * 1024 {
        return Err("task_manifest_too_large".into());
    }
    Ok(Some(bytes))
}

fn read_package(root: &Path, workspace_root: &Path) -> Result<Catalog, String> {
    let Some(bytes) = read_manifest(root, "package.json")? else {
        return Ok(Catalog {
            manager: "npm".into(),
            package_manager: None,
            fingerprint: String::new(),
            tasks: vec![],
        });
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "task_manifest_invalid")?;
    if !value.is_object() {
        return Err("task_manifest_invalid".into());
    }
    let selection = super::package_manager::select(root, workspace_root, &value)?;
    let manager = selection.manager.as_str();
    let scripts = value.get("scripts");
    if scripts.is_some_and(|scripts| !scripts.is_object()) {
        return Err("task_manifest_invalid".into());
    }
    let mut tasks = vec![];
    if let Some(scripts) = scripts.and_then(Value::as_object) {
        if scripts.len() > 100 {
            return Err("task_catalog_too_large".into());
        }
        for (name, command) in scripts {
            let command = command.as_str().ok_or("task_manifest_invalid")?;
            tasks.push(Task {
                id: format!("@package/{name}"),
                name: name.clone(),
                command: command.to_owned(),
                runnable: valid_name(name),
                source: "package.json".into(),
                manager: manager.into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: vec!["run".into(), name.clone()],
            });
        }
    }
    let mut hash = Sha256::new();
    hash.update(&bytes);
    hash.update(serde_json::to_vec(&selection).map_err(|_| "task_manifest_invalid")?);
    Ok(Catalog {
        manager: manager.into(),
        package_manager: Some(selection),
        fingerprint: format!("{:x}", hash.finalize()),
        tasks,
    })
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('-')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_:-.".contains(&byte))
}

#[cfg(test)]
pub fn executable(root: &Path, manager: &str) -> Result<PathBuf, String> {
    executable_excluding(root, manager, &[])
}

#[cfg(test)]
pub fn executable_excluding(
    root: &Path,
    manager: &str,
    excluded_directories: &[PathBuf],
) -> Result<PathBuf, String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    executable_on_path_excluding(root, manager, excluded_directories, &path)
}

pub fn executable_on_path(root: &Path, manager: &str, path: &OsStr) -> Result<PathBuf, String> {
    executable_on_path_excluding(root, manager, &[], path)
}

pub fn executable_on_path_excluding(
    root: &Path,
    manager: &str,
    excluded_directories: &[PathBuf],
    path: &OsStr,
) -> Result<PathBuf, String> {
    let mut candidates = vec![];
    if manager == "bun" {
        if let Some(bundled) = std::env::var_os("ZICODE_BUN_RUNTIME") {
            candidates.push(PathBuf::from(bundled));
        }
    }
    for directory in std::env::split_paths(path).filter(|path| path.is_absolute()) {
        if cfg!(windows) {
            candidates.push(directory.join(format!("{manager}.exe")));
            candidates.push(directory.join(format!("{manager}.cmd")));
            candidates.push(directory.join(format!("{manager}.bat")));
        } else {
            candidates.push(directory.join(manager));
        }
    }
    for candidate in candidates {
        if !candidate.is_absolute() || !candidate.is_file() {
            continue;
        }
        if !excluded_directories.is_empty() {
            let parent = candidate
                .parent()
                .and_then(|path| path.canonicalize().ok())
                .map(|path| crate::process_command::working_directory(&path));
            if parent.is_some_and(|path| excluded_directories.contains(&path)) {
                continue;
            }
        }
        let Ok(canonical) = candidate.canonicalize() else {
            continue;
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if !candidate
                .metadata()
                .is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0)
            {
                continue;
            }
        }
        if !canonical.starts_with(root) {
            return Ok(candidate);
        }
    }
    Err("task_manager_missing".into())
}

pub fn command(executable: &Path, name: &str) -> Result<std::process::Command, String> {
    if !valid_name(name) {
        return Err("task_not_runnable".into());
    }
    manager_command(executable, &["run", name])
}

pub fn task_command(executable: &Path, task: &Task) -> Result<std::process::Command, String> {
    if task.source == "package.json" {
        return command(executable, &task.name);
    }
    // These arguments came from the fixed catalog above, never a client-provided argv.
    let args: Vec<&str> = task.arguments.iter().map(String::as_str).collect();
    manager_command(executable, &args)
}

pub fn version_command(executable: &Path, argument: &str) -> Result<std::process::Command, String> {
    if !["--version", "version", "-version"].contains(&argument) {
        return Err("task_manager_invalid".into());
    }
    manager_command(executable, &[argument])
}

// The catalog may also supply a project-defined CMake preset name.
fn manager_command(executable: &Path, args: &[&str]) -> Result<std::process::Command, String> {
    #[cfg(windows)]
    if executable.extension().is_some_and(|extension| {
        extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
    }) {
        use std::os::windows::process::CommandExt;
        // Batch files pass through cmd.exe. Keep every forwarded argument to a
        // literal ASCII token; quoting arbitrary preset names here would let
        // cmd.exe reinterpret metacharacters from a project manifest.
        if args.iter().any(|arg| {
            arg.is_empty()
                || !arg
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_:-./".contains(&byte))
        }) {
            return Err("task_batch_argument_unsupported".into());
        }
        let path = executable
            .to_str()
            .ok_or("task_manager_invalid")?
            .replace('/', "\\");
        // cmd.exe cannot execute verbatim (\\?\) batch paths. Convert only known
        // drive/UNC prefixes; arbitrary device namespaces are not batch locations.
        let path = if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{unc}")
        } else if let Some(drive) = path.strip_prefix(r"\\?\") {
            if drive.as_bytes().get(1) != Some(&b':') || drive.as_bytes().get(2) != Some(&b'\\') {
                return Err("task_manager_invalid".into());
            }
            drive.to_owned()
        } else {
            path
        };
        if path.contains(['"', '%', '!', '\r', '\n']) {
            return Err("task_manager_invalid".into());
        }
        let system = std::env::var_os("SystemRoot").ok_or("task_manager_missing")?;
        let mut command = crate::process_command::new_command(
            PathBuf::from(system).join("System32").join("cmd.exe"),
        );
        command
            .args(["/d", "/s", "/c"])
            .raw_arg(format!("\"\"{path}\" {}\"", args.join(" ")));
        return Ok(command);
    }
    let mut command = crate::process_command::new_command(executable);
    command.args(args);
    Ok(command)
}
