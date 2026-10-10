//! Fixed Poetry commands for projects that declare Poetry in pyproject.toml.
use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    let Some(bytes) = read_manifest(root, "pyproject.toml")? else {
        return Ok(());
    };
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return Ok(());
    };
    let Ok(manifest) = toml::from_str::<toml::Value>(text) else {
        return Ok(());
    };
    let has_poetry_table = manifest
        .get("tool")
        .and_then(|tool| tool.get("poetry"))
        .is_some_and(toml::Value::is_table);
    let poetry_backend = manifest
        .get("build-system")
        .and_then(|build| build.get("build-backend"))
        .and_then(toml::Value::as_str)
        == Some("poetry.core.masonry.api");
    if !has_poetry_table && !poetry_backend {
        return Ok(());
    }
    hash.update(b"poetry-tasks-v3");
    for (id, args) in [
        ("environment", vec!["env", "info", "--path"]),
        ("environments", vec!["env", "list", "--full-path"]),
        ("check", vec!["check"]),
        (
            "unittest",
            vec!["run", "python", "-m", "unittest", "discover"],
        ),
        ("pytest", vec!["run", "python", "-m", "pytest"]),
        ("build", vec!["build"]),
    ] {
        let command = format!("poetry {}", args.join(" "));
        tasks.push(Task {
            id: format!("@poetry/{id}"),
            name: command.clone(),
            command,
            runnable: true,
            source: "pyproject.toml".into(),
            manager: "poetry".into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    Ok(())
}
