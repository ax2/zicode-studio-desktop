use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub(crate) struct Interpreter {
    pub executable: PathBuf,
    pub environment: Option<PathBuf>,
    pub source: &'static str,
    pub(crate) kind: Option<super::python::Kind>,
    pub(crate) paths: Vec<PathBuf>,
}

fn executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if !path
            .metadata()
            .is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0)
        {
            return false;
        }
    }
    true
}

impl Interpreter {
    pub(crate) fn update_fingerprint(&self, hash: &mut Sha256) {
        for value in [
            self.source.as_bytes(),
            self.executable.as_os_str().as_encoded_bytes(),
        ] {
            hash.update((value.len() as u64).to_le_bytes());
            hash.update(value);
        }
        hash.update([u8::from(self.environment.is_some())]);
        if let Some(root) = &self.environment {
            let value = root.as_os_str().as_encoded_bytes();
            hash.update((value.len() as u64).to_le_bytes());
            hash.update(value);
        }
        hash.update((self.paths.len() as u64).to_le_bytes());
        for path in &self.paths {
            let value = path.as_os_str().as_encoded_bytes();
            hash.update((value.len() as u64).to_le_bytes());
            hash.update(value);
        }
    }
}

fn local_project_environment(root: &Path) -> Result<Option<Interpreter>, String> {
    for (name, error) in [
        (".venv", "task_python_environment_invalid"),
        (".conda", "task_python_conda_invalid"),
    ] {
        let path = root.join(name);
        match std::fs::symlink_metadata(&path) {
            Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(error.into()),
            Ok(_) => {}
        }
        let canonical = path.canonicalize().map_err(|_| error)?;
        if !canonical.starts_with(root) || !canonical.is_dir() {
            return Err(error.into());
        }
        let selected = super::python::PythonEnvironment::inspect(canonical.to_str().ok_or(error)?)
            .map_err(|_| error)?;
        if name == ".conda" && !matches!(selected.kind, super::python::Kind::Conda) {
            return Err(error.into());
        }
        return Ok(Some(Interpreter {
            executable: selected.executable,
            environment: Some(selected.root),
            source: match selected.kind {
                super::python::Kind::Venv => "project-venv",
                super::python::Kind::Conda => "project-conda",
            },
            kind: Some(selected.kind),
            paths: selected.paths,
        }));
    }
    Ok(None)
}

pub(crate) fn project_environment(
    directory: &Path,
    workspace_root: &Path,
) -> Result<Option<Interpreter>, String> {
    if !directory.starts_with(workspace_root) {
        return Err("task_directory_invalid".into());
    }
    let mut current = directory;
    loop {
        if let Some(interpreter) = local_project_environment(current)? {
            return Ok(Some(interpreter));
        }
        if current == workspace_root {
            return Ok(None);
        }
        current = current.parent().ok_or("task_directory_invalid")?;
    }
}

#[cfg(test)]
pub(crate) fn resolve(root: &Path) -> Result<Interpreter, String> {
    resolve_with_path(root, std::env::var_os("PATH").as_deref())
}

pub(crate) fn resolve_scoped(root: &Path, workspace_root: &Path) -> Result<Interpreter, String> {
    resolve_with_scope(root, workspace_root, std::env::var_os("PATH").as_deref())
}

pub(crate) fn resolve_environment(
    root: &Path,
    workspace_root: &Path,
    environment: &crate::project_environment::Environment,
) -> Result<Interpreter, String> {
    if let Some(python) = environment.python() {
        return Ok(Interpreter {
            executable: python.executable.clone(),
            environment: Some(python.root.clone()),
            source: match python.kind {
                super::python::Kind::Venv => "explicit-environment",
                super::python::Kind::Conda => "explicit-conda",
            },
            kind: Some(python.kind),
            paths: python.paths.clone(),
        });
    }
    if let Some(interpreter) = project_environment(root, workspace_root)? {
        return Ok(interpreter);
    }
    if let Some(executable) = environment.selected(&["python", "python3"]) {
        return Ok(Interpreter {
            executable,
            environment: None,
            source: "tool-directory",
            kind: None,
            paths: vec![],
        });
    }
    resolve_scoped(root, workspace_root)
}

#[cfg(test)]
pub(crate) fn resolve_with_path(
    root: &Path,
    path: Option<&std::ffi::OsStr>,
) -> Result<Interpreter, String> {
    resolve_with_scope(root, root, path)
}

fn resolve_with_scope(
    root: &Path,
    workspace_root: &Path,
    path: Option<&std::ffi::OsStr>,
) -> Result<Interpreter, String> {
    if let Some(interpreter) = project_environment(root, workspace_root)? {
        return Ok(interpreter);
    }
    let names: &[&str] = if cfg!(windows) {
        &["python.exe", "python3.exe"]
    } else {
        &["python3", "python"]
    };
    let ambient_roots = super::python_process::ambient_roots();
    for directory in path.map(std::env::split_paths).into_iter().flatten() {
        if !directory.is_absolute()
            || super::python_process::is_ambient_path(&directory, &ambient_roots)
        {
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
        for name in names {
            let executable = directory.join(name);
            if !executable_file(&executable) {
                continue;
            }
            let Ok(canonical) = executable.canonicalize() else {
                continue;
            };
            if !canonical.starts_with(workspace_root) {
                return Ok(Interpreter {
                    executable,
                    environment: None,
                    source: "host",
                    kind: None,
                    paths: vec![],
                });
            }
        }
    }
    Err("task_python_missing".into())
}

pub(crate) fn configure(
    command: &mut std::process::Command,
    interpreter: &Interpreter,
) -> Result<(), String> {
    // The Host log decoder consumes UTF-8; flush progress promptly through pipes.
    command
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUNBUFFERED", "1");
    if let (Some(environment), Some(kind)) = (&interpreter.environment, interpreter.kind) {
        super::python_process::configure(command, environment, kind);
        super::python_process::prepend_path(command, &interpreter.paths)?;
    }
    Ok(())
}
