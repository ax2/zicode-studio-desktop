use std::ffi::OsStr;
use std::process::Command;

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
    #[cfg(target_os = "windows")]
    #[test]
    fn create_no_window_flag_matches_windows_api() {
        assert_eq!(super::CREATE_NO_WINDOW, 0x0800_0000);
    }
}
