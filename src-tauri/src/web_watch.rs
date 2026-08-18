//! Web watch: detect when a public web page changes, with a content hash diff.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_WATCHERS: usize = 200;
const MAX_NAME_CHARS: usize = 120;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchItem {
    pub id: String,
    pub name: String,
    pub url: String,
    pub last_hash: Option<String>,
    pub last_checked_at: Option<String>,
    pub change_count: usize,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchCheckResult {
    pub id: String,
    pub changed: bool,
    pub hash: String,
    pub content_length: usize,
    pub checked_at: String,
    pub previous_hash: Option<String>,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchFile {
    items: Vec<WatchItem>,
}

fn watch_path(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(".zicode")
        .join("watch")
        .join("watch.json")
}

fn read_file(workspace_root: &Path) -> WatchFile {
    std::fs::read(watch_path(workspace_root))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WatchFile>(&bytes).ok())
        .unwrap_or_default()
}

fn write_file(workspace_root: &Path, file: &WatchFile) -> Result<(), String> {
    let path = watch_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create watch directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(file)
        .map_err(|error| format!("Cannot serialize watch list: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| format!("Cannot save watch list: {error}"))
}

fn validate_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url.trim()).map_err(|_| "URL is invalid".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("Only http and https URLs are supported".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host".to_string())?;
    let addresses: Vec<std::net::IpAddr> = host.parse().map(|ip| vec![ip]).unwrap_or_else(|_| {
        std::net::ToSocketAddrs::to_socket_addrs(&(host, 80))
            .map(|iter| iter.map(|addr| addr.ip()).collect())
            .unwrap_or_default()
    });
    if addresses.is_empty() {
        return Err("URL host cannot be resolved".to_string());
    }
    if let Some(address) = addresses
        .iter()
        .find(|address| !crate::web_extract::is_public_ip(**address))
    {
        return Err(format!("URL host resolves to a private address {address}"));
    }
    Ok(url)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn fetch_page(url: &reqwest::Url) -> Result<(Vec<u8>, Option<String>), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("ZiCode-WebWatch/1.0")
        .build()
        .map_err(|error| format!("Cannot build web client: {error}"))?;
    let response = client
        .get(url.clone())
        .send()
        .map_err(|error| format!("Page is unreachable: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Page returned HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response
        .bytes()
        .map_err(|error| format!("Cannot read page body: {error}"))?;
    let bytes = bytes.to_vec();
    if bytes.len() > MAX_BODY_BYTES {
        return Err(format!(
            "Page exceeds the {MAX_BODY_BYTES} byte watch limit"
        ));
    }
    let text = crate::web_extract::decode_html_bytes(&bytes, &content_type);
    let title = crate::web_extract::extract(&text, url.as_str()).title;
    Ok((bytes, Some(title)))
}

pub fn add(workspace_root: &Path, name: &str, url: &str) -> Result<WatchItem, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Watch name is required".to_string());
    }
    if trimmed_name.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "Watch name exceeds the {MAX_NAME_CHARS} character limit"
        ));
    }
    validate_url(url)?;
    let mut file = read_file(workspace_root);
    if file.items.len() >= MAX_WATCHERS {
        return Err(format!(
            "The maximum of {MAX_WATCHERS} watchers has been reached"
        ));
    }
    let item = WatchItem {
        id: Uuid::new_v4().simple().to_string(),
        name: trimmed_name.to_string(),
        url: url.trim().to_string(),
        last_hash: None,
        last_checked_at: None,
        change_count: 0,
        created_at: Utc::now().to_rfc3339(),
    };
    file.items.insert(0, item.clone());
    write_file(workspace_root, &file)?;
    Ok(item)
}

pub fn list(workspace_root: &Path) -> Vec<WatchItem> {
    read_file(workspace_root).items
}

pub fn remove(workspace_root: &Path, id: &str) -> Result<bool, String> {
    let mut file = read_file(workspace_root);
    let before = file.items.len();
    file.items.retain(|item| item.id != id);
    let removed = file.items.len() < before;
    write_file(workspace_root, &file)?;
    Ok(removed)
}

pub fn update(workspace_root: &Path, id: &str, name: &str, url: &str) -> Result<WatchItem, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Watch name is required".to_string());
    }
    if trimmed_name.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "Watch name exceeds the {MAX_NAME_CHARS} character limit"
        ));
    }
    validate_url(url)?;
    let mut file = read_file(workspace_root);
    let item = file
        .items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "Watcher not found".to_string())?;
    item.name = trimmed_name.to_string();
    item.url = url.trim().to_string();
    let updated = item.clone();
    write_file(workspace_root, &file)?;
    Ok(updated)
}

pub fn check(workspace_root: &Path, id: &str) -> Result<WatchCheckResult, String> {
    let mut file = read_file(workspace_root);
    let index = file
        .items
        .iter()
        .position(|item| item.id == id)
        .ok_or_else(|| "Watcher not found".to_string())?;
    let url = validate_url(&file.items[index].url)?;
    let (bytes, title) = fetch_page(&url)?;
    let hash = sha256_hex(&bytes);
    let previous_hash = file.items[index].last_hash.clone();
    let changed = previous_hash.as_deref() != Some(hash.as_str());
    if changed {
        file.items[index].change_count += 1;
    }
    let checked_at = Utc::now().to_rfc3339();
    file.items[index].last_hash = Some(hash.clone());
    file.items[index].last_checked_at = Some(checked_at.clone());
    write_file(workspace_root, &file)?;
    Ok(WatchCheckResult {
        id: file.items[index].id.clone(),
        changed,
        hash,
        content_length: bytes.len(),
        checked_at,
        previous_hash,
        title,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("web-watch-test-{}", Uuid::new_v4().simple()))
    }

    #[test]
    fn adds_lists_and_removes_watchers() {
        let root = tmp_root();
        let item = add(&root, "  Example  ", "https://example.com/").unwrap();
        assert_eq!(item.name, "Example");
        assert_eq!(list(&root).len(), 1);
        assert!(remove(&root, &item.id).unwrap());
        assert!(list(&root).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rejects_private_and_invalid_urls() {
        let root = tmp_root();
        assert!(add(&root, "local", "http://127.0.0.1/x").is_err());
        assert!(add(&root, "local", "ftp://example.com/x").is_err());
        assert!(add(&root, "missing host", "not a url").is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn updates_a_watcher_name_and_url() {
        let root = tmp_root();
        let item = add(&root, "Example", "https://example.com/").unwrap();
        let updated = update(&root, &item.id, "Renamed", "https://example.org/").unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.url, "https://example.org/");
        assert_eq!(list(&root)[0].name, "Renamed");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn hashes_pages_deterministically() {
        assert_eq!(sha256_hex(b"abc"), sha256_hex(b"abc"));
        assert_ne!(sha256_hex(b"abc"), sha256_hex(b"abd"));
    }
}
