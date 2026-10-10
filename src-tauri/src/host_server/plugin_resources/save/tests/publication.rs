use super::*;
use std::sync::{mpsc, OnceLock};
type Gate = (String, mpsc::SyncSender<()>, mpsc::Receiver<()>);
static GATE: OnceLock<Mutex<Option<Gate>>> = OnceLock::new();
pub(in crate::host_server::plugin_resources) fn observe(runtime: &str) {
    let gate = {
        let mut gate = GATE.get_or_init(|| Mutex::new(None)).lock().unwrap();
        if gate.as_ref().is_some_and(|(id, _, _)| id == runtime) { gate.take() } else { None }
    };
    if let Some((_, reached, resume)) = gate { reached.send(()).unwrap(); resume.recv_timeout(Duration::from_secs(10)).unwrap(); }
}
pub(super) fn gate(runtime: &str) -> (mpsc::Receiver<()>, mpsc::SyncSender<()>) {
    let (reached_tx, reached_rx) = mpsc::sync_channel(1); let (resume_tx, resume_rx) = mpsc::sync_channel(1);
    let mut gate = GATE.get_or_init(|| Mutex::new(None)).lock().unwrap(); assert!(gate.is_none());
    *gate = Some((runtime.into(), reached_tx, resume_rx)); (reached_rx, resume_tx)
}
