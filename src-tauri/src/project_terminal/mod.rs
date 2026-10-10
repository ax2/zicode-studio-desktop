//! Host-owned interactive PTYs. Input/output are never written to application storage.
#[cfg(test)]
mod contract_tests;
#[cfg(windows)]
mod handshake;
mod output;
mod process;
pub mod protocol;
#[cfg(test)]
mod tests;

use portable_pty::{native_pty_system, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::VecDeque,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tokio_util::task::TaskTracker;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_intent_id: Option<String>,
    pub workspace_id: String,
    pub directory: String,
    pub shell: String,
    pub python_environment: Option<String>,
    pub status: String,
    pub cols: u16,
    pub rows: u16,
    pub exit_code: Option<u32>,
    pub output_closed: bool,
    pub output_end: u64,
}

struct State {
    info: Info,
    output: output::Output,
}
enum Control {
    Input(Vec<u8>, Option<mpsc::SyncSender<Result<(), String>>>),
    Resize(PtySize),
}
struct Session {
    root: PathBuf,
    workspace: String,
    state: Mutex<State>,
    stop: AtomicBool,
    control: mpsc::SyncSender<Control>,
}
#[derive(Default)]
struct Inner {
    sessions: VecDeque<Arc<Session>>,
    recent_open_intents: VecDeque<String>,
    closed: bool,
}
#[derive(Default)]
pub struct TerminalManager {
    inner: Mutex<Inner>,
    tasks: TaskTracker,
}

