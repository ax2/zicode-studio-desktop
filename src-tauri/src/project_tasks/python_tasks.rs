use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) use crate::project_environment::python_runtime::{configure, resolve_environment};
#[cfg(test)]
pub(super) use crate::project_environment::python_runtime::{resolve, resolve_with_path};

pub(super) fn append(
    root: &Path,
    workspace_root: &Path,
    tasks: &mut Vec<Task>,
    hash: &mut Sha256,
    environment: &crate::project_environment::Environment,
) -> Result<(), String> {
    let mut manifests = vec![];
    for name in ["pyproject.toml", "requirements.txt"] {
        if let Some(bytes) = read_manifest(root, name)? {
            hash.update(name.as_bytes());
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
            manifests.push(name);
        }
    }
    if manifests.is_empty() {
        return Ok(());
    }
    let (interpreter, unavailable) = match resolve_environment(root, workspace_root, environment) {
        Ok(interpreter) => {
            interpreter.update_fingerprint(hash);
            (
                Some(interpreter.executable.to_string_lossy().into_owned()),
                None,
            )
        }
        Err(error) => {
            hash.update(error.as_bytes());
            (None, Some(error))
        }
    };
    for (id, args) in [
        ("unittest", vec!["-m", "unittest", "discover"]),
        ("pytest", vec!["-m", "pytest"]),
        ("build", vec!["-m", "build"]),
    ] {
        let command = format!("python {}", args.join(" "));
        tasks.push(Task {
            id: format!("@python/{id}"),
            name: command.clone(),
            command,
            source: manifests.join(", "),
            manager: "python".into(),
            runnable: unavailable.is_none(),
            interpreter: interpreter.clone(),
            unavailable_reason: unavailable.clone(),
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    Ok(())
}
