//! Explicit desktop entry points. Shell arguments are data, never commands.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

use crate::explorer_launch_state::{EntryIntent, ExplorerLaunchState};

static FOLDER: OnceLock<PathBuf> = OnceLock::new();
static TOOLS_ONLY: OnceLock<bool> = OnceLock::new();
static FILE: OnceLock<PathBuf> = OnceLock::new();
static SELECTION: OnceLock<Vec<PathBuf>> = OnceLock::new();
const MAX_SELECTION: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    Install,
    Remove,
    RemoveCurrent,
    Status,
}

struct ParsedEntry {
    folder: Option<PathBuf>,
    action: Option<MenuAction>,
    tools: bool,
    file: Option<PathBuf>,
    selection: Option<Vec<PathBuf>>,
}

pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}
pub fn tools_only() -> bool {
    TOOLS_ONLY.get().copied().unwrap_or(false)
        || FILE.get().is_some()
        || SELECTION.get().is_some()
        || drive_root_folder()
}

pub fn drive_root_folder() -> bool {
    FOLDER.get().is_some_and(|path| drive_root(path))
}

fn drive_root(path: &Path) -> bool {
    #[cfg(windows)]
    {
        path.parent().is_none()
            && matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
                if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}
pub fn file() -> Option<&'static Path> {
    FILE.get().map(PathBuf::as_path)
}

pub fn selection() -> Option<&'static [PathBuf]> {
    SELECTION.get().map(Vec::as_slice)
}

pub fn initial_intent() -> Option<EntryIntent> {
    if let Some(paths) = selection() {
        Some(EntryIntent::Selection(paths.to_vec()))
    } else if let Some(path) = file() {
        Some(EntryIntent::File(path.to_path_buf()))
    } else if drive_root_folder() {
        Some(EntryIntent::Drive)
    } else if let Some(path) = folder() {
        Some(EntryIntent::Folder(path.to_path_buf()))
    } else if tools_only() {
        Some(EntryIntent::Tools)
    } else {
        None
    }
}

/// The second process supplies only a launch request. The first process
/// validates the executable and selected path again before binding a hint.
pub fn forwarded_intent(args: &[String]) -> Result<Option<EntryIntent>, String> {
    let Some((executable, arguments)) = args.split_first() else {
        return Err("Missing launch executable".into());
    };
    let launched = PathBuf::from(executable.as_str())
        .canonicalize()
        .map_err(|_| "Launch executable is unavailable")?;
    let current = std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|_| "Current executable is unavailable")?;
    if launched != current {
        return Err("Launch belongs to another Studio installation".into());
    }
    let mut entry_args = Vec::with_capacity(arguments.len());
    let mut profile_seen = false;
    let mut remaining = arguments.iter();
    while let Some(argument) = remaining.next() {
        if argument == "--isolated-profile" {
            if profile_seen {
                return Err("Duplicate isolated profile in secondary launch".into());
            }
            let root = remaining.next().ok_or("Missing isolated profile")?;
            let expected = crate::desktop_profile::root()
                .ok_or("Secondary launch has an unexpected isolated profile")?;
            let actual = PathBuf::from(root)
                .canonicalize()
                .map_err(|_| "Secondary isolated profile is unavailable")?;
            if actual != expected {
                return Err("Secondary launch belongs to another isolated profile".into());
            }
            profile_seen = true;
        } else {
            entry_args.push(argument.as_str());
        }
    }
    if crate::desktop_profile::is_isolated() && !profile_seen {
        return Err("Secondary launch omitted its isolated profile".into());
    }
    match entry_args.as_slice() {
        [] => Ok(None),
        [flag] if *flag == "--tools-only" => Ok(Some(EntryIntent::Tools)),
        [flag, path] if *flag == "--open-file" => {
            Ok(Some(EntryIntent::File(local_file(PathBuf::from(*path))?)))
        }
        [flag, count, paths @ ..] if *flag == "--open-selection" => {
            Ok(Some(EntryIntent::Selection(selection_paths(count, paths)?)))
        }
        [flag, path] if *flag == "--open-folder" => {
            let path = local_folder(PathBuf::from(*path))?;
            Ok(Some(if drive_root(&path) {
                EntryIntent::Drive
            } else {
                EntryIntent::Folder(path)
            }))
        }
        _ => Err("Unsupported secondary Studio launch arguments".into()),
    }
}

