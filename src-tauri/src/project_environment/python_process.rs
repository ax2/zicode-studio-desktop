//! Minimal child-process context, without evaluating activation scripts.
use super::python::Kind;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub(super) fn ambient_roots() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = std::env::var_os("VIRTUAL_ENV") {
        candidates.push((root, "pyvenv.cfg", true));
    }
    if let Some(root) = std::env::var_os("CONDA_PREFIX") {
        candidates.push((root, "conda-meta", false));
    }
    candidates.extend(
        std::env::vars_os()
            .filter(|(key, _)| key.to_string_lossy().starts_with("CONDA_PREFIX_"))
            .map(|(_, root)| (root, "conda-meta", false)),
    );
    candidates
        .into_iter()
        .filter_map(|(root, marker, marker_is_file)| {
            let root = PathBuf::from(root);
            let valid = if marker_is_file {
                root.join(marker).is_file()
            } else {
                root.join(marker).is_dir()
            };
            (root.is_absolute() && root.is_dir() && valid).then_some(root)
        })
        .map(|root| root.canonicalize().unwrap_or(root))
        .collect()
}

pub(super) fn is_ambient_path(path: &Path, roots: &[PathBuf]) -> bool {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    roots.iter().any(|root| resolved.starts_with(root))
}

fn cleared_bindings() -> Vec<(OsString, Option<OsString>)> {
    let mut bindings: Vec<_> = std::env::vars_os()
        .filter(|(key, _)| key.to_string_lossy().starts_with("CONDA_PREFIX_"))
        .map(|(key, _)| (key, None))
        .collect();
    for key in [
        "PYTHONHOME",
        "VIRTUAL_ENV",
        "CONDA_PREFIX",
        "CONDA_DEFAULT_ENV",
        "CONDA_SHLVL",
        "CONDA_PROMPT_MODIFIER",
    ] {
        bindings.push((key.into(), None));
    }
    bindings
}

fn bindings(root: &Path, kind: Kind) -> Vec<(OsString, Option<OsString>)> {
    let mut bindings = cleared_bindings();
    bindings.push((
        match kind {
            Kind::Venv => "VIRTUAL_ENV",
            Kind::Conda => "CONDA_PREFIX",
        }
        .into(),
        Some(root.as_os_str().to_owned()),
    ));
    bindings
}

pub(super) fn clear(command: &mut std::process::Command) {
    for (key, _) in cleared_bindings() {
        command.env_remove(key);
    }
    command.env_remove("PYTHONPATH").env_remove("POETRY_ACTIVE");
}

pub(super) fn configure(command: &mut std::process::Command, root: &Path, kind: Kind) {
    command.env_remove("PYTHONPATH").env_remove("POETRY_ACTIVE");
    for (key, value) in bindings(root, kind) {
        if let Some(value) = value {
            command.env(key, value);
        } else {
            command.env_remove(key);
        }
    }
}

pub(super) fn configure_terminal(
    command: &mut portable_pty::CommandBuilder,
    root: &Path,
    kind: Kind,
) {
    command.env_remove("PYTHONPATH");
    command.env_remove("POETRY_ACTIVE");
    for (key, value) in bindings(root, kind) {
        if let Some(value) = value {
            command.env(key, value);
        } else {
            command.env_remove(key);
        }
    }
}

pub(super) fn clear_terminal(command: &mut portable_pty::CommandBuilder) {
    for (key, _) in cleared_bindings() {
        command.env_remove(key);
    }
    command.env_remove("PYTHONPATH");
    command.env_remove("POETRY_ACTIVE");
}

pub(super) fn prepend_path(
    command: &mut std::process::Command,
    prefixes: &[PathBuf],
) -> Result<(), String> {
    let mut paths = prefixes.to_vec();
    let ambient_roots = ambient_roots();
    if let Some(path) = command
        .get_envs()
        .find_map(|(key, value)| {
            (key == "PATH")
                .then(|| value.map(std::ffi::OsStr::to_os_string))
                .flatten()
        })
        .or_else(|| std::env::var_os("PATH"))
    {
        paths.extend(
            std::env::split_paths(&path).filter(|entry| {
                !prefixes.contains(entry) && !is_ambient_path(entry, &ambient_roots)
            }),
        );
    }
    command.env(
        "PATH",
        std::env::join_paths(paths).map_err(|_| "task_python_environment_invalid")?,
    );
    Ok(())
}