pub fn size(cols: u64, rows: u64) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(2..=200).contains(&rows) {
        return Err("terminal_size_invalid".into());
    }
    Ok(PtySize {
        cols: cols as u16,
        rows: rows as u16,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn canonical(root: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "terminal_directory_unavailable")?;
    if !root.is_dir() {
        return Err("terminal_directory_unavailable".into());
    }
    Ok(root)
}

impl TerminalManager {
    #[cfg(test)]
    pub fn open(&self, root: &Path, workspace: &str, cols: u64, rows: u64) -> Result<Info, String> {
        self.open_with_environment(root, workspace, cols, rows, &Default::default())
    }
    #[cfg(test)]
    pub fn open_with_environment(
        &self,
        root: &Path,
        workspace: &str,
        cols: u64,
        rows: u64,
        environment: &crate::project_environment::Environment,
    ) -> Result<Info, String> {
        self.open_in(root, workspace, "", (cols, rows), environment, None)
    }
    pub fn open_in(
        &self,
        root: &Path,
        workspace: &str,
        directory: &str,
        dimensions: (u64, u64),
        environment: &crate::project_environment::Environment,
        open_intent_id: Option<&str>,
    ) -> Result<Info, String> {
        let root = canonical(root)?;
        let size = size(dimensions.0, dimensions.1)?;
        let mut inner = self.inner.lock().expect("terminal manager poisoned");
        if inner.closed {
            return Err("terminal_host_closed".into());
        }
        if let Some(intent) = open_intent_id {
            if let Some(existing) = inner.sessions.iter().find(|session| {
                session.state.lock().unwrap().info.open_intent_id.as_deref() == Some(intent)
            }) {
                if existing.root != root
                    || existing.workspace != workspace
                    || existing.state.lock().unwrap().info.directory != directory
                {
                    return Err("terminal_open_intent_conflict".into());
                }
                return Ok(existing.state.lock().unwrap().info.clone());
            }
            if inner.recent_open_intents.iter().any(|used| used == intent) {
                return Err("terminal_open_intent_expired".into());
            }
        }
        let selected = crate::project_tasks::directories::resolve(&root, directory)?;
        let (mut command, shell) = process::shell(&selected)?;
        let python_environment =
            environment.configure_terminal_in(&mut command, &selected, &root)?;
        let active = |session: &&Arc<Session>| {
            let state = session.state.lock().unwrap();
            matches!(state.info.status.as_str(), "running" | "stopping")
                || !state.info.output_closed
        };
        if inner.sessions.iter().filter(active).count() >= 8
            || inner
                .sessions
                .iter()
                .filter(active)
                .filter(|s| s.workspace == workspace && s.root == root)
                .count()
                >= 2
        {
            return Err("terminal_limit_reached".into());
        }
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|_| "terminal_open_failed")?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|_| "terminal_open_failed")?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|_| "terminal_open_failed")?;
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|_| "terminal_shell_unavailable")?;
        let guard = match process::ProcessGuard::attach(child.as_ref()) {
            Ok(guard) => guard,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        // No input is exposed until the no-profile shell has joined its process guard.
        drop(pair.slave);
        let (tx, rx) = mpsc::sync_channel(32);
        let info = Info {
            id: uuid::Uuid::new_v4().to_string(),
            open_intent_id: open_intent_id.map(str::to_owned),
            workspace_id: workspace.into(),
            directory: directory.into(),
            shell,
            python_environment,
            status: "running".into(),
            cols: size.cols,
            rows: size.rows,
            exit_code: None,
            output_closed: false,
            output_end: 0,
        };
        let session = Arc::new(Session {
            root,
            workspace: workspace.into(),
            state: Mutex::new(State {
                info: info.clone(),
                output: Default::default(),
            }),
            stop: AtomicBool::new(false),
            control: tx,
        });
        // Retain closed sessions for reconnects, with an overall memory ceiling.
        while inner.sessions.len() >= 16 {
            if let Some(index) = inner.sessions.iter().position(|s| {
                s.state.lock().unwrap().info.output_closed && s.stop.load(Ordering::Acquire)
            }) {
                inner.sessions.remove(index);
            } else {
                let _ = child.kill();
                let _ = child.wait();
                return Err("terminal_limit_reached".into());
            }
        }
        inner.sessions.push_back(session.clone());
        if let Some(intent) = open_intent_id {
            inner.recent_open_intents.push_back(intent.to_owned());
            if inner.recent_open_intents.len() > 512 {
                inner.recent_open_intents.pop_front();
            }
        }
        let master = Arc::new(Mutex::new(Some(pair.master)));
        let output_session = session.clone();
        self.tasks
            .spawn_blocking(move || capture(reader, &output_session));
        let control_session = session.clone();
        let control_master = master.clone();
        self.tasks
            .spawn_blocking(move || controls(writer, rx, &control_session, control_master));
        self.tasks.spawn_blocking(move || {
            let result = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Ok(status),
                    Err(error) => break Err(error),
                    Ok(None) => {}
                }
                if session.stop.load(Ordering::Acquire) {
                    guard.terminate();
                    break child.wait();
                }
                std::thread::sleep(Duration::from_millis(20));
            };
            let stopped = session.stop.swap(true, Ordering::AcqRel);
            guard.terminate();
            // Closing ConPTY wakes the independent reader and any blocked input writer.
            drop(master.lock().unwrap().take());
            let mut state = session.state.lock().unwrap();
            if state.info.status != "failed" {
                state.info.status = if stopped {
                    "closed"
                } else if result.is_ok() {
                    "exited"
                } else {
                    "failed"
                }
                .into();
            }
            state.info.exit_code = result.ok().map(|status| status.exit_code());
        });
        Ok(info)
    }

    fn session(&self, root: &Path, workspace: &str, id: &str) -> Result<Arc<Session>, String> {
        let root = canonical(root)?;
        self.inner
            .lock()
            .unwrap()
            .sessions
            .iter()
            .find(|s| {
                s.root == root && s.workspace == workspace && s.state.lock().unwrap().info.id == id
            })
            .cloned()
            .ok_or_else(|| "terminal_not_found".into())
    }
    pub fn list(&self, root: &Path, workspace: &str) -> Result<Vec<Info>, String> {
        let root = canonical(root)?;
        Ok(self
            .inner
            .lock()
            .unwrap()
            .sessions
            .iter()
            .filter(|s| s.root == root && s.workspace == workspace)
            .map(|s| s.state.lock().unwrap().info.clone())
            .collect())
    }
    pub fn read(
        &self,
        root: &Path,
        workspace: &str,
        id: &str,
        offset: u64,
    ) -> Result<(Info, output::Chunk), String> {
        let session = self.session(root, workspace, id)?;
        let state = session.state.lock().unwrap();
        Ok((state.info.clone(), state.output.read(offset)?))
    }
    fn send(&self, root: &Path, workspace: &str, id: &str, control: Control) -> Result<(), String> {
        let session = self.session(root, workspace, id)?;
        if session.stop.load(Ordering::Acquire) {
            return Err("terminal_closed".into());
        }
        session
            .control
            .try_send(control)
            .map_err(|_| "terminal_input_busy".into())
    }
    pub fn input(
        &self,
        root: &Path,
        workspace: &str,
        id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), String> {
        if bytes.is_empty() || bytes.len() > 4096 {
            return Err("terminal_input_invalid".into());
        }
        let (done, written) = mpsc::sync_channel(1);
        self.send(root, workspace, id, Control::Input(bytes, Some(done)))?;
        written
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "terminal_input_unconfirmed".to_owned())?
    }
    pub fn resize(
        &self,
        root: &Path,
        workspace: &str,
        id: &str,
        cols: u64,
        rows: u64,
    ) -> Result<(), String> {
        self.send(root, workspace, id, Control::Resize(size(cols, rows)?))
    }
    pub fn close(&self, root: &Path, workspace: &str, id: &str) -> Result<(), String> {
        let session = self.session(root, workspace, id)?;
        request_stop(&session);
        Ok(())
    }
    pub fn stop_all(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.closed = true;
        for session in &inner.sessions {
            request_stop(session);
        }
        self.tasks.close();
    }
    pub fn completion_tracker(&self) -> TaskTracker {
        self.tasks.clone()
    }
}
impl Drop for TerminalManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn request_stop(session: &Session) {
    if !session.stop.swap(true, Ordering::AcqRel) {
        session.state.lock().unwrap().info.status = "stopping".into();
    }
}
fn capture(mut reader: Box<dyn Read + Send>, session: &Session) {
    let mut bytes = [0; 8192];
    #[cfg(windows)]
    let mut handshake = handshake::CursorHandshake::default();
    loop {
        let length = match reader.read(&mut bytes) {
            Ok(length) => length,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => {
                #[cfg(unix)]
                let normal_eof = error.raw_os_error() == Some(libc::EIO);
                #[cfg(not(unix))]
                let normal_eof = error.kind() == std::io::ErrorKind::BrokenPipe;
                if !normal_eof && !session.stop.load(Ordering::Acquire) {
                    session.state.lock().unwrap().info.status = "failed".into();
                    session.stop.store(true, Ordering::Release);
                }
                break;
            }
        };
        if length == 0 {
            break;
        }
        #[cfg(windows)]
        let filtered = {
            let (filtered, answer) = handshake.filter(&bytes[..length]);
            if answer
                && session
                    .control
                    .try_send(Control::Input(b"\x1b[1;1R".to_vec(), None))
                    .is_err()
            {
                let mut state = session.state.lock().unwrap();
                if !session.stop.load(Ordering::Acquire) {
                    state.info.status = "failed".into();
                    session.stop.store(true, Ordering::Release);
                }
            }
            filtered
        };
        #[cfg(windows)]
        let chunk = filtered.as_slice();
        #[cfg(not(windows))]
        let chunk = &bytes[..length];
        let mut state = session.state.lock().unwrap();
        state.output.push(chunk);
        state.info.output_end = state.output.end();
    }
    session.state.lock().unwrap().info.output_closed = true;
}
type SharedMaster = Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>;
fn controls(
    mut writer: Box<dyn Write + Send>,
    rx: mpsc::Receiver<Control>,
    session: &Session,
    master: SharedMaster,
) {
    while !session.stop.load(Ordering::Acquire) {
        let control = match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(control) => control,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        };
        let result = match control {
            Control::Input(bytes, done) => {
                let result = writer.write_all(&bytes).and_then(|_| writer.flush());
                if let Some(done) = done {
                    let _ = done.send(
                        result
                            .as_ref()
                            .map(|_| ())
                            .map_err(|_| "terminal_input_failed".to_owned()),
                    );
                }
                result
            }
            Control::Resize(size) => {
                let master = master.lock().unwrap();
                let result = master
                    .as_ref()
                    .ok_or_else(|| std::io::Error::other("closed"))
                    .and_then(|master| {
                        master
                            .resize(size)
                            .map_err(|_| std::io::Error::other("resize failed"))
                    });
                if result.is_ok() {
                    let mut state = session.state.lock().unwrap();
                    state.info.cols = size.cols;
                    state.info.rows = size.rows;
                }
                result
            }
        };
        if result.is_err() {
            if !session.stop.load(Ordering::Acquire) {
                session.state.lock().unwrap().info.status = "failed".into();
            }
            session.stop.store(true, Ordering::Release);
            break;
        }
    }
}
