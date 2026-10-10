use super::{python::Kind, PythonEnvironment};
use serde::Serialize;
use std::path::Path;

const ERROR: &str = "project_conda_discovery_unavailable";
const MAX_BYTES: u64 = 128 * 1024;
const MAX_ENTRIES: usize = 256;
const MAX_CONFIGURED_DIRECTORIES: usize = 16;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CondaEnvironment {
    name: String,
    path: String,
    source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CondaDiscovery {
    status: &'static str,
    truncated: bool,
    environments: Vec<CondaEnvironment>,
}

pub fn discover_conda() -> Result<CondaDiscovery, String> {
    let home = dirs::home_dir().ok_or(ERROR)?;
    let registry = home.join(".conda").join("environments.txt");
    let mut environments: Vec<CondaEnvironment> = Vec::new();
    let mut truncated = false;
    let mut found_source = false;
    match std::fs::metadata(&registry) {
        Ok(metadata) => {
            found_source = true;
            if !metadata.is_file() || metadata.len() > MAX_BYTES {
                return Err(ERROR.into());
            }
            let contents = std::fs::read_to_string(&registry).map_err(|_| ERROR)?;
            if contents.len() as u64 > MAX_BYTES {
                return Err(ERROR.into());
            }
            for (index, line) in contents.lines().enumerate() {
                if index >= MAX_ENTRIES {
                    truncated = true;
                    break;
                }
                add_candidate(&mut environments, line.trim(), "registry");
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(ERROR.into()),
    }

    let user_envs = home.join(".conda").join("envs");
    match std::fs::read_dir(&user_envs) {
        Ok(entries) => {
            found_source = true;
            for (index, entry) in entries.enumerate() {
                if index >= MAX_ENTRIES {
                    truncated = true;
                    break;
                }
                let entry = entry.map_err(|_| ERROR)?;
                let Some(path) = entry.path().to_str().map(str::to_owned) else {
                    continue;
                };
                add_candidate(&mut environments, &path, "userDirectory");
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(ERROR.into()),
    }
    if let Some(prefix) = std::env::var_os("CONDA_PREFIX") {
        let prefix = std::path::PathBuf::from(prefix);
        if prefix.is_absolute() {
            found_source = true;
            if let Some(path) = prefix.to_str() {
                add_candidate(&mut environments, path, "hostActivation");
            }
        }
    }
    if let Some(paths) = std::env::var_os("CONDA_ENVS_PATH") {
        let mut checked = 0;
        'configured: for (index, directory) in std::env::split_paths(&paths)
            .filter(|path| path.is_absolute())
            .enumerate()
        {
            if index >= MAX_CONFIGURED_DIRECTORIES {
                truncated = true;
                break;
            }
            match std::fs::read_dir(directory) {
                Ok(entries) => {
                    found_source = true;
                    for entry in entries {
                        if checked >= MAX_ENTRIES {
                            truncated = true;
                            break 'configured;
                        }
                        checked += 1;
                        let entry = entry.map_err(|_| ERROR)?;
                        if let Some(path) = entry.path().to_str() {
                            add_candidate(&mut environments, path, "configuredDirectory");
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(ERROR.into()),
            }
        }
    }
    Ok(CondaDiscovery {
        status: if found_source { "available" } else { "missing" },
        truncated,
        environments,
    })
}

fn add_candidate(environments: &mut Vec<CondaEnvironment>, value: &str, source: &'static str) {
    let Ok(selected) = PythonEnvironment::inspect(value) else {
        return;
    };
    if !matches!(selected.kind, Kind::Conda) {
        return;
    }
    let Some(path) = selected.root.to_str() else {
        return;
    };
    if environments.iter().any(|entry| entry.path == path) {
        return;
    }
    let name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(path)
        .to_owned();
    environments.push(CondaEnvironment {
        name,
        path: path.to_owned(),
        source,
    });
}
