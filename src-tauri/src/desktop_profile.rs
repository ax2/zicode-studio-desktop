//! Explicit isolated desktop profile for native acceptance and disposable work.
//! This redirects Studio state; it is not an OS sandbox for user-selected tools.

use fs2::FileExt;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const MARKER: &str = "{\"schemaVersion\":1,\"kind\":\"zicode-isolated-desktop\"}\n";
static PROFILE: OnceLock<Profile> = OnceLock::new();

struct Profile {
    root: PathBuf,
    _lock: Option<File>,
}

pub fn root() -> Option<&'static Path> {
    PROFILE.get().map(|profile| profile.root.as_path())
}

pub fn is_isolated() -> bool {
    root().is_some()
}

pub fn owns_lock() -> bool {
    PROFILE.get().is_none_or(|profile| profile._lock.is_some())
}

pub fn pi_discovery_flags() -> &'static [&'static str] {
    if is_isolated()
        || crate::explorer_entry::folder().is_some()
        || crate::explorer_entry::file().is_some()
    {
        &[
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
        ]
    } else {
        &[]
    }
}

/// Keep only OS launch plumbing, never inherited provider keys or proxy settings.
pub fn configure_pi_child(command: &mut std::process::Command) {
    if let Some(root) = root() {
        command.env_clear();
        for name in [
            "PATH",
            "SystemRoot",
            "WINDIR",
            "COMSPEC",
            "PATHEXT",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        let home = root.join("home");
        command
            .env("HOME", &home)
            .env("USERPROFILE", &home)
            .env("APPDATA", home.join("AppData/Roaming"))
            .env("LOCALAPPDATA", home.join("AppData/Local"))
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .env("XDG_DATA_HOME", home.join(".local/share"));
    }
}

pub fn initialize(arguments: impl IntoIterator<Item = OsString>) -> Result<(), String> {
    if let Some(path) = parse(arguments)? {
        let profile = prepare(&path)?;
        PROFILE
            .set(profile)
            .map_err(|_| "Desktop profile already initialized")?;
    }
    Ok(())
}

fn parse(arguments: impl IntoIterator<Item = OsString>) -> Result<Option<PathBuf>, String> {
    let mut arguments = arguments.into_iter();
    let mut profile = None;
    while let Some(argument) = arguments.next() {
        if argument != "--isolated-profile" {
            if argument
                .to_string_lossy()
                .starts_with("--isolated-profile=")
            {
                return Err("Use --isolated-profile followed by an absolute directory".into());
            }
            continue;
        }
        if profile.is_some() {
            return Err("Only one --isolated-profile is allowed".into());
        }
        let path = PathBuf::from(
            arguments
                .next()
                .ok_or("--isolated-profile requires an absolute directory")?,
        );
        if !path.is_absolute() || path.parent().is_none() {
            return Err("--isolated-profile requires an absolute non-root directory".into());
        }
        profile = Some(path);
    }
    Ok(profile)
}

fn require_unlinked(path: &Path) -> Result<(), String> {
    for component in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(component) {
            let linked = metadata.file_type().is_symlink();
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    return Err("Isolated profile paths cannot contain links or junctions".into());
                }
            }
            if linked {
                return Err("Isolated profile paths cannot contain links or junctions".into());
            }
        }
    }
    Ok(())
}

