use std::path::PathBuf;

const APP_DATA_DIR_NAME: &str = "zicode";

pub fn data_root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|root| root.join(APP_DATA_DIR_NAME))
        .ok_or_else(|| "Cannot resolve the ZiCode Studio Desktop data directory".to_string())
}

pub fn sessions_root() -> Result<PathBuf, String> {
    Ok(data_root()?.join("sessions"))
}

pub fn agent_inbox_workspace() -> Result<PathBuf, String> {
    Ok(data_root()?.join("workspaces").join("agent-inbox"))
}
