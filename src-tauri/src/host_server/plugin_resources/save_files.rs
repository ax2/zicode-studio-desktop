//! Raw managed exports. Generated names only, no overwrite and no JSON/Base64 payload copy.
use super::*;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX_FOLDERS: usize = 128;
const MAX_BYTES: u64 = 256 * 1024 * 1024;

fn directory(path: &Path) -> Result<(), ApiError> {
    let meta = fs::symlink_metadata(path).map_err(|_| rejected("resource_save_directory_unavailable"))?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return Err(rejected("resource_save_directory_unsafe")); }
    }
    if !meta.is_dir() || meta.file_type().is_symlink() { return Err(rejected("resource_save_directory_unsafe")); }
    Ok(())
}

pub(super) fn location(workspace: &Path, create: bool) -> Result<PathBuf, ApiError> {
    directory(workspace)?;
    let mut path = workspace.to_path_buf();
    for name in [".zicode", "outputs"] {
        path.push(name);
        if create && !path.exists() {
            match fs::create_dir(&path) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}, Err(_) => return Err(rejected("resource_save_directory_unavailable")) }
        }
        if fs::symlink_metadata(&path).is_err() && !create { return Ok(path); }
        directory(&path)?;
    }
    Ok(path)
}

pub(super) fn quota(root: &Path, additional: usize) -> Result<(), ApiError> {
    if !root.exists() { return Ok(()); }
    directory(root)?;
    let mut folders = 0;
    let mut bytes = additional as u64;
    for entry in fs::read_dir(root).map_err(|_| rejected("resource_save_directory_unavailable"))? {
        let entry = entry.map_err(|_| rejected("resource_save_directory_unavailable"))?;
        directory(&entry.path())?;
        folders += 1;
        if folders > MAX_FOLDERS { return Err(rejected("resource_save_quota_exceeded")); }
        for (index, child) in fs::read_dir(entry.path()).map_err(|_| rejected("resource_save_directory_unavailable"))?.take(3).enumerate() {
            if index >= 2 { return Err(rejected("resource_save_directory_unsafe")); }
            let child = child.map_err(|_| rejected("resource_save_directory_unavailable"))?;
            let meta = fs::symlink_metadata(child.path()).map_err(|_| rejected("resource_save_directory_unavailable"))?;
            if !meta.is_file() || meta.file_type().is_symlink() { return Err(rejected("resource_save_directory_unsafe")); }
            bytes = bytes.saturating_add(meta.len());
        }
    }
    if (additional > 0 && folders >= MAX_FOLDERS) || bytes > MAX_BYTES { return Err(rejected("resource_save_quota_exceeded")); }
    Ok(())
}

pub(super) struct Staged { root: PathBuf, path: PathBuf, payload: PathBuf, receipt: PathBuf, owns_payload: bool, owns_receipt: bool,
    published: std::sync::atomic::AtomicBool }
