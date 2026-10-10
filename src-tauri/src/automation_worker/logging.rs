//! Bounded diagnostics for the GUI-subsystem worker, which may have no stderr.

use log::{LevelFilter, Log, Metadata, Record};
use std::fmt::Write as FmtWrite;
use std::fs::{self, File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_MESSAGE_BYTES: usize = 4096;
static LOGGER: OnceLock<WorkerLogger> = OnceLock::new();

struct WorkerLogger {
    file: Mutex<File>,
}

#[derive(Default)]
struct CappedMessage(String);

impl std::fmt::Write for CappedMessage {
    fn write_str(&mut self, value: &str) -> std::fmt::Result {
        for character in value.chars() {
            if self.0.len() + character.len_utf8() > MAX_MESSAGE_BYTES {
                break;
            }
            self.0.push(character);
        }
        Ok(())
    }
}

impl Log for WorkerLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let Ok(mut file) = self.file.lock() else {
            return;
        };
        if file
            .metadata()
            .is_ok_and(|metadata| metadata.len() >= MAX_BYTES)
        {
            let _ = file.set_len(0);
            let _ = file.seek(SeekFrom::Start(0));
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|time| time.as_secs())
            .unwrap_or_default();
        let mut message = CappedMessage::default();
        let _ = write!(message, "{}", record.args());
        let _ = writeln!(file, "{now} {} {}", record.level(), message.0);
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

pub(super) fn install() -> Result<(), String> {
    let root = crate::app_paths::logs_root()?;
    fs::create_dir_all(&root).map_err(|_| "Cannot create automation log directory")?;
    let path = root.join("automation-worker.log");
    if fs::symlink_metadata(&path)
        .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
    {
        return Err("Automation log path is not a regular file".into());
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|_| "Cannot open automation worker log")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| "Cannot restrict automation worker log")?;
    }
    LOGGER
        .set(WorkerLogger {
            file: Mutex::new(file),
        })
        .map_err(|_| "Automation worker logger is already initialized")?;
    log::set_logger(LOGGER.get().expect("worker logger initialized"))
        .map_err(|_| "Automation worker logger is unavailable")?;
    log::set_max_level(LevelFilter::Info);
    Ok(())
}
