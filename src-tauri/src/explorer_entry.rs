//! Explicit desktop entry points. Shell arguments are data, never commands.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static FOLDER: OnceLock<PathBuf> = OnceLock::new();
static TOOLS_ONLY: OnceLock<bool> = OnceLock::new();
static FILE: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    Install,
    Remove,
    Status,
}

struct ParsedEntry {
    folder: Option<PathBuf>,
    action: Option<MenuAction>,
    tools: bool,
    file: Option<PathBuf>,
}

pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}
pub fn tools_only() -> bool {
    TOOLS_ONLY.get().copied().unwrap_or(false) || FILE.get().is_some()
}
pub fn file() -> Option<&'static Path> {
    FILE.get().map(PathBuf::as_path)
}

#[tauri::command]
pub fn desktop_entry_mode(window: tauri::WebviewWindow) -> Result<&'static str, String> {
    crate::require_workspace_window(&window)?;
    Ok(if file().is_some() {
        "file"
    } else if folder().is_some() {
        "folder"
    } else if tools_only() {
        "tools"
    } else {
        "regular"
    })
}

pub fn configure(args: impl IntoIterator<Item = OsString>) -> Result<Option<MenuAction>, String> {
    let ParsedEntry {
        folder: path,
        action,
        tools,
        file,
    } = parse(args)?;
    TOOLS_ONLY
        .set(tools)
        .map_err(|_| "Desktop entry already configured")?;
    if let Some(path) = path {
        FOLDER
            .set(path)
            .map_err(|_| "Folder entry already configured")?;
    }
    if let Some(file) = file {
        FILE.set(file)
            .map_err(|_| "File entry already configured")?;
    }
    Ok(action)
}

fn parse(args: impl IntoIterator<Item = OsString>) -> Result<ParsedEntry, String> {
    let mut args = args.into_iter();
    let mut folder = None;
    let mut action = None;
    let mut tools = false;
    let mut file = None;
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--open-file") => {
                if file.is_some() {
                    return Err("Only one file may be opened".into());
                }
                file = Some(local_file(PathBuf::from(
                    args.next().ok_or("--open-file requires an absolute file")?,
                ))?);
            }
            Some("--tools-only") => {
                if tools {
                    return Err("Only one tools-only entry may be selected".into());
                }
                tools = true;
            }
            Some("--open-folder") => {
                if folder.is_some() {
                    return Err("Only one folder may be opened".into());
                }
                let path = PathBuf::from(
                    args.next()
                        .ok_or("--open-folder requires an absolute directory")?,
                );
                if !path.is_absolute() || !path.is_dir() || path.to_str().is_none() {
                    return Err("Folder must be an existing absolute Unicode directory".into());
                }
                #[cfg(windows)]
                if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
                    if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
                {
                    return Err("Explorer entry accepts local drive directories only".into());
                }
                folder = Some(
                    path.canonicalize()
                        .map_err(|_| "Cannot resolve selected directory")?,
                );
            }
            Some(
                flag @ ("--install-explorer-menu"
                | "--remove-explorer-menu"
                | "--explorer-menu-status"),
            ) => {
                if action.is_some() {
                    return Err("Select one Explorer menu operation".into());
                }
                action = Some(match flag {
                    "--install-explorer-menu" => MenuAction::Install,
                    "--remove-explorer-menu" => MenuAction::Remove,
                    _ => MenuAction::Status,
                });
            }
            Some("--isolated-profile") => {
                args.next().ok_or("Missing isolated profile")?;
            }
            _ => {}
        }
    }
    if folder.is_some() && action.is_some() {
        return Err("Folder launch and menu configuration must be separate".into());
    }
    if tools && (folder.is_some() || action.is_some()) {
        return Err("Tools-only launch must be separate from folder and menu operations".into());
    }
    if file.is_some() && (tools || folder.is_some() || action.is_some()) {
        return Err("File launch must be separate from tools, folder and menu operations".into());
    }
    Ok(ParsedEntry {
        folder,
        action,
        tools,
        file,
    })
}

