use crate::runtime_coordinator::RuntimeTarget;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const APP_DATA_DIR_NAME: &str = "ZiCodeStudioDesktop";

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct RuntimeIsolation {
    pub agent_dir: PathBuf,
    pub session_dir: PathBuf,
    pub log_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub environment: BTreeMap<String, String>,
}

pub fn prepare_runtime_isolation(
    target: &RuntimeTarget,
    portable_git_root: Option<&Path>,
) -> Result<RuntimeIsolation, String> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| "Cannot resolve the local application data directory".to_string())?
        .join(APP_DATA_DIR_NAME);
    prepare_runtime_isolation_at(&root, target, portable_git_root)
}

fn prepare_runtime_isolation_at(
    root: &Path,
    target: &RuntimeTarget,
    portable_git_root: Option<&Path>,
) -> Result<RuntimeIsolation, String> {
    let scene_root = root.join("scenes").join(opaque_key(&target.scene_id));
    let instance_root = root.join("instances").join(opaque_key(&target.instance_id));
    let agent_dir = scene_root.join("agent");
    let session_dir = instance_root.join("sessions");
    let log_dir = instance_root.join("logs");
    let temp_dir = instance_root.join("tmp");

    for directory in [&agent_dir, &session_dir, &log_dir, &temp_dir] {
        fs::create_dir_all(directory)
            .map_err(|error| format!("Cannot create {}: {error}", directory.display()))?;
    }
    let runtime_metadata = serde_json::json!({
        "sceneId": target.scene_id,
        "instanceId": target.instance_id,
        "workspaceId": target.workspace_id,
    });
    fs::write(
        instance_root.join("runtime.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&runtime_metadata)
                .map_err(|error| format!("Cannot encode runtime metadata: {error}"))?
        ),
    )
    .map_err(|error| format!("Cannot write instance runtime metadata: {error}"))?;

    if let Some(portable_git_root) = portable_git_root {
        let bash_path = portable_git_root.join("bin").join("bash.exe");
        if !bash_path.is_file() {
            return Err(format!(
                "Bundled Bash is missing at {}. Run `bun run fetch:portable-git`.",
                bash_path.display()
            ));
        }
        merge_shell_path(&agent_dir.join("settings.json"), &bash_path)?;
    }

    let environment = BTreeMap::from([
        ("PI_CODING_AGENT_DIR".to_string(), path_string(&agent_dir)),
        (
            "PI_CODING_AGENT_SESSION_DIR".to_string(),
            path_string(&session_dir),
        ),
        ("PI_DESKTOP_SCENE_ID".to_string(), target.scene_id.clone()),
        (
            "PI_DESKTOP_INSTANCE_ID".to_string(),
            target.instance_id.clone(),
        ),
        (
            "PI_DESKTOP_INSTANCE_DIR".to_string(),
            path_string(&instance_root),
        ),
        ("PI_DESKTOP_LOG_DIR".to_string(), path_string(&log_dir)),
        ("TEMP".to_string(), path_string(&temp_dir)),
        ("TMP".to_string(), path_string(&temp_dir)),
    ]);

    Ok(RuntimeIsolation {
        agent_dir,
        session_dir,
        log_dir,
        temp_dir,
        environment,
    })
}

fn opaque_key(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn merge_shell_path(settings_path: &Path, bash_path: &Path) -> Result<(), String> {
    let mut settings = if settings_path.is_file() {
        let contents = fs::read_to_string(settings_path)
            .map_err(|error| format!("Cannot read {}: {error}", settings_path.display()))?;
        serde_json::from_str::<Value>(&contents)
            .map_err(|error| format!("Invalid JSON in {}: {error}", settings_path.display()))?
    } else {
        Value::Object(Map::new())
    };
    let object = settings.as_object_mut().ok_or_else(|| {
        format!(
            "Pi settings must be a JSON object: {}",
            settings_path.display()
        )
    })?;
    object.insert(
        "shellPath".to_string(),
        Value::String(path_string(bash_path)),
    );

    let temp_path = settings_path.with_extension(format!("json.tmp-{}", std::process::id()));
    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Cannot serialize Pi settings: {error}"))?;
    fs::write(&temp_path, format!("{serialized}\n"))
        .map_err(|error| format!("Cannot write {}: {error}", temp_path.display()))?;
    fs::rename(&temp_path, settings_path)
        .map_err(|error| format!("Cannot replace {}: {error}", settings_path.display()))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{opaque_key, prepare_runtime_isolation_at};
    use crate::runtime_coordinator::RuntimeTarget;
    use serde_json::Value;
    use std::fs;

    #[test]
    fn hashes_untrusted_ids_and_separates_scene_from_instance_state() {
        let temp = std::env::temp_dir().join(format!(
            "pi-desktop-isolation-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let portable = temp.join("portable-git");
        fs::create_dir_all(portable.join("bin")).unwrap();
        fs::write(portable.join("bin").join("bash.exe"), b"test").unwrap();
        let target =
            RuntimeTarget::new("workspace", "session", "../../instance").with_scene("../finance");

        let isolation = prepare_runtime_isolation_at(&temp, &target, Some(&portable)).unwrap();

        assert!(isolation.agent_dir.starts_with(temp.join("scenes")));
        assert!(isolation.session_dir.starts_with(temp.join("instances")));
        assert!(!isolation.agent_dir.to_string_lossy().contains("finance"));
        assert!(!isolation.session_dir.to_string_lossy().contains("instance"));
        assert_ne!(
            opaque_key(&target.scene_id),
            opaque_key(&target.instance_id)
        );
        assert_eq!(
            isolation.environment["PI_CODING_AGENT_DIR"],
            isolation.agent_dir.to_string_lossy()
        );
        assert_eq!(
            isolation.environment["PI_CODING_AGENT_SESSION_DIR"],
            isolation.session_dir.to_string_lossy()
        );
        assert!(isolation.log_dir.is_dir());
        assert!(isolation.temp_dir.is_dir());

        let settings: Value = serde_json::from_str(
            &fs::read_to_string(isolation.agent_dir.join("settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            settings["shellPath"].as_str().unwrap(),
            portable.join("bin").join("bash.exe").to_string_lossy()
        );
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn preserves_existing_scene_settings_when_injecting_bundled_bash() {
        let temp = std::env::temp_dir().join(format!(
            "pi-desktop-isolation-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let portable = temp.join("portable-git");
        fs::create_dir_all(portable.join("bin")).unwrap();
        fs::write(portable.join("bin").join("bash.exe"), b"test").unwrap();
        let target = RuntimeTarget::new("workspace", "session", "instance");
        let agent_dir = temp
            .join("scenes")
            .join(opaque_key("programming"))
            .join("agent");
        fs::create_dir_all(&agent_dir).unwrap();
        fs::write(
            agent_dir.join("settings.json"),
            r#"{"theme":"dark","custom":{"keep":true}}"#,
        )
        .unwrap();

        prepare_runtime_isolation_at(&temp, &target, Some(&portable)).unwrap();

        let settings: Value =
            serde_json::from_str(&fs::read_to_string(agent_dir.join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["custom"]["keep"], true);
        assert!(settings["shellPath"]
            .as_str()
            .unwrap()
            .ends_with("bash.exe"));
        fs::remove_dir_all(temp).unwrap();
    }
}
