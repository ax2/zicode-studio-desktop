//! Deno commands for projects with a local Deno configuration file.
use super::catalog::{read_manifest, valid_name, Task};
use jsonc_parser::{parse_to_serde_value, ParseOptions};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    let mut sources = Vec::new();
    let mut selected = None;
    for name in ["deno.json", "deno.jsonc"] {
        if let Some(bytes) = read_manifest(root, name)? {
            hash.update(b"deno-tasks-v2");
            hash.update(name.as_bytes());
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(&bytes);
            sources.push(name);
            if selected.is_none() {
                selected = Some((name, bytes));
            }
        }
    }
    let Some((config_name, config_bytes)) = selected else {
        return Ok(());
    };
    // Deno prefers deno.json when both config names exist in one directory.
    let config = parse_config(&config_bytes).map_err(|_| "task_manifest_invalid")?;
    let document = config.as_object().ok_or("task_manifest_invalid")?;
    let source = sources.join(" / ");
    for (id, args) in [
        ("fmt", vec!["fmt", "--check"]),
        ("lint", vec!["lint"]),
        ("test", vec!["test"]),
    ] {
        let command = format!("deno {}", args.join(" "));
        tasks.push(Task {
            id: format!("@deno/{id}"),
            name: command.clone(),
            command,
            runnable: true,
            source: source.clone(),
            manager: "deno".into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    if let Some(declared) = document.get("tasks") {
        let declared = declared.as_object().ok_or("task_manifest_invalid")?;
        if declared.len() > 100 {
            return Err("task_catalog_too_large".into());
        }
        for (name, value) in declared {
            let Some(preview) = task_preview(value) else {
                continue;
            };
            tasks.push(Task {
                id: format!("@deno-task/{name}"),
                name: name.clone(),
                command: preview,
                runnable: valid_name(name),
                source: config_name.into(),
                manager: "deno".into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: vec!["task".into(), name.clone()],
            });
        }
    }
    Ok(())
}

fn task_preview(value: &Value) -> Option<String> {
    match value {
        Value::String(command) if !command.trim().is_empty() => Some(command.clone()),
        Value::Object(task) => {
            let command = task
                .get("command")
                .and_then(Value::as_str)
                .filter(|command| !command.trim().is_empty());
            let dependencies = match task.get("dependencies") {
                Some(value) => {
                    let dependencies = value.as_array()?;
                    if dependencies.is_empty() {
                        None
                    } else {
                        Some(
                            dependencies
                                .iter()
                                .map(|item| item.as_str().filter(|name| !name.is_empty()))
                                .collect::<Option<Vec<_>>>()?,
                        )
                    }
                }
                None => None,
            };
            let dependencies = dependencies
                .as_ref()
                .map(|names| serde_json::to_string(names).expect("string list serializes"));
            match (dependencies, command) {
                (Some(dependencies), Some(command)) => Some(format!(
                    "dependencies (parallel): {dependencies}\ncommand: {command}"
                )),
                (Some(dependencies), None) => {
                    Some(format!("dependencies (parallel): {dependencies}"))
                }
                (None, Some(command)) => Some(command.into()),
                (None, None) => None,
            }
        }
        _ => None,
    }
}

pub(super) fn parse_config(bytes: &[u8]) -> Result<Value, ()> {
    let text = std::str::from_utf8(bytes).map_err(|_| ())?;
    parse_to_serde_value(text, &jsonc_options()).map_err(|_| ())
}

fn jsonc_options() -> ParseOptions {
    ParseOptions {
        allow_comments: true,
        allow_trailing_commas: true,
        allow_loose_object_property_names: false,
        allow_missing_commas: false,
        allow_single_quoted_strings: false,
        allow_hexadecimal_numbers: false,
        allow_unary_plus_numbers: false,
        allow_bare_decimal_point_numbers: false,
        allow_non_finite_numbers: false,
        allow_extended_string_escapes: false,
    }
}