fn local_file(path: PathBuf) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.to_str().is_none() {
        return Err("File must be an existing absolute Unicode regular file".into());
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err("File entry accepts local drive files only".into());
    }
    if !path.is_file() {
        return Err("File must be an existing regular file".into());
    }
    for ancestor in path.ancestors() {
        let metadata =
            std::fs::symlink_metadata(ancestor).map_err(|_| "Selected file path is unavailable")?;
        if metadata.file_type().is_symlink() {
            return Err("File entry does not accept linked paths".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("File entry does not accept reparse paths".into());
            }
        }
    }
    path.canonicalize()
        .map_err(|_| "Selected file is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_launch_validates_metadata_and_rejects_mixed_modes() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("studio-file-entry-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("中文 空格&.zip");
        std::fs::write(&file, b"abcd").unwrap();
        let text = file.to_str().unwrap();
        assert_eq!(
            parse(args(&["--open-file", text])).unwrap().file,
            Some(file.canonicalize().unwrap())
        );
        for extra in ["--tools-only", "--explorer-menu-status"] {
            assert!(parse(args(&["--open-file", text, extra])).is_err());
        }
        assert!(parse(args(&["--open-file", text, "--open-file", text])).is_err());
        assert!(parse(args(&[
            "--open-file",
            text,
            "--open-folder",
            root.to_str().unwrap()
        ]))
        .is_err());
        assert!(parse(args(&["--open-file"])).is_err());
        assert!(parse(args(&["--open-file", "relative.zip"])).is_err());
        assert!(parse(args(&["--open-file", root.to_str().unwrap()])).is_err());
        #[cfg(windows)]
        assert!(local_file(PathBuf::from(r"\\server\share\file.zip")).is_err());
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }
    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }
    #[test]
    fn explicit_operations_and_invalid_inputs() {
        assert!(parse(args(&["--tools-only"])).unwrap().tools);
        assert!(parse(args(&["--tools-only", "--tools-only"])).is_err());
        assert!(parse(args(&["--tools-only", "--explorer-menu-status"])).is_err());
        assert_eq!(
            parse(args(&["--install-explorer-menu"])).unwrap().action,
            Some(MenuAction::Install)
        );
        assert!(parse(args(&["--install-explorer-menu", "--remove-explorer-menu"])).is_err());
        assert!(parse(args(&["--open-folder"])).is_err());
        assert!(parse(args(&["--open-folder", "relative"])).is_err());
        let directory = std::env::temp_dir();
        let text = directory.to_str().unwrap();
        assert!(parse(args(&["--tools-only", "--open-folder", text])).is_err());
        assert!(parse(args(&["--open-folder", text, "--explorer-menu-status"])).is_err());
        assert!(parse(args(&["--open-folder", text, "--open-folder", text])).is_err());
        assert_eq!(
            parse(args(&["--open-folder", text])).unwrap().folder,
            Some(directory.canonicalize().unwrap())
        );
        assert!(parse(args(&["--isolated-profile", text]))
            .unwrap()
            .folder
            .is_none());
    }

    #[test]
    fn folder_launch_disables_discovery_in_an_ordinary_profile() {
        const CHILD: &str = "ZICODE_TEST_EXPLORER_DISCOVERY_CHILD";
        if std::env::var_os(CHILD).is_some() {
            assert!(!crate::desktop_profile::is_isolated());
            assert!(crate::desktop_profile::pi_discovery_flags().is_empty());
            configure([
                OsString::from("--open-folder"),
                std::env::temp_dir().into_os_string(),
            ])
            .unwrap();
            assert_eq!(
                crate::desktop_profile::pi_discovery_flags(),
                &[
                    "--no-extensions",
                    "--no-skills",
                    "--no-prompt-templates",
                    "--no-themes"
                ]
            );
            return;
        }
        let result = crate::process_command::new_command(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "explorer_entry::tests::folder_launch_disables_discovery_in_an_ordinary_profile",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
}
