use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::{
        Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        Threading::{GetCurrentProcess, GetProcessId, GetProcessTimes},
    },
    UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
};

pub(super) fn library() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let packages = PathBuf::from(local).join("Microsoft/WinGet/Packages");
        if let Ok(entries) = std::fs::read_dir(packages) {
            for entry in entries.flatten() {
                if entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("LibreHardwareMonitor.LibreHardwareMonitor_")
                {
                    candidates.push(entry.path().join("LibreHardwareMonitorLib.dll"));
                }
            }
        }
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(variable) {
            candidates
                .push(PathBuf::from(base).join("LibreHardwareMonitor/LibreHardwareMonitorLib.dll"));
        }
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .and_then(|path| path.canonicalize().ok())
        .map(|path| crate::process_command::working_directory(&path))
}

pub(super) fn driver_available() -> bool {
    use winreg::{
        enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY},
        RegKey,
    };
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO",
            KEY_READ | KEY_WOW64_64KEY,
        )
        .is_ok()
}

fn reader_path() -> Result<PathBuf, String> {
    let root = crate::desktop_profile::root()
        .map(Path::to_path_buf)
        .or_else(|| dirs::data_local_dir().map(|root| root.join("zicode-studio-desktop")))
        .ok_or("Local application storage unavailable")?;
    let directory = root.join("system/runtime");
    std::fs::create_dir_all(&directory).map_err(|_| "Cannot prepare CPU sensor reader")?;
    let directory = directory
        .canonicalize()
        .map_err(|_| "Cannot resolve CPU sensor reader")?;
    let directory = crate::process_command::working_directory(&directory);
    let root = root
        .canonicalize()
        .map_err(|_| "Cannot resolve application storage")?;
    let root = crate::process_command::working_directory(&root);
    if !directory.starts_with(root) {
        return Err("CPU sensor reader directory is outside application storage".into());
    }
    let path = directory.join("zicode-hardware-sensor.exe");
    let bytes = include_bytes!(concat!(env!("OUT_DIR"), "/zicode-hardware-sensor.exe"));
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Invalid CPU sensor reader file".into());
        }
        if std::fs::read(&path).ok().as_deref() == Some(bytes.as_slice()) {
            return Ok(path);
        }
    }
    let temporary = directory.join(format!("sensor-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, bytes).map_err(|_| "Cannot prepare CPU sensor reader")?;
    let result = std::fs::rename(&temporary, &path)
        .map_err(|_| "Close the previous CPU sensor reader before updating it".to_string());
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map(|()| path)
}

// Quote an argv value for ShellExecute's Windows command-line parser, including
// backslashes before quotes and at the closing quote. No shell is involved.
pub(super) fn quote(value: &str) -> String {
    let mut result = String::from("\"");
    let mut slashes = 0;
    for ch in value.chars() {
        if ch == '\\' {
            slashes += 1;
            continue;
        }
        if ch == '"' {
            result.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
        } else {
            result.extend(std::iter::repeat_n('\\', slashes));
        }
        slashes = 0;
        result.push(ch);
    }
    result.extend(std::iter::repeat_n('\\', slashes * 2));
    result.push('"');
    result
}

pub(super) fn launch(library: &Path, pipe: &str) -> Result<u32, String> {
    let reader = reader_path()?;
    let hash = Sha256::digest(
        std::fs::read(library).map_err(|_| "Cannot read the installed sensor library")?,
    );
    let (mut creation, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // Every pointer is to a correctly sized out-parameter; the returned handle
    // belongs to ShellExecute and is closed after obtaining the child identity.
    if unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    } == 0
    {
        return Err("Cannot identify the Studio process".into());
    }
    let started = (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime);
    let parameters = [
        library.to_string_lossy().into_owned(),
        format!("{hash:x}"),
        pipe.into(),
        std::process::id().to_string(),
        started.to_string(),
    ]
    .iter()
    .map(|value| quote(value))
    .collect::<Vec<_>>()
    .join(" ");
    let wide = |value: &str| value.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let file = wide(&reader.to_string_lossy());
    let verb = wide("runas");
    let parameters = wide(&parameters);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: parameters.as_ptr(),
        nShow: 0,
        ..Default::default()
    };
    let initialized =
        unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) } >= 0;
    let success = unsafe { ShellExecuteExW(&mut info) } != 0;
    let error = std::io::Error::last_os_error();
    if initialized {
        unsafe { CoUninitialize() };
    }
    if !success {
        return Err(if error.raw_os_error() == Some(1223) {
            "Temperature permission request was cancelled."
        } else {
            "Could not start CPU temperature monitoring."
        }
        .into());
    }
    let id = unsafe { GetProcessId(info.hProcess) };
    unsafe { CloseHandle(info.hProcess) };
    if id == 0 {
        return Err("Cannot identify the CPU sensor reader".into());
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    #[test]
    fn quotes_paths_and_trailing_slashes_without_a_shell() {
        assert_eq!(
            super::quote(r"C:\Program Files\LibreHardwareMonitorLib.dll"),
            "\"C:\\Program Files\\LibreHardwareMonitorLib.dll\""
        );
        assert_eq!(super::quote("a\\\"b\\"), "\"a\\\\\\\"b\\\\\"");
    }
}
