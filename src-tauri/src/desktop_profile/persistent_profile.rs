//! Optional per-user profile selection, independent of build channel or EXE path.
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    schema_version: u32,
    profile_root: PathBuf,
}

pub(super) fn selected() -> Result<Option<PathBuf>, String> {
    let directory =
        dirs::data_local_dir().ok_or("Cannot resolve the profile selection directory")?;
    read(&directory.join("zicode/desktop-profile.json"))
}

fn read(file: &Path) -> Result<Option<PathBuf>, String> {
    super::require_unlinked(file)?;
    let metadata = match fs::metadata(file) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot read {}: {error}", file.display())),
    };
    if metadata.len() > 4096 {
        return Err("Desktop profile selection is too large".into());
    }
    let selection: Selection = serde_json::from_slice(
        &fs::read(file).map_err(|error| format!("Cannot read {}: {error}", file.display()))?,
    )
    .map_err(|error| format!("Invalid desktop profile selection: {error}"))?;
    let root = selection.profile_root;
    if selection.schema_version != 1 || !root.is_absolute() || root.parent().is_none() {
        return Err(
            "Desktop profile selection requires schemaVersion 1 and an absolute non-root directory"
                .into(),
        );
    }
    super::require_unlinked(&root)?;
    let marker = root.join("profile.json");
    super::require_unlinked(&marker)?;
    // Never silently create a blank profile when a drive or existing data goes missing.
    if !root.is_dir() || !marker.is_file() {
        return Err(format!("Saved Studio data is unavailable at {}. Restore this directory before starting Studio; no empty replacement was created.", root.display()));
    }
    Ok(Some(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_is_stable_and_missing_data_never_creates_a_replacement() {
        let fixture = super::super::tests::Fixture::new();
        let root = fixture.path().join("permanent-data");
        let file = fixture.path().join("desktop-profile.json");
        assert_eq!(read(&file).unwrap(), None);
        drop(super::super::prepare(&root).unwrap());
        let note = root.join("system/note.md");
        fs::create_dir_all(note.parent().unwrap()).unwrap();
        fs::write(&note, "用户笔记\nretain exactly").unwrap();
        fs::write(
            &file,
            serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"profileRoot":root})).unwrap(),
        )
        .unwrap();
        assert_eq!(read(&file).unwrap(), Some(root.clone()));
        assert_eq!(read(&file).unwrap(), Some(root.clone()));
        let relocated = fixture.path().join("temporarily-unavailable");
        fs::rename(&root, &relocated).unwrap();
        assert!(read(&file).unwrap_err().contains("no empty replacement"));
        assert!(!root.exists());
        fs::rename(&relocated, &root).unwrap();
        assert_eq!(
            fs::read_to_string(note).unwrap(),
            "用户笔记\nretain exactly"
        );
        fs::write(&file, r#"{"schemaVersion":1,"profileRoot":"relative"}"#).unwrap();
        assert!(read(&file).is_err());
        fs::write(&file, "{}").unwrap();
        assert!(read(&file).is_err());
    }
}