fn prepare(path: &Path) -> Result<Profile, String> {
    require_unlinked(path)?;
    fs::create_dir_all(path).map_err(|error| format!("Cannot create isolated profile: {error}"))?;
    let marker = path.join("profile.json");
    require_unlinked(&marker)?;
    if marker.exists() {
        if fs::metadata(&marker)
            .map_err(|error| error.to_string())?
            .len()
            > 4096
            || fs::read_to_string(&marker).map_err(|error| error.to_string())? != MARKER
        {
            return Err("Isolated profile ownership marker is invalid".into());
        }
    } else {
        if fs::read_dir(path)
            .map_err(|error| error.to_string())?
            .next()
            .is_some()
        {
            return Err("Isolated profile must be empty or owned by Studio".into());
        }
        use std::io::Write;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)
            .map_err(|error| error.to_string())?;
        file.write_all(MARKER.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    for name in ["data", "system", "home", "profile.lock"] {
        require_unlinked(&path.join(name))?;
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path.join("profile.lock"))
        .map_err(|error| error.to_string())?;
    // A second launch must reach the single-instance plugin so its Explorer
    // request can be handed to the lock holder. It may not set up a Host.
    let lock = lock.try_lock_exclusive().ok().map(|_| lock);
    let root = path.canonicalize().map_err(|error| error.to_string())?;
    Ok(Profile { root, _lock: lock })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
            fs::create_dir_all(&parent).unwrap();
            let path = parent
                .canonicalize()
                .unwrap()
                .join(format!("desktop-profile-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            fs::write(path.join("owner.json"), r#"{"purpose":"isolated profile contract test","lifetime":"remove after test child exits"}"#).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../.cache/task-scratch")
                .canonicalize()
                .unwrap();
            assert_eq!(self.0.parent(), Some(parent.as_path()));
            assert!(self
                .0
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("desktop-profile-"));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn isolated_profile_process_contract() {
        // A child process avoids mutating the full test suite's global paths.
        if std::env::var_os("ZICODE_ISOLATED_PROFILE_TEST_CHILD").is_none() {
            let temp = Fixture::new();
            let output = crate::process_command::new_command(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "desktop_profile::tests::isolated_profile_process_contract",
                    "--nocapture",
                ])
                .env("ZICODE_ISOLATED_PROFILE_TEST_CHILD", "1")
                .env("ZICODE_ISOLATED_PROFILE_TEST_ROOT", temp.path())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let temp = PathBuf::from(std::env::var_os("ZICODE_ISOLATED_PROFILE_TEST_ROOT").unwrap());
        let path = temp.join("owned-profile");
        initialize(["--isolated-profile".into(), path.clone().into_os_string()]).unwrap();
        let expected = path.canonicalize().unwrap();
        let executable = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            crate::explorer_entry::forwarded_intent(&[
                executable.clone(),
                "--isolated-profile".into(),
                expected.to_string_lossy().into_owned(),
                "--tools-only".into(),
            ])
            .unwrap(),
            Some(crate::explorer_launch_state::EntryIntent::Tools)
        );
        assert!(
            crate::explorer_entry::forwarded_intent(&[executable, "--tools-only".into()]).is_err()
        );
        assert_eq!(
            crate::app_paths::data_root().unwrap(),
            expected.join("data")
        );
        assert_eq!(
            crate::app_paths::system_root().unwrap(),
            expected.join("system")
        );
        assert!(crate::app_paths::metadata_path()
            .unwrap()
            .starts_with(&expected));
        assert!(crate::app_paths::webview_root()
            .unwrap()
            .starts_with(&expected));
        assert!(crate::app_paths::plugins_root()
            .unwrap()
            .starts_with(&expected));
        let source = temp.join("legacy.sqlite3");
        let destination = expected.join("system/metadata.sqlite3");
        fs::write(&source, "unrelated legacy sentinel").unwrap();
        crate::app_paths::migrate_legacy_metadata(&source, &destination).unwrap();
        assert!(!destination.exists());
        assert!(
            !crate::credential_broker::scene_credential_status("programming", "openai")
                .unwrap()
                .configured
        );
        assert!(
            crate::credential_broker::model_tool_credential("programming", "openai")
                .unwrap()
                .is_none()
        );
        assert!(crate::credential_broker::store_scene_credential(
            "programming",
            "openai",
            "test-only"
        )
        .is_err());
        assert!(
            crate::credential_broker::delete_scene_credential("programming", "openai").is_err()
        );
        let mut command = crate::process_command::new_command("unused-test-program");
        command.env("UNRELATED_SECRET_SENTINEL", "test-only");
        configure_pi_child(&mut command);
        assert!(!command
            .get_envs()
            .any(|(key, _)| key == "UNRELATED_SECRET_SENTINEL"));
        assert!(command
            .get_envs()
            .any(|(key, value)| key == "HOME" && value == Some(expected.join("home").as_os_str())));
        let spec = crate::native_pi_manager::NativeLaunchSpec {
            binary: "unused".into(),
            cwd: expected.clone(),
            session_path: None,
            extensions: vec!["explicit-bundled.mjs".into()],
            pi_version: "test".into(),
            path_env: String::new(),
            environment: Default::default(),
            disable_auto_discovery: false,
        };
        let args = spec.command_description().args;
        for flag in [
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
        ] {
            assert!(args.iter().any(|argument| argument == flag));
        }
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--extension", "explicit-bundled.mjs"]));
    }

    #[test]
    fn explicit_profile_argument_is_required_and_validated() {
        assert_eq!(parse([OsString::from("ordinary")]).unwrap(), None);
        assert!(parse(["--isolated-profile".into()]).is_err());
        assert!(parse(["--isolated-profile=relative".into()]).is_err());
        assert!(parse(["--isolated-profile".into(), "relative".into()]).is_err());
        let path = std::env::temp_dir().join("isolated-profile-parser");
        assert_eq!(
            parse(["--isolated-profile".into(), path.clone().into_os_string()]).unwrap(),
            Some(path.clone())
        );
        assert!(parse([
            "--isolated-profile".into(),
            path.clone().into_os_string(),
            "--isolated-profile".into(),
            path.into_os_string()
        ])
        .is_err());
    }

    #[test]
    fn empty_owned_profile_is_reusable_and_exclusively_locked() {
        let temp = Fixture::new();
        let path = temp.path().join("profile");
        let first = prepare(&path).unwrap();
        assert!(first._lock.is_some());
        let secondary = prepare(&path).unwrap();
        assert!(secondary._lock.is_none());
        drop(secondary);
        drop(first);
        assert!(prepare(&path).unwrap()._lock.is_some());
        fs::write(path.join("profile.json"), "{}").unwrap();
        assert!(prepare(&path).is_err());
    }

    #[test]
    fn existing_unowned_data_is_never_adopted_or_changed() {
        let temp = Fixture::new();
        let unowned = temp.path().join("unowned");
        fs::create_dir(&unowned).unwrap();
        fs::write(unowned.join("user-data"), "retain").unwrap();
        assert!(prepare(&unowned).is_err());
        assert_eq!(
            fs::read_to_string(unowned.join("user-data")).unwrap(),
            "retain"
        );
        assert!(!unowned.join("profile.json").exists());
    }
}