#[tauri::command]
pub fn desktop_entry_mode(window: tauri::WebviewWindow) -> Result<&'static str, String> {
    crate::require_workspace_window(&window)?;
    let route = window.url().map_err(|error| error.to_string())?;
    let state = window
        .try_state::<ExplorerLaunchState>()
        .ok_or("Explorer launch state is unavailable")?;
    Ok(state
        .intent(window.label(), route.path())?
        .as_ref()
        .map_or("regular", EntryIntent::mode))
}

pub fn configure(args: impl IntoIterator<Item = OsString>) -> Result<Option<MenuAction>, String> {
    let ParsedEntry {
        folder: path,
        action,
        tools,
        file,
        selection,
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
    if let Some(selection) = selection {
        SELECTION
            .set(selection)
            .map_err(|_| "Selection entry already configured")?;
    }
    Ok(action)
}

fn parse(args: impl IntoIterator<Item = OsString>) -> Result<ParsedEntry, String> {
    let mut args = args.into_iter();
    let mut folder = None;
    let mut action = None;
    let mut tools = false;
    let mut file = None;
    let mut selection = None;
    let mut unknown = false;
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
            Some("--open-selection") => {
                if selection.is_some() {
                    return Err("Only one selection may be opened".into());
                }
                let count = args.next().ok_or("--open-selection requires a count")?;
                let count = count.to_str().ok_or("Selection count must be Unicode")?;
                let length = selection_count(count)?;
                let paths = (0..length)
                    .map(|_| args.next().ok_or("Missing selected file"))
                    .collect::<Result<Vec<_>, _>>()?;
                let paths = paths.iter().map(|path| path.to_str().ok_or("Selected path must be Unicode"))
                    .collect::<Result<Vec<_>, _>>()?;
                selection = Some(selection_paths(count, &paths)?);
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
                let path = local_folder(PathBuf::from(
                    args.next()
                        .ok_or("--open-folder requires an absolute directory")?,
                ))?;
                folder = Some(path);
            }
            Some(
                flag @ ("--install-explorer-menu"
                | "--remove-explorer-menu"
                | "--remove-explorer-menu-current"
                | "--explorer-menu-status"),
            ) => {
                if action.is_some() {
                    return Err("Select one Explorer menu operation".into());
                }
                action = Some(match flag {
                    "--install-explorer-menu" => MenuAction::Install,
                    "--remove-explorer-menu" => MenuAction::Remove,
                    "--remove-explorer-menu-current" => MenuAction::RemoveCurrent,
                    _ => MenuAction::Status,
                });
            }
            Some("--isolated-profile") => {
                args.next().ok_or("Missing isolated profile")?;
            }
            _ => unknown = true,
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
    if selection.is_some() && (file.is_some() || tools || folder.is_some() || action.is_some()) {
        return Err("Selection launch must be separate from other desktop operations".into());
    }
    if selection.is_some() && unknown {
        return Err("Unexpected selection launch argument".into());
    }
    Ok(ParsedEntry {
        folder,
        action,
        tools,
        file,
        selection,
    })
}

fn selection_count(count: &str) -> Result<usize, String> {
    let parsed = count.parse::<usize>().map_err(|_| "Invalid selection count")?;
    if !(2..=MAX_SELECTION).contains(&parsed) || parsed.to_string() != count {
        return Err("Selection must contain two to four files".into());
    }
    Ok(parsed)
}

fn selection_paths(count: &str, paths: &[&str]) -> Result<Vec<PathBuf>, String> {
    if selection_count(count)? != paths.len() {
        return Err("Selection count does not match the selected files".into());
    }
    let selected = paths.iter().map(|path| local_file(PathBuf::from(path)))
        .collect::<Result<Vec<_>, _>>()?;
    let parent = selected[0].parent();
    if selected.iter().any(|path| path.parent() != parent) {
        return Err("Selected files must share one project directory".into());
    }
    let mut unique = std::collections::HashSet::new();
    if selected.iter().any(|path| !unique.insert(path.to_string_lossy().to_lowercase())) {
        return Err("Selected files must be distinct".into());
    }
    Ok(selected)
}

fn local_folder(path: PathBuf) -> Result<PathBuf, String> {
    if !path.is_absolute() || !path.is_dir() || path.to_str().is_none() {
        return Err("Folder must be an existing absolute Unicode directory".into());
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err("Explorer entry accepts local drive directories only".into());
    }
    path.canonicalize()
        .map_err(|_| "Cannot resolve selected directory".into())
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
    fn forwarded_launch_revalidates_executable_and_selected_file() {
        let executable = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let directory = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("studio-forwarded-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let file = directory.join("中文 空格&.zip");
        std::fs::write(&file, b"archive").unwrap();
        assert_eq!(forwarded_intent(std::slice::from_ref(&executable)).unwrap(), None);
        assert_eq!(
            forwarded_intent(&[
                executable.clone(),
                "--open-file".into(),
                file.to_string_lossy().into_owned()
            ])
            .unwrap(),
            Some(EntryIntent::File(file.canonicalize().unwrap()))
        );
        assert_eq!(
            forwarded_intent(&[
                executable.clone(),
                "--open-folder".into(),
                directory.to_string_lossy().into_owned()
            ])
            .unwrap(),
            Some(EntryIntent::Folder(directory.canonicalize().unwrap()))
        );
        assert!(forwarded_intent(&[executable.clone(), "--open-file".into()]).is_err());
        assert!(
            forwarded_intent(&[executable.clone(), "--tools-only".into(), "extra".into()]).is_err()
        );
        std::fs::remove_file(&file).unwrap();
        assert!(forwarded_intent(&[
            executable,
            "--open-file".into(),
            file.to_string_lossy().into_owned()
        ])
        .is_err());
        std::fs::remove_dir(&directory).unwrap();
    }
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
    #[test]
    fn bounded_file_selection_is_one_tool_intent_without_content_access() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("studio-selection-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let one = root.join("中文 空格&.zip");
        let two = root.join("next.txt");
        std::fs::write(&one, b"one").unwrap();
        std::fs::write(&two, b"two").unwrap();
        let one_text = one.to_str().unwrap();
        let two_text = two.to_str().unwrap();
        let expected = vec![one.canonicalize().unwrap(), two.canonicalize().unwrap()];
        assert_eq!(parse(args(&["--open-selection", "2", one_text, two_text])).unwrap().selection, Some(expected.clone()));
        let executable = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        assert_eq!(forwarded_intent(&[executable.clone(), "--open-selection".into(), "2".into(),
            one_text.into(), two_text.into()]).unwrap(), Some(EntryIntent::Selection(expected)));
        for input in [
            vec!["--open-selection", "1", one_text],
            vec!["--open-selection", "02", one_text, two_text],
            vec!["--open-selection", "2", one_text],
            vec!["--open-selection", "2", one_text, one_text],
            vec!["--open-selection", "2", one_text, two_text, "extra.txt"],
            vec!["--open-selection", "2", one_text, two_text, "--tools-only"],
        ] { assert!(parse(args(&input)).is_err()); }
        let other = root.join("other");
        std::fs::create_dir(&other).unwrap();
        let outside = other.join("third.txt");
        std::fs::write(&outside, b"third").unwrap();
        assert!(parse(args(&["--open-selection", "2", one_text, outside.to_str().unwrap()])).is_err());
        std::fs::remove_file(&outside).unwrap();
        std::fs::remove_dir(other).unwrap();
        std::fs::remove_file(&one).unwrap();
        std::fs::remove_file(&two).unwrap();
        std::fs::remove_dir(root).unwrap();
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
        assert_eq!(
            parse(args(&["--remove-explorer-menu-current"])).unwrap().action,
            Some(MenuAction::RemoveCurrent)
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

    #[cfg(windows)]
    #[test]
    fn drive_root_is_distinct_from_an_ordinary_folder() {
        let project = std::env::current_dir().unwrap().canonicalize().unwrap();
        let root = project.ancestors().last().unwrap();
        assert!(drive_root(root));
        assert!(!drive_root(&project));
        let parsed = parse(args(&["--open-folder", root.to_str().unwrap()])).unwrap();
        assert!(drive_root(parsed.folder.as_deref().unwrap()));
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
