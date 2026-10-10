//! Fixed uv commands for projects with an uv lockfile or explicit uv settings.
use super::catalog::{read_manifest, Task};
use super::workspace_declarations;
use sha2::{Digest, Sha256};
use std::path::Path;

fn has_lock(root: &Path) -> Result<bool, String> {
    let lock = root.join("uv.lock");
    match std::fs::symlink_metadata(&lock) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err("task_manifest_invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("task_manifest_unreadable".into()),
    }
}

pub(super) fn append(
    root: &Path,
    workspace_root: &Path,
    tasks: &mut Vec<Task>,
    hash: &mut Sha256,
) -> Result<(), String> {
    let Some(bytes) = read_manifest(root, "pyproject.toml")? else {
        return Ok(());
    };
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return Ok(());
    };
    let Ok(manifest) = toml::from_str::<toml::Value>(text) else {
        return Ok(());
    };
    let has_uv_table = manifest
        .get("tool")
        .and_then(|tool| tool.get("uv"))
        .is_some_and(toml::Value::is_table);
    let local_lock = has_lock(root)?;
    let inherited = if root == workspace_root {
        false
    } else {
        let relative = root
            .strip_prefix(workspace_root)
            .map_err(|_| "task_directory_invalid")?
            .iter()
            .map(|part| part.to_str().ok_or("task_directory_invalid"))
            .collect::<Result<Vec<_>, _>>()?
            .join("/");
        match workspace_declarations::uv_member(workspace_root, &relative) {
            Ok(Some(true)) => true,
            Ok(_) | Err(()) => false,
        }
    };
    if !has_uv_table && !local_lock && !inherited {
        return Ok(());
    }
    let locked = local_lock || (inherited && has_lock(workspace_root)?);

    hash.update(b"uv-tasks-v2");
    hash.update([u8::from(locked), u8::from(inherited)]);
    if inherited {
        let bytes =
            read_manifest(workspace_root, "pyproject.toml")?.ok_or("task_workspace_invalid")?;
        hash.update(&bytes);
    }
    let sync_args = if locked {
        vec!["sync", "--locked"]
    } else {
        vec!["sync"]
    };
    for (id, args) in [
        ("sync", sync_args),
        ("lock", vec!["lock"]),
        (
            "unittest",
            vec!["run", "--no-sync", "python", "-m", "unittest", "discover"],
        ),
        ("pytest", vec!["run", "--no-sync", "python", "-m", "pytest"]),
        ("build", vec!["build"]),
    ] {
        let command = format!("uv {}", args.join(" "));
        tasks.push(Task {
            id: format!("@uv/{id}"),
            name: command.clone(),
            command,
            runnable: true,
            source: if local_lock {
                "uv.lock"
            } else if inherited {
                "pyproject.toml (uv workspace)"
            } else {
                "pyproject.toml"
            }
            .into(),
            manager: "uv".into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    Ok(())
}
