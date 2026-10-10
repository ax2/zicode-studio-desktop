//! User opted-in login launch for the windowless automation worker.
//! The startup command must quote installed paths and never retain an AppImage mount path.

use fs2::FileExt;
use std::fs::{self, OpenOptions};
use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Manager;

const ENTRY_NAME: &str = "ZiCode Studio Automation";
const WORKER_ARGUMENT: &str = "--zicode-automation-worker";

pub fn enabled(app: &AppHandle) -> Result<bool, String> {
    require_installed_build()?;
    with_lock(|| platform_enabled(app))
}

pub fn set(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    require_installed_build()?;
    with_lock(|| {
        if enabled {
            if platform::exists()? && !entry_is_ours()? {
                return Err("Background login start entry belongs to another command".into());
            }
            write_entry(app)?;
        } else if entry_is_ours()? {
            remove_entry()?;
        }
        let actual = platform_enabled(app)?;
        if actual != enabled {
            return Err("Background login start did not save the requested state".into());
        }
        Ok(actual)
    })
}

/// Preserve an existing opt-in when an installed executable moves after an update.
pub fn repair_existing(app: &AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    with_lock(|| {
        if platform_enabled(app)? && entry_is_ours()? {
            write_entry(app)?;
        }
        Ok(())
    })
}

fn require_installed_build() -> Result<(), String> {
    if crate::desktop_profile::is_isolated() {
        return Err("Login start is disabled in isolated desktop profiles".into());
    }
    if cfg!(debug_assertions) {
        Err("Background login start is available in installed builds only".into())
    } else {
        Ok(())
    }
}

fn with_lock<T>(action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let path = crate::app_paths::data_root()?.join("automation-login-start.lock");
    let parent = path.parent().ok_or("Login start lock has no parent")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create login start directory: {error}"))?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|error| format!("Cannot open login start lock: {error}"))?;
    lock.lock_exclusive()
        .map_err(|error| format!("Cannot lock login start setting: {error}"))?;
    let result = action();
    drop(lock);
    result
}

fn executable_path(app: &AppHandle) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    let path = match app.env().appimage {
        Some(path) => path,
        None => std::env::current_exe()
            .map_err(|error| format!("Cannot find app executable: {error}"))?,
    };
    #[cfg(not(target_os = "linux"))]
    let path = {
        let _ = app;
        std::env::current_exe().map_err(|error| format!("Cannot find app executable: {error}"))?
    };
    if !path.is_absolute() || !path.is_file() {
        return Err("Login start executable is unavailable".into());
    }
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Login start executable path is not valid UTF-8".into())
}

#[cfg(windows)]
mod platform {
    use super::{executable_path, AppHandle, ENTRY_NAME, WORKER_ARGUMENT};
    use std::path::Path;
    use winreg::enums::RegType::REG_BINARY;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
    use winreg::{RegKey, RegValue};

    const RUN_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
    const APPROVED_KEY: &str =
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

    fn read_run_key() -> Result<Option<RegKey>, String> {
        match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_READ) {
            Ok(key) => Ok(Some(key)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Cannot open Windows login settings: {error}")),
        }
    }