impl Staged {
    pub(super) fn new(workspace: &Path, chunks: &[Arc<[u8]>], receipt: &Value, extension: &str, id: &str) -> Result<Self, ApiError> {
        if uuid::Uuid::parse_str(id).is_err() { return Err(rejected("resource_save_grant_invalid")); }
        let size: usize = chunks.iter().map(|chunk| chunk.len()).sum();
        if size > 32 * 1024 * 1024 || Some(size as u64) != receipt["byteLength"].as_u64()
            || !matches!(extension, "png" | "jpg" | "webp" | "txt" | "bin") { return Err(rejected("resource_metadata_invalid")); }
        let root = location(workspace, true)?;
        quota(&root, size)?;
        let path = root.join(id);
        fs::create_dir(&path).map_err(|_| rejected("resource_save_conflict"))?;
        let mut staged = Self { root, payload: path.join(format!("result.{extension}")), receipt: path.join(".receipt.pending"), path, owns_payload: false, owns_receipt: false,
            published: std::sync::atomic::AtomicBool::new(false) };
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&staged.payload).map_err(|_| rejected("resource_save_write_failed"))?;
        staged.owns_payload = true;
        let mut hash = Sha256::new();
        for chunk in chunks { file.write_all(chunk).map_err(|_| rejected("resource_save_write_failed"))?; hash.update(chunk); }
        file.sync_all().map_err(|_| rejected("resource_save_write_failed"))?;
        if format!("{:x}", hash.finalize()) != receipt["contentVersion"].as_str().unwrap_or("") { return Err(rejected("resource_content_mismatch")); }
        let mut metadata = fs::OpenOptions::new().write(true).create_new(true).open(&staged.receipt).map_err(|_| rejected("resource_save_write_failed"))?;
        staged.owns_receipt = true;
        metadata.write_all(&serde_json::to_vec_pretty(receipt).map_err(|_| rejected("resource_save_write_failed"))?).map_err(|_| rejected("resource_save_write_failed"))?;
        metadata.sync_all().map_err(|_| rejected("resource_save_write_failed"))?;
        Ok(staged)
    }
    pub(super) fn publish(&self, id: &str) -> Result<(), ApiError> {
        if uuid::Uuid::parse_str(id).is_err() { return Err(rejected("resource_save_grant_invalid")); }
        directory(&self.root)?;
        quota(&self.root, 0)?;
        if self.path != self.root.join(id) { return Err(rejected("resource_save_grant_invalid")); }
        directory(&self.path)?;
        let destination = self.path.join("receipt.json");
        // The complete receipt is the publication marker. Unsupported filesystems use
        // a bounded create_new metadata copy; raw payload bytes are never copied twice.
        if fs::hard_link(&self.receipt, &destination).is_err() {
            let bytes = fs::read(&self.receipt).map_err(|_| rejected("resource_save_write_failed"))?;
            if bytes.len() > 8192 { return Err(rejected("resource_save_write_failed")); }
            let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&destination).map_err(|_| rejected("resource_save_conflict"))?;
            if file.write_all(&bytes).and_then(|_| file.sync_all()).is_err() {
                drop(file); let _ = fs::remove_file(destination); return Err(rejected("resource_save_write_failed"));
            }
        }
        self.published.store(true, std::sync::atomic::Ordering::Release);
        Ok(())
    }
}
impl Drop for Staged {
    fn drop(&mut self) {
        if self.owns_payload && !self.published.load(std::sync::atomic::Ordering::Acquire) { let _ = fs::remove_file(&self.payload); }
        if self.owns_receipt { let _ = fs::remove_file(&self.receipt); }
        let _ = fs::remove_dir(&self.path);
    }
}

pub(super) fn replay(workspace: &Path, id: &str, receipt: &Value, extension: &str) -> Result<(), ApiError> {
    use std::io::Read;
    if uuid::Uuid::parse_str(id).is_err() { return Err(rejected("resource_save_grant_invalid")); }
    let root = location(workspace, false)?.join(id); directory(&root)?;
    let path = root.join(format!("result.{extension}"));
    let meta = fs::symlink_metadata(&path).map_err(|_| rejected("resource_save_conflict"))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 32 * 1024 * 1024 { return Err(rejected("resource_save_conflict")); }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|_| rejected("resource_save_conflict"))?.take(32 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| rejected("resource_save_conflict"))?;
    let receipt_path = root.join("receipt.json");
    let meta = fs::symlink_metadata(&receipt_path).map_err(|_| rejected("resource_save_conflict"))?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 8192 { return Err(rejected("resource_save_conflict")); }
    let mut metadata = Vec::new();
    fs::File::open(receipt_path).map_err(|_| rejected("resource_save_conflict"))?.take(8193).read_to_end(&mut metadata).map_err(|_| rejected("resource_save_conflict"))?;
    if bytes.len() as u64 != receipt["byteLength"].as_u64().unwrap_or(u64::MAX)
        || sha256_hex(&bytes) != receipt["contentVersion"].as_str().unwrap_or("")
        || metadata.len() > 8192 || serde_json::from_slice::<Value>(&metadata).ok().as_ref() != Some(receipt) { return Err(rejected("resource_save_conflict")); }
    Ok(())
}
