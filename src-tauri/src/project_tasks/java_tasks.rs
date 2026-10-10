//! Fixed Maven and Gradle lifecycle tasks, preferring the project's own wrapper.
use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn wrapper_name(manager: &str) -> &'static str {
    match (manager, cfg!(windows)) {
        ("mvn", true) => "mvnw.cmd",
        ("mvn", false) => "mvnw",
        ("gradle", true) => "gradlew.bat",
        ("gradle", false) => "gradlew",
        _ => unreachable!("fixed Java manager"),
    }
}

fn wrapper(root: &Path, manager: &str, hash: &mut Sha256) -> Result<Option<PathBuf>, String> {
    let name = wrapper_name(manager);
    let Some(bytes) = read_manifest(root, name)? else {
        return Ok(None);
    };
    let path = root.join(name);
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| "task_wrapper_invalid")?;
    if super::directories::linked(&metadata) || !metadata.is_file() {
        return Err("task_wrapper_invalid".into());
    }
    hash.update(name.as_bytes());
    hash.update((bytes.len() as u64).to_le_bytes());
    hash.update(bytes);
    let properties = if manager == "mvn" {
        ".mvn/wrapper/maven-wrapper.properties"
    } else {
        "gradle/wrapper/gradle-wrapper.properties"
    };
    if let Some(bytes) = read_manifest(root, properties)? {
        hash.update(properties.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    Ok(Some(path))
}

pub(crate) fn has_usable_wrapper(root: &Path, manager: &str) -> bool {
    let Ok(Some(_path)) = wrapper(root, manager, &mut Sha256::new()) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if !_path
            .metadata()
            .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
        {
            return false;
        }
    }
    true
}

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    if let Some(bytes) = read_manifest(root, "pom.xml")? {
        hash.update(b"pom.xml");
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
        let wrapped = wrapper(root, "mvn", hash)?.is_some();
        for phase in ["validate", "test", "package"] {
            let command = format!(
                "{} {phase}",
                if wrapped { wrapper_name("mvn") } else { "mvn" }
            );
            tasks.push(Task {
                id: format!("@maven/{phase}"),
                name: command.clone(),
                command,
                runnable: true,
                source: "pom.xml".into(),
                manager: "mvn".into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: vec![phase.into()],
            });
        }
    }
    let gradle = match (
        read_manifest(root, "build.gradle")?,
        read_manifest(root, "build.gradle.kts")?,
    ) {
        (Some(_), Some(_)) => return Err("task_gradle_manifest_conflict".into()),
        (Some(bytes), None) => Some(("build.gradle", bytes)),
        (None, Some(bytes)) => Some(("build.gradle.kts", bytes)),
        (None, None) => None,
    };
    let settings = match (
        read_manifest(root, "settings.gradle")?,
        read_manifest(root, "settings.gradle.kts")?,
    ) {
        (Some(_), Some(_)) => return Err("task_gradle_manifest_conflict".into()),
        (Some(bytes), None) => Some(("settings.gradle", bytes)),
        (None, Some(bytes)) => Some(("settings.gradle.kts", bytes)),
        (None, None) => None,
    };
    if let Some((manifest, bytes)) = gradle.as_ref().or(settings.as_ref()) {
        hash.update(manifest.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
        for name in [
            "build.gradle",
            "build.gradle.kts",
            "settings.gradle",
            "settings.gradle.kts",
            "gradle.properties",
        ] {
            if name == *manifest {
                continue;
            }
            if let Some(bytes) = read_manifest(root, name)? {
                hash.update(name.as_bytes());
                hash.update((bytes.len() as u64).to_le_bytes());
                hash.update(bytes);
            }
        }
        let wrapped = wrapper(root, "gradle", hash)?.is_some();
        for phase in ["tasks", "test", "build"] {
            let command = format!(
                "{} {phase}",
                if wrapped {
                    wrapper_name("gradle")
                } else {
                    "gradle"
                }
            );
            tasks.push(Task {
                id: format!("@gradle/{phase}"),
                name: command.clone(),
                command,
                runnable: true,
                source: (*manifest).into(),
                manager: "gradle".into(),
                interpreter: None,
                unavailable_reason: None,
                arguments: vec![phase.into()],
            });
        }
    }
    Ok(())
}

pub(super) fn executable(
    root: &Path,
    workspace_root: &Path,
    manager: &str,
    environment: &crate::project_environment::Environment,
) -> Result<PathBuf, String> {
    if let Some(path) = wrapper(root, manager, &mut Sha256::new())? {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if !path
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
            {
                return Err("task_wrapper_invalid".into());
            }
        }
        return Ok(path);
    }
    environment.selected(&[manager]).map(Ok).unwrap_or_else(|| {
        environment
            .path()
            .and_then(|path| super::catalog::executable_on_path(workspace_root, manager, &path))
    })
}
