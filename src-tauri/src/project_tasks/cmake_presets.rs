//! Discover named CMake presets without evaluating their generators or conditions.
use super::catalog::{read_manifest, Task};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    let Some(bytes) = read_manifest(root, "CMakePresets.json")? else {
        return Ok(());
    };
    hash.update(b"CMakePresets.json");
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(&bytes);
    if let Some(user_bytes) = read_manifest(root, "CMakeUserPresets.json")? {
        hash.update(b"CMakeUserPresets.json");
        hash.update((user_bytes.len() as u64).to_le_bytes());
        hash.update(user_bytes);
    }
    let document: Value =
        serde_json::from_slice(&bytes).map_err(|_| "task_cmake_presets_invalid")?;
    let version = document
        .get("version")
        .and_then(Value::as_u64)
        .ok_or("task_cmake_presets_invalid")?;
    if version == 0 {
        return Err("task_cmake_presets_invalid".into());
    }
    let mut preset_count = 0;
    for (field, id, manager, prefix) in [
        ("configurePresets", "configure", "cmake", &["--preset"][..]),
        (
            "buildPresets",
            "build",
            "cmake",
            &["--build", "--preset"][..],
        ),
        ("testPresets", "test", "ctest", &["--preset"][..]),
    ] {
        let Some(presets) = document.get(field) else {
            continue;
        };
        let presets = presets.as_array().ok_or("task_cmake_presets_invalid")?;
        preset_count += presets.len();
        if presets.len() > 32 || preset_count > 64 {
            return Err("task_catalog_too_large".into());
        }
        let mut seen = HashSet::new();
        for preset in presets {
            let preset = preset.as_object().ok_or("task_cmake_presets_invalid")?;
            let name = preset
                .get("name")
                .and_then(Value::as_str)
                .ok_or("task_cmake_presets_invalid")?;
            if name.is_empty()
                || name.len() > 128
                || name.chars().any(char::is_control)
                || !seen.insert(name)
                || preset
                    .get("hidden")
                    .is_some_and(|value| !value.is_boolean())
            {
                return Err("task_cmake_presets_invalid".into());
            }
            if preset.get("hidden").and_then(Value::as_bool) == Some(true)
                || preset.get("condition").and_then(Value::as_bool) == Some(false)
            {
                continue;
            }
            let mut args: Vec<String> = prefix.iter().map(|value| (*value).into()).collect();
            args.push(name.into());
            let command = format!("{manager} {} {name:?}", prefix.join(" "));
            tasks.push(Task {
                id: format!("@cmake/{id}-preset/{name}"),
                name: command.clone(),
                command,
                runnable: true,
                source: "CMakePresets.json".into(),
                manager: manager.into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: args,
            });
        }
    }
    Ok(())
}
