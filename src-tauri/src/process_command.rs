use std::ffi::OsStr;
use std::process::Command;

/// Preserve canonical identity checks while using ordinary Win32 paths at the
/// process boundary. cmd.exe and PowerShell misinterpret verbatim drive paths.
pub fn working_directory(path: &std::path::Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        use std::path::{Component, PathBuf, Prefix};
        let mut components = path.components();
        if let Some(Component::Prefix(prefix)) = components.next() {
            let mut normal = match prefix.kind() {
                Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:\\", drive as char)),
                Prefix::VerbatimUNC(server, share) => {
                    let mut normal = PathBuf::from(r"\\");
                    normal.push(server);
                    normal.push(share);
                    normal
                }
                _ => return path.to_path_buf(),
            };
            normal.extend(components.filter(|part| !matches!(part, Component::RootDir)));
            return normal;
        }
    }
    path.to_path_buf()
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Create a child process command with the platform defaults required by the
/// desktop application.
///
/// Windows release builds use the GUI subsystem, so spawning a console
/// executable without `CREATE_NO_WINDOW` can open a visible Windows Terminal
/// window. All production subprocesses must be created through this function.
pub fn new_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    configure(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn configure(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn converts_only_verbatim_working_directory_prefixes() {
        use std::path::Path;
        assert_eq!(
            super::working_directory(Path::new(r"\\?\C:\工具 目录\nested")),
            Path::new(r"C:\工具 目录\nested")
        );
        assert_eq!(
            super::working_directory(Path::new(r"\\?\UNC\server\share\nested")),
            Path::new(r"\\server\share\nested")
        );
        assert_eq!(
            super::working_directory(Path::new(r"C:\normal")),
            Path::new(r"C:\normal")
        );
    }
    #[cfg(target_os = "windows")]
    #[test]
    fn create_no_window_flag_matches_windows_api() {
        assert_eq!(super::CREATE_NO_WINDOW, 0x0800_0000);
    }
}
