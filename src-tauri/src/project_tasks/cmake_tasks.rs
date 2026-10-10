//! Fixed CMake tasks use an app-owned build directory under the selected project.
use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::Path;

const BUILD_DIRECTORY: &str = "build/zicode-studio";

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    let Some(bytes) = read_manifest(root, "CMakeLists.txt")? else {
        return Ok(());
    };
    hash.update(b"CMakeLists.txt");
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
    for (id, manager, args) in [
        ("configure", "cmake", vec!["-S", ".", "-B", BUILD_DIRECTORY]),
        ("build", "cmake", vec!["--build", BUILD_DIRECTORY]),
        (
            "test",
            "ctest",
            vec!["--test-dir", BUILD_DIRECTORY, "--output-on-failure"],
        ),
    ] {
        let command = format!("{manager} {}", args.join(" "));
        tasks.push(Task {
            id: format!("@cmake/{id}"),
            name: command.clone(),
            command,
            runnable: true,
            source: "CMakeLists.txt".into(),
            manager: manager.into(),
            interpreter: None,
            unavailable_reason: None,
            arguments: args.into_iter().map(str::to_owned).collect(),
        });
    }
    super::cmake_presets::append(root, tasks, hash)?;
    Ok(())
}

pub(super) fn validate_build_directory(root: &Path) -> Result<(), String> {
    let mut path = root.to_path_buf();
    for component in ["build", "zicode-studio"] {
        path.push(component);
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err("task_cmake_build_dir_invalid".into()),
        };
        if super::directories::linked(&metadata) || !metadata.is_dir() {
            return Err("task_cmake_build_dir_invalid".into());
        }
        let canonical = path
            .canonicalize()
            .map_err(|_| "task_cmake_build_dir_invalid")?;
        if !canonical.starts_with(root) {
            return Err("task_cmake_build_dir_invalid".into());
        }
    }
    Ok(())
}
