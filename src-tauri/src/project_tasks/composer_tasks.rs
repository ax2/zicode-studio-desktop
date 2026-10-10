//! Fixed Composer commands for a directory with a valid composer.json.
use super::catalog::{read_manifest, valid_name, Task};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) fn configure(command: &mut std::process::Command, root: &Path) {
    command.env("COMPOSER", root.join("composer.json"));
}

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    let Some(bytes) = read_manifest(root, "composer.json")? else {
        return Ok(());
    };
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "task_manifest_invalid")?;
    let document = manifest.as_object().ok_or("task_manifest_invalid")?;
    hash.update(b"composer-tasks-v1");
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(&bytes);
    for (id, args) in [
        (
            "validate",
            vec!["--no-plugins", "validate", "--no-check-publish"],
        ),
        ("install", vec!["install"]),
    ] {
        let command = format!("composer {}", args.join(" "));
        tasks.push(Task {
            id: format!("@composer/{id}"),
            name: command.clone(),
            command,
            runnable: true,
            source: "composer.json".into(),
            manager: "composer".into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    if let Some(scripts) = document
        .get("scripts")
        .and_then(serde_json::Value::as_object)
    {
        if scripts.len() > 100 {
            return Err("task_catalog_too_large".into());
        }
        for (name, body) in scripts {
            if !valid_name(name) || !supported_script(body) {
                continue;
            }
            let command = format!("composer run-script {name}");
            tasks.push(Task {
                id: format!("@composer-script/{name}"),
                name: command.clone(),
                command,
                runnable: true,
                source: "composer.json".into(),
                manager: "composer".into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: vec!["run-script".into(), name.clone()],
            });
        }
    }
    Ok(())
}

fn supported_script(value: &serde_json::Value) -> bool {
    if let Some(command) = value.as_str() {
        return !command.trim().is_empty();
    }
    value.as_array().is_some_and(|commands| {
        !commands.is_empty()
            && commands.iter().all(|command| {
                command
                    .as_str()
                    .is_some_and(|command| !command.trim().is_empty())
            })
    })
}
