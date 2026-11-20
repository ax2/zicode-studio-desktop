//! Download destinations are chosen by trusted chrome. Never overwrite a file.
use std::path::{Path, PathBuf};

#[path = "../download_filename.rs"]
mod names;
pub use names::filename;
use names::prefix;

#[allow(dead_code)] // The standalone engine probe has no trusted save/list chrome.
pub fn default_target(folder: &Path, name: &str) -> Result<PathBuf, String> {
    let name = filename(name);
    let path = Path::new(&name);
    let stem = path.file_stem().and_then(|p| p.to_str()).unwrap_or("download");
    let extension = path.extension().and_then(|p| p.to_str()).map(|v| format!(".{v}")).unwrap_or_default();
    for index in 0..1000 {
        let suffix = format!(" ({index}){extension}");
        let budget = 180usize.saturating_sub(suffix.encode_utf16().count());
        if index > 0 && budget == 0 { return Err("Choose another download filename".into()); }
        let path = folder.join(if index == 0 { name.clone() } else { format!("{}{}", prefix(stem,budget),suffix) });
        if !path.try_exists().map_err(|e| e.to_string())? { return Ok(path); }
    }
    Err("Choose another download filename".into())
}

#[allow(dead_code)] // The standalone engine probe has no trusted save/list chrome.
pub fn prepare(target: &Path, id: &str) -> Result<PathBuf, String> {
    reserve(target, id).map(|(staging, _file)| staging)
}

pub fn reserve(target: &Path, id: &str) -> Result<(PathBuf, std::fs::File), String> {
    let name = target.file_name().and_then(|p| p.to_str()).ok_or("Invalid download filename")?;
    if !target.is_absolute() || filename(name) != name || uuid::Uuid::parse_str(id).is_err() {
        return Err("Invalid download destination".into());
    }
    if target.try_exists().map_err(|e| e.to_string())? { return Err("A file already exists at this location".into()); }
    let parent = target.parent().ok_or("Invalid download destination")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Keep the real extension for the engine's file-type/security checks.
    let staging = parent.join(format!(".zicode-download-{id}-{name}"));
    // Reserve only our unique temporary file. The requested destination stays absent
    // until completion; a concurrent creator is protected by MoveFileExW flags=0.
    let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&staging).map_err(|e| e.to_string())?;
    Ok((staging, file))
}

pub fn finish(staging: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    let from: Vec<u16> = staging.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_finalization_cannot_overwrite_existing_data() {
        assert_eq!(filename("C:\\private\\CON.txt"), "download.bin");
        assert_eq!(filename("../../report:secret.txt"), "report_secret.txt");
        assert!(filename(&"😀".repeat(180)).encode_utf16().count() <= 180);
        let long = filename(&format!("{}.exe", "😀".repeat(180)));
        assert!(long.ends_with(".exe")); assert!(long.encode_utf16().count() <= 180);
        let root = std::env::temp_dir().join(format!("browser-download-files-{}", uuid::Uuid::new_v4()));
        let destination = root.join("report.txt");
        let part = prepare(&destination, &uuid::Uuid::new_v4().to_string()).unwrap();
        assert_eq!(part.extension(), destination.extension());
        std::fs::write(&part, b"new download").unwrap();
        std::fs::write(&destination, b"existing user file").unwrap();
        assert!(finish(&part, &destination).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"existing user file");
        assert!(prepare(&destination, &uuid::Uuid::new_v4().to_string()).is_err());
        let alternate = default_target(&root, "report.txt").unwrap();
        assert_eq!(alternate.file_name().unwrap(), "report (1).txt");
        finish(&part, &alternate).unwrap();
        assert_eq!(std::fs::read(&alternate).unwrap(), b"new download");
        assert!(!part.exists());
        assert!(prepare(&root.join("bad:stream"), &uuid::Uuid::new_v4().to_string()).is_err());
        let long_name = filename(&format!("{}.txt", "文".repeat(190)));
        std::fs::write(root.join(&long_name), b"existing").unwrap();
        let unique = default_target(&root, &long_name).unwrap();
        let basename = unique.file_name().unwrap().to_str().unwrap();
        assert_eq!(filename(basename), basename); assert!(basename.ends_with(" (1).txt"));
        let long_extension = format!("a.{}", "x".repeat(178));
        std::fs::write(root.join(&long_extension), b"existing").unwrap();
        assert!(default_target(&root, &long_extension).is_err());
    }
}