    fn current_command() -> Result<Option<String>, String> {
        let Some(key) = read_run_key()? else {
            return Ok(None);
        };
        match key.get_value(ENTRY_NAME) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("Cannot read Windows login setting: {error}")),
        }
    }

    fn worker_command(value: &str) -> bool {
        let Some(executable) = value.trim().strip_suffix(&format!(" {WORKER_ARGUMENT}")) else {
            return false;
        };
        let executable = executable.trim();
        let executable = executable
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(executable);
        let path = Path::new(executable);
        path.is_absolute()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
    }

    pub(super) fn exists() -> Result<bool, String> {
        Ok(current_command()?.is_some())
    }

    pub(super) fn enabled(_app: &AppHandle) -> Result<bool, String> {
        if !current_command()?.is_some_and(|value| worker_command(&value)) {
            return Ok(false);
        }
        let approved = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(APPROVED_KEY, KEY_READ)
            .ok()
            .and_then(|key| key.get_raw_value(ENTRY_NAME).ok());
        Ok(approved.is_none_or(|value| value.bytes.first() == Some(&2)))
    }

    pub(super) fn ours() -> Result<bool, String> {
        Ok(current_command()?.is_some_and(|value| worker_command(&value)))
    }

    pub(super) fn write(app: &AppHandle) -> Result<(), String> {
        let command = format!("\"{}\" {WORKER_ARGUMENT}", executable_path(app)?);
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(RUN_KEY)
            .map_err(|error| format!("Cannot create Windows login settings: {error}"))?;
        key.set_value(ENTRY_NAME, &command)
            .map_err(|error| format!("Cannot save Windows login setting: {error}"))?;
        if let Ok(key) =
            RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(APPROVED_KEY, KEY_SET_VALUE)
        {
            key.set_raw_value(
                ENTRY_NAME,
                &RegValue {
                    vtype: REG_BINARY,
                    bytes: vec![2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                },
            )
            .map_err(|error| format!("Cannot enable Windows login setting: {error}"))?;
        }
        Ok(())
    }

    pub(super) fn remove() -> Result<(), String> {
        if current_command()?.is_some() {
            let key = RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
                .map_err(|error| {
                    format!("Cannot open Windows login settings for removal: {error}")
                })?;
            key.delete_value(ENTRY_NAME)
                .map_err(|error| format!("Cannot remove Windows login setting: {error}"))?;
        }
        Ok(())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod platform {
    use super::{executable_path, AppHandle, ENTRY_NAME, WORKER_ARGUMENT};
    use std::fs;
    use std::path::PathBuf;

    fn entry_path() -> Result<PathBuf, String> {
        #[cfg(target_os = "linux")]
        let path = std::env::var_os("XDG_CONFIG_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
            .ok_or("Cannot locate Linux configuration directory for login start")?
            .join("autostart")
            .join(format!("{ENTRY_NAME}.desktop"));
        #[cfg(target_os = "macos")]
        let path = dirs::home_dir()
            .ok_or("Cannot locate home directory for login start")?
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{ENTRY_NAME}.plist"));
        Ok(path)
    }

    pub(super) fn exists() -> Result<bool, String> {
        match fs::symlink_metadata(entry_path()?) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("Cannot inspect login entry: {error}")),
        }
    }

    fn worker_entry(contents: &str) -> bool {
        #[cfg(target_os = "linux")]
        {
            let commands: Vec<_> = contents
                .lines()
                .filter_map(|line| line.trim().strip_prefix("Exec="))
                .collect();
            return contents
                .lines()
                .any(|line| line.trim() == "[Desktop Entry]")
                && contents
                    .lines()
                    .any(|line| line.trim() == "Type=Application")
                && contents
                    .lines()
                    .any(|line| line.trim() == format!("Name={ENTRY_NAME}"))
                && commands.len() == 1
                && commands[0].ends_with(&format!(" {WORKER_ARGUMENT}"));
        }
        #[cfg(target_os = "macos")]
        {
            contents.contains("<key>Label</key><string>com.zicode.studio.automation</string>")
                && contents.contains(&format!("<string>{WORKER_ARGUMENT}</string>"))
        }
    }

    #[cfg(target_os = "linux")]
    fn hidden(contents: &str) -> bool {
        contents.lines().any(|line| line.trim() == "Hidden=true")
    }

    pub(super) fn enabled(_app: &AppHandle) -> Result<bool, String> {
        let path = entry_path()?;
        if !path.exists() {
            return Ok(false);
        }
        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("Cannot read login entry: {error}"))?;
        #[cfg(target_os = "linux")]
        {
            return Ok(!hidden(&contents) && worker_entry(&contents));
        }
        #[cfg(target_os = "macos")]
        Ok(worker_entry(&contents))
    }

    pub(super) fn ours() -> Result<bool, String> {
        let path = entry_path()?;
        if !path.exists() {
            return Ok(false);
        }
        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("Cannot read login entry: {error}"))?;
        Ok(worker_entry(&contents))
    }

    pub(super) fn write(app: &AppHandle) -> Result<(), String> {
        let executable = executable_path(app)?;
        #[cfg(target_os = "linux")]
        let contents = format!(
            "[Desktop Entry]\nType=Application\nVersion=1.0\nName={ENTRY_NAME}\nExec={} {WORKER_ARGUMENT}\nStartupNotify=false\nTerminal=false\n",
            linux_exec_argument(&executable)?
        );
        #[cfg(target_os = "macos")]
        let contents = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>Label</key><string>com.zicode.studio.automation</string><key>ProgramArguments</key><array><string>{}</string><string>{WORKER_ARGUMENT}</string></array><key>RunAtLoad</key><true/></dict></plist>\n",
            xml_escape(&executable)
        );
        let path = entry_path()?;
        let parent = path.parent().ok_or("Login entry has no parent")?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create login entry directory: {error}"))?;
        let temporary = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
        fs::write(&temporary, contents)
            .map_err(|error| format!("Cannot write login entry: {error}"))?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("Cannot install login entry: {error}"));
        }
        Ok(())
    }

    pub(super) fn remove() -> Result<(), String> {
        let path = entry_path()?;
        if path.exists() {
            fs::remove_file(path).map_err(|error| format!("Cannot remove login entry: {error}"))?;
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn linux_exec_argument(path: &str) -> Result<String, String> {
        let mut quoted = String::from("\"");
        for character in path.chars() {
            match character {
                '\n' | '\r' => return Err("Login start path contains a line break".into()),
                '\\' => quoted.push_str("\\\\\\\\"),
                '"' => quoted.push_str("\\\\\\\""),
                '$' => quoted.push_str("\\\\$"),
                '`' => quoted.push_str("\\\\`"),
                '%' => quoted.push_str("%%"),
                other => quoted.push(other),
            }
        }
        quoted.push('"');
        Ok(quoted)
    }

    #[cfg(target_os = "macos")]
    fn xml_escape(path: &str) -> String {
        path.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
}

fn platform_enabled(app: &AppHandle) -> Result<bool, String> {
    platform::enabled(app)
}

fn entry_is_ours() -> Result<bool, String> {
    platform::ours()
}

fn write_entry(app: &AppHandle) -> Result<(), String> {
    platform::write(app)
}

fn remove_entry() -> Result<(), String> {
    platform::remove()
}
