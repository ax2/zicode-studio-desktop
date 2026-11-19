//! Hand a checked NSIS installer to an independent Windows process before Studio exits.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    path::Path,
    process::Stdio,
    sync::mpsc,
    time::Duration,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Handoff<'a> {
    pid: u32,
    executable: &'a Path,
    installer: &'a Path,
    expected_sha256: &'a str,
    version: &'a str,
    updates_dir: &'a Path,
    arguments: Vec<String>,
}

pub(crate) fn start(
    installer: &Path,
    expected_sha256: &str,
    expected_version: &str,
    updates_dir: &Path,
) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut arguments = Vec::new();
    if crate::desktop_profile::requires_explicit_argument() {
        let root = crate::desktop_profile::root().ok_or("Missing active isolated profile")?;
        arguments.extend(["--isolated-profile".to_owned(), root.display().to_string()]);
        if let Some(name) = crate::desktop_profile::test_profile_name() {
            arguments.extend(["--test-profile".to_owned(), name.to_owned()]);
        }
    }
    if std::env::args_os().any(|arg| arg == "--tools-only") {
        arguments.push("--tools-only".to_owned());
    }
    let data = Handoff {
        pid: std::process::id(),
        executable: &executable,
        installer,
        expected_sha256,
        version: expected_version,
        updates_dir,
        arguments,
    };
    let json = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let script = include_str!("desktop_update_handoff.ps1");
    let encoded: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let system = std::env::var_os("SystemRoot").ok_or("Missing Windows system root")?;
    let mut child = crate::process_command::new_command(
        Path::new(&system).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    )
    .args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
    ])
    .arg(STANDARD.encode(encoded))
    .env("ZICODE_UPDATE_HANDOFF", STANDARD.encode(json))
    .current_dir(updates_dir)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| format!("Could not start the Windows update helper: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Missing update helper handshake")?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut first = String::new();
        let _ = BufReader::new(stdout).read_line(&mut first);
        let _ = send.send(first.trim().to_owned());
    });
    match receive.recv_timeout(Duration::from_secs(45)) {
        Ok(line) if line == "ready" => Ok(()),
        status => {
            let _ = child.kill();
            let _ = child.wait();
            Err(match status {
                Ok(message) if !message.is_empty() => message,
                _ => "Windows update helper did not become ready".to_owned(),
            })
        }
    }
}
