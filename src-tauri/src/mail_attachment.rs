use std::{
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[cfg(windows)]
use crate::browser::download_filename;
#[cfg(not(windows))]
#[path = "download_filename.rs"]
mod names;
#[cfg(not(windows))]
use names::filename as download_filename;

pub fn choose(window: &WebviewWindow, name: &str) -> Result<Option<PathBuf>, &'static str> {
    let Some(picked) = window
        .app_handle()
        .dialog()
        .file()
        .set_parent(window)
        .set_file_name(download_filename(name))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| "mail_attachment_save_failed")?;
    if path
        .try_exists()
        .map_err(|_| "mail_attachment_save_failed")?
    {
        return Err("mail_attachment_exists");
    }
    Ok(Some(path))
}

pub fn save(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("mail_attachment_save_failed")?)
            .map_err(|_| "mail_attachment_save_failed")?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "mail_attachment_save_failed")?;
    file.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            "mail_attachment_exists"
        } else {
            "mail_attachment_save_failed"
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_preserves_existing_bytes_and_commits_a_complete_new_file() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("proof.bin");
        save(&destination, &[0, 255, 17]).unwrap();
        assert_eq!(save(&destination, b"second"), Err("mail_attachment_exists"));
        assert_eq!(std::fs::read(destination).unwrap(), [0, 255, 17]);
        assert_eq!(directory.path().read_dir().unwrap().count(), 1);
    }
}
