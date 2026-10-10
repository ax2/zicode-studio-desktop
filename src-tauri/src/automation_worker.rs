//! Explicit no-window automation entry point. A desktop launcher can later
//! supervise this process without tying scheduled work to a WebView lifetime.

use crate::host_server::HostServer;
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::pi_launch::PiLaunchResolver;
use crate::remote_auth::RemoteAuth;
use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

mod control;
mod launcher;
mod logging;
mod resume;

pub struct UpdateLease {
    _lock: control::UpdateLock,
    was_running: bool,
}

impl UpdateLease {
    pub fn was_running(&self) -> bool {
        self.was_running
    }
}

pub fn status() -> Result<&'static str, String> {
    control::status()
}

pub fn start(public_dir: &Path) -> Result<&'static str, String> {
    if crate::desktop_profile::is_isolated() {
        return Err("Background workers are disabled in isolated desktop profiles".into());
    }
    launcher::start(public_dir)
}

pub fn request_stop() -> Result<(), String> {
    control::request_stop()?;
    log::info!("[automation-worker] stop request sent");
    Ok(())
}

pub fn request_stop_explicit() -> Result<(), String> {
    resume::clear()?;
    request_stop()
}

pub fn request_stop_cli() -> Result<(), String> {
    logging::install()?;
    request_stop_explicit()
}

/// Retry a worker that was running before an interrupted or completed update.
pub fn resume_after_update(public_dir: &Path) -> Result<bool, String> {
    if !resume::pending()? {
        return Ok(false);
    }
    start(public_dir)?;
    for _ in 0..50 {
        if status()? == "running" {
            resume::clear()?;
            return Ok(true);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("Automation worker did not resume after the update".into())
}

/// Reserve the installed executable for an update across desktop processes.
pub async fn stop_for_update() -> Result<UpdateLease, String> {
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_secs(20);
    let mut was_running = false;
    loop {
        let status = control::status()?;
        if status == "running" {
            was_running = true;
        }
        if let Some(lease) = control::try_acquire_update_lock()? {
            let locked_status = control::status()?;
            if locked_status == "stopped" {
                if was_running {
                    resume::mark()?;
                }
                return Ok(UpdateLease {
                    _lock: lease,
                    was_running,
                });
            }
            if locked_status == "running" {
                was_running = true;
            }
            drop(lease);
        }
        match status {
            "running" => {
                if let Err(error) = request_stop() {
                    if control::status()? != "stopped" {
                        return Err(error);
                    }
                }
            }
            "stopped" | "stopping" => {}
            _ => return Err("Unknown automation worker state".into()),
        }
        if Instant::now() >= deadline {
            return Err("Automation worker or another update still holds the update lock".into());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

pub fn run(arguments: &[OsString]) -> Result<(), String> {
    logging::install()?;
    if let Err(error) = fix_path_env::fix() {
        log::warn!("[automation-worker] could not refresh login PATH: {error}");
    }
    let worker = control::WorkerInstance::acquire()?;
    let static_dir = parse_public_dir(arguments)?;
    PiLaunchResolver::new(static_dir.clone()).ensure_bundled_runtime()?;
    let metadata_path = crate::app_paths::metadata_path()?;
    if !metadata_path.is_file() {
        return Err("Automation worker requires an initialized workspace registry".into());
    }
    let metadata = Arc::new(Mutex::new(MetadataStore::open(&metadata_path)?));
    let workspaces = metadata
        .lock()
        .map_err(|_| "Workspace registry is unavailable".to_string())?
        .list_workspaces()?;
    let roots = registered_roots(workspaces);
    let auth = Arc::new(Mutex::new(RemoteAuth::new(metadata)));
    let runtimes = NativePiManager::new(256);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Cannot start automation runtime: {error}"))?;
    runtime.block_on(async {
        let host =
            HostServer::start_automation_worker(static_dir, runtimes.clone(), auth, roots).await?;
        log::info!("[automation-worker] started on {}", host.origin());
        let signal = wait_for_shutdown_signal(&worker).await;
        log::info!("[automation-worker] shutdown requested");
        host.request_shutdown();
        let drained = host.wait_for_shutdown().await;
        runtimes.stop_all();
        log::info!("[automation-worker] stopped");
        signal?;
        drained
    })
}

fn parse_public_dir(arguments: &[OsString]) -> Result<PathBuf, String> {
    let public = match arguments {
        [] => {
            let context = crate::application_context::create();
            crate::static_dir_for_resource(
                tauri::utils::platform::resource_dir(
                    context.package_info(),
                    &tauri::utils::Env::default(),
                )
                .ok(),
            )
        }
        [flag, path] if flag == OsStr::new("--public-dir") => PathBuf::from(path.as_os_str()),
        _ => {
            return Err("Usage: --zicode-automation-worker [--public-dir <absolute-path>]".into());
        }
    };
    if !public.is_absolute() {
        return Err("Automation worker public directory must be absolute".into());
    }
    let public = public
        .canonicalize()
        .map_err(|error| format!("Cannot resolve automation resources: {error}"))?;
    if !public.join("index.html").is_file() {
        return Err("Automation worker public directory is incomplete".into());
    }
    Ok(public)
}

fn registered_roots(workspaces: Vec<(String, String)>) -> HashMap<String, PathBuf> {
    workspaces
        .into_iter()
        .filter_map(|(id, path)| {
            let root = PathBuf::from(path).canonicalize().ok()?;
            root.is_dir().then_some((id, root))
        })
        .collect()
}

async fn wait_for_shutdown_signal(worker: &control::WorkerInstance) -> Result<(), String> {
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let signal = wait_for_os_signal();
    tokio::pin!(signal);
    loop {
        tokio::select! {
            result = &mut signal => return result,
            _ = ticker.tick() => {
                if worker.stop_requested()? {
                    return Ok(());
                }
            }
        }
    }
}

async fn wait_for_os_signal() -> Result<(), String> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(|error| format!("Cannot watch worker termination: {error}"))?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.map_err(|error| format!("Cannot watch worker interrupt: {error}")),
            _ = terminate.recv() => Ok(()),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .map_err(|error| format!("Cannot watch worker interrupt: {error}"))
    }
}
