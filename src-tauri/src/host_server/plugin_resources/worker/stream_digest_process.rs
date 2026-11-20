//! Use the existing resource Worker reservations, process tree, and authority watcher.
use super::*;
use std::process::{ChildStdin, ExitStatus};
use std::sync::atomic::AtomicBool;

pub(in crate::host_server::plugin_resources) fn run_native_digest_stream<T: Send + 'static>(
    state: &HostState,
    cancelled: &AtomicBool,
    timeout: Duration,
    authorized: impl Fn() -> bool + Sync,
    write: impl FnOnce(&mut ChildStdin) -> Result<T, worker_process::Error> + Send + 'static,
) -> Result<(ExitStatus, Vec<u8>, T), ApiError> {
    let workers = &state.plugin_resource_workers;
    let _slot = workers
        .slots
        .try_acquire()
        .map_err(|_| rejected("resource_worker_busy"))?;
    let _shared = workers
        .image_profile_slots
        .try_acquire()
        .map_err(|_| rejected("resource_worker_busy"))?;
    let _plugin = workers
        .image_profile_plugin_slots
        .try_acquire_with_limit(crate::plugin_resource_execution::file_digest::PLUGIN, 1)
        .map_err(rejected)?;
    let executable =
        std::env::current_exe().map_err(|_| rejected("resource_worker_unavailable"))?;
    #[cfg(test)]
    let executable = workers
        .executable
        .lock()
        .unwrap()
        .clone()
        .unwrap_or(executable);
    let mut command = crate::process_command::new_command(executable);
    command
        .arg("--zicode-plugin-worker")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(test)]
    let observer = workers.observer.lock().unwrap().clone();
    #[cfg(not(test))]
    let observer: Option<Observer> = None;
    let authorization_lost = AtomicBool::new(false);
    let observer = observer
        .as_deref()
        .map(|observer| observer as &dyn Fn(&'static str, u32));
    let result = lifecycle::watch(
        cancelled,
        authorized,
        || authorization_lost.store(true, Ordering::Release),
        || {
            // A 64-row digest report fits without granting the ordinary output frame limit.
            worker_process::run_with_writer(
                command,
                timeout,
                64 * 1024,
                Some(cancelled),
                observer,
                write,
            )
        },
    );
    if authorization_lost.load(Ordering::Acquire) {
        return Err(rejected("resource_authorization_changed"));
    }
    result.map_err(|error| rejected(error.code))
}
