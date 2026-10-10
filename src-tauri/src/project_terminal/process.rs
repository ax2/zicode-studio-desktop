use portable_pty::CommandBuilder;
use std::path::Path;

#[cfg(unix)]
fn usable_unix_shell(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_absolute()
        && path
            .metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(windows)]
fn windows_shell() -> Result<std::path::PathBuf, String> {
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let root = std::path::PathBuf::from(program_files);
        let candidate = root.join("PowerShell/7/pwsh.exe");
        if let (Ok(root), Ok(candidate)) = (root.canonicalize(), candidate.canonicalize()) {
            if candidate.starts_with(root) && candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path).filter(|directory| directory.is_absolute()) {
            let candidate = directory.join("pwsh.exe");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    let system = std::env::var_os("SystemRoot").ok_or("terminal_shell_unavailable")?;
    Ok(std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe"))
}

pub fn shell(root: &Path) -> Result<(CommandBuilder, String), String> {
    #[cfg(windows)]
    let (path, args) = {
        (
            windows_shell()?,
            // Git Bash and other launchers may pass down the process attribute
            // that ignores CTRL_C_EVENT. Reset it inside this console process;
            // changing the Host's handler would affect unrelated commands.
            vec![
                "-NoLogo",
                "-NoProfile",
                "-NoExit",
                "-Command",
                r#"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ZiTerminalConsole { [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add); }'; if (-not [ZiTerminalConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $false)) { exit 1 }"#,
            ],
        )
    };
    #[cfg(unix)]
    let (path, args) = {
        let path = std::env::var_os("SHELL")
            .map(std::path::PathBuf::from)
            .filter(|p| usable_unix_shell(p))
            .unwrap_or_else(|| "/bin/sh".into());
        let args = match path.file_name().and_then(|s| s.to_str()) {
            Some("bash") => vec!["--noprofile", "--norc", "-i"],
            Some("zsh") => vec!["-f", "-i"],
            Some("fish") => vec!["--no-config", "-i"],
            Some("pwsh") => vec!["-NoLogo", "-NoProfile", "-NoExit"],
            Some("sh" | "dash" | "ash" | "ksh" | "mksh" | "csh" | "tcsh") => vec!["-i"],
            // A PTY already supplies interactive input. Unknown shells may not
            // accept POSIX-style -i, so do not assume their option grammar.
            _ => Vec::new(),
        };
        (path, args)
    };
    if !path.is_absolute() || !path.is_file() {
        return Err("terminal_shell_unavailable".into());
    }
    #[cfg(unix)]
    if !usable_unix_shell(&path) {
        return Err("terminal_shell_unavailable".into());
    }
    let label = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    // PowerShell derives its module search paths from the executable path.
    // A canonical verbatim drive path is mistaken for an UNC location there.
    let mut command = CommandBuilder::new(crate::process_command::working_directory(&path));
    command.args(args);
    command.cwd(crate::process_command::working_directory(root));
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    Ok((command, label))
}

#[cfg(windows)]
pub struct ProcessGuard(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl ProcessGuard {
    pub fn attach(child: &dyn portable_pty::Child) -> Result<Self, String> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("terminal_process_group_failed".into());
            }
            let owner = OwnedHandle::from_raw_handle(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let process = child
                .as_raw_handle()
                .ok_or("terminal_process_unavailable")?;
            if SetInformationJobObject(
                owner.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(owner.as_raw_handle(), process) == 0
            {
                return Err("terminal_process_group_failed".into());
            }
            Ok(Self(owner))
        }
    }
    pub fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}

#[cfg(unix)]
pub struct ProcessGuard(std::sync::atomic::AtomicI32);

#[cfg(unix)]
impl ProcessGuard {
    pub fn attach(child: &dyn portable_pty::Child) -> Result<Self, String> {
        let pid = child.process_id().ok_or("terminal_process_unavailable")? as i32;
        // portable-pty creates a new session before exec.
        if unsafe { libc::getsid(pid) } != pid {
            return Err("terminal_process_group_failed".into());
        }
        Ok(Self(std::sync::atomic::AtomicI32::new(pid)))
    }
    pub fn terminate(&self) {
        let session = self.0.swap(0, std::sync::atomic::Ordering::AcqRel);
        if session == 0 {
            return;
        }
        // Interactive shells put jobs in separate process groups. Recheck session
        // ownership immediately before signalling each process. Deliberately detached
        // processes (a new session) are outside terminal ownership.
        let mut command = crate::process_command::new_command("/bin/ps");
        if let Ok(output) = command.args(["-axo", "pid="]).output() {
            for pid in String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .filter_map(|s| s.parse::<i32>().ok())
            {
                if pid > 1 && pid != session && unsafe { libc::getsid(pid) } == session {
                    unsafe {
                        libc::kill(pid, libc::SIGKILL);
                    }
                }
            }
        }
        unsafe {
            libc::kill(-session, libc::SIGKILL);
        }
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        self.terminate();
    }
}
