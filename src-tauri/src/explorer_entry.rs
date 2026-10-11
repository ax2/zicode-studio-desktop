//! Explicit desktop entry points. Shell arguments are data, never commands.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static FOLDER: OnceLock<PathBuf> = OnceLock::new();
static TOOLS_ONLY: OnceLock<bool> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    Install,
    Remove,
    Status,
}

pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}
pub fn tools_only() -> bool {
    TOOLS_ONLY.get().copied().unwrap_or(false)
}

pub fn configure(args: impl IntoIterator<Item = OsString>) -> Result<Option<MenuAction>, String> {
    let (path, action, tools) = parse(args)?;
    TOOLS_ONLY
        .set(tools)
        .map_err(|_| "Desktop entry already configured")?;
    if let Some(path) = path {
        FOLDER
            .set(path)
            .map_err(|_| "Folder entry already configured")?;
    }
    Ok(action)
}

fn parse(
    args: impl IntoIterator<Item = OsString>,
) -> Result<(Option<PathBuf>, Option<MenuAction>, bool), String> {
    let mut args = args.into_iter();
    let mut folder = None;
    let mut action = None;
    let mut tools = false;
    while let Some(arg) = args.next() {
        match arg.to_str() {
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
    Ok((folder, action, tools))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }
    #[test]
    fn explicit_operations_and_invalid_inputs() {
        assert!(parse(args(&["--tools-only"])).unwrap().2);
        assert!(parse(args(&["--tools-only", "--tools-only"])).is_err());
        assert!(parse(args(&["--tools-only", "--explorer-menu-status"])).is_err());
        assert_eq!(
            parse(args(&["--install-explorer-menu"])).unwrap().1,
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
            parse(args(&["--open-folder", text])).unwrap().0,
            Some(directory.canonicalize().unwrap())
        );
        assert!(parse(args(&["--isolated-profile", text]))
            .unwrap()
            .0
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
