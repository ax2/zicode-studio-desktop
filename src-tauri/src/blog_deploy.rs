//! Blog server upload via SFTP (SSH password authentication). Mirrors the
//! reference Python `scripts/deploy_astro.py`, which uses paramiko to push the
//! built static site to the remote `astro_publish_path`.

use crate::articles_config::BlogServerConfig;
use russh::client;
use russh_sftp::client::SftpSession;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, Mutex};

fn host_key_fingerprint(key: &russh::keys::PublicKey) -> Option<String> {
    let openssh = key.to_openssh().ok()?;
    Some(format!("{:x}", Sha256::digest(openssh.as_bytes())))
}

struct ClientHandler {
    expected_fingerprint: Option<String>,
    observed_fingerprint: Arc<Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = host_key_fingerprint(server_public_key);
        if let Ok(mut observed) = self.observed_fingerprint.lock() {
            *observed = fingerprint.clone();
        }
        match (&self.expected_fingerprint, fingerprint) {
            // Trust on first use: no pinned fingerprint yet.
            (None, _) => Ok(true),
            (Some(expected), Some(actual)) => Ok(actual == *expected),
            (Some(_), None) => Ok(false),
        }
    }
}

async fn connect(config: &BlogServerConfig) -> Result<(SftpSession, Option<String>), String> {
    if config.host.is_empty() || config.username.is_empty() || config.password.is_empty() {
        return Err("Blog server host, username, and password are not configured".to_string());
    }
    let observed = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        expected_fingerprint: config.host_key_fingerprint.clone(),
        observed_fingerprint: observed.clone(),
    };
    let mut session = client::connect(
        Arc::new(client::Config::default()),
        (config.host.as_str(), 22),
        handler,
    )
    .await
    .map_err(|error| {
        format!(
            "Cannot connect to blog server {} (host key may have changed): {error}",
            config.host
        )
    })?;

    let auth = session
        .authenticate_password(&config.username, &config.password)
        .await
        .map_err(|error| format!("Blog server authentication failed: {error}"))?;
    if !auth.success() {
        return Err("Blog server rejected the username or password".to_string());
    }

    let channel = session
        .channel_open_session()
        .await
        .map_err(|error| format!("Cannot open SSH channel: {error}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|error| format!("Blog server does not provide SFTP: {error}"))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|error| format!("Cannot initialize SFTP: {error}"))?;
    let new_fingerprint = if config.host_key_fingerprint.is_none() {
        observed
            .lock()
            .ok()
            .and_then(|fingerprint| fingerprint.clone())
    } else {
        None
    };
    Ok((sftp, new_fingerprint))
}

async fn ensure_remote_dir(sftp: &SftpSession, remote_dir: &str) -> Result<(), String> {
    let mut current = String::new();
    for part in remote_dir.split('/').filter(|part| !part.is_empty()) {
        current.push('/');
        current.push_str(part);
        let _ = sftp.create_dir(&current).await;
    }
    Ok(())
}

/// Recursively upload a local directory to the remote SFTP path. Returns the
/// number of uploaded files.
pub async fn upload_directory(
    config: &BlogServerConfig,
    local_dir: &Path,
    remote_dir: &str,
) -> Result<(usize, Option<String>), String> {
    if !local_dir.is_dir() {
        return Err("Local directory to publish does not exist".to_string());
    }
    let (sftp, new_fingerprint) = connect(config).await?;
    ensure_remote_dir(&sftp, remote_dir).await?;

    let mut uploaded = 0usize;
    let mut stack = vec![local_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|error| format!("Cannot read local directory {}: {error}", dir.display()))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let path = entry.path();
            let relative = path
                .strip_prefix(local_dir)
                .map_err(|error| error.to_string())?;
            let remote_path = format!(
                "{}/{}",
                remote_dir.trim_end_matches('/'),
                relative.to_string_lossy().replace('\\', "/")
            );
            let metadata = entry.metadata().await.map_err(|error| error.to_string())?;
            if metadata.is_dir() {
                let _ = sftp.create_dir(&remote_path).await;
                stack.push(path);
            } else if metadata.is_file() {
                let bytes = tokio::fs::read(&path)
                    .await
                    .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
                sftp.write(&remote_path, &bytes)
                    .await
                    .map_err(|error| format!("Cannot upload {remote_path}: {error}"))?;
                uploaded += 1;
            }
        }
    }
    Ok((uploaded, new_fingerprint))
}
