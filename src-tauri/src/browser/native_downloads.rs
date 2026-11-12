//! UI-thread-only native downloads. No webpage IPC, HTTP proxy or file execution.
use super::{EngineEvent, BrowserPolicy};
use std::{cell::RefCell, collections::HashMap, path::{Path, PathBuf}, rc::Rc, sync::Arc};
use serde::Serialize;
use webview2_com::{take_pwstr, DownloadStartingEventHandler, StateChangedEventHandler, Microsoft::Web::WebView2::Win32::*};
use windows::core::{BOOL, Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;
#[path = "download_files.rs"]
pub(crate) mod files;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub tab: String,
    pub url: String,
    pub name: String,
    pub state: String,
    pub can_resume: bool,
    pub received: i64,
    pub total: Option<i64>,
    pub path: Option<String>,
    pub partial_path: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}
struct Entry {
    record: Record,
    operation: ICoreWebView2DownloadOperation,
    pending: Option<(ICoreWebView2DownloadStartingEventArgs, ICoreWebView2Deferral)>,
    staging: Option<PathBuf>,
    cancelling: bool,
}
pub struct Downloads {
    entries: RefCell<HashMap<String, Entry>>,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
}
impl Downloads {
    pub fn new(emit: Arc<dyn Fn(EngineEvent) + Send + Sync>) -> Rc<Self> {
        Rc::new(Self { entries: RefCell::new(HashMap::new()), emit })
    }
    fn emit(&self, record: Record) { (self.emit)(EngineEvent::DownloadChanged { download: record }); }
    pub fn install(self: &Rc<Self>, view: &wry::WebView, policy: BrowserPolicy, tab: String) -> windows::core::Result<()> {
        let weak = Rc::downgrade(self);
        let controller = view.controller();
        unsafe { view.webview().cast::<ICoreWebView2_4>()?.add_DownloadStarting(
            &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()); };
                args.SetHandled(true)?;
                args.SetCancel(true)?; // Fails closed, including any setup/deferral error.
                let Some(downloads) = weak.upgrade() else { return Ok(()); };
                let mut visible = BOOL::default(); controller.IsVisible(&mut visible)?;
                let operation = args.DownloadOperation()?;
                let mut raw = PWSTR::null(); operation.Uri(&mut raw)?;
                let url = take_pwstr(raw);
                let permitted = visible.as_bool() && url.len() <= 16384 && url != "about:blank"
                    && policy.permits_download(&url);
                if !permitted || downloads.entries.borrow().values().filter(|e| active(&e.record.state)).count() >= 16 {
                    (downloads.emit)(EngineEvent::NativeDownloadBlocked { tab: tab.clone() });
                    return Ok(());
                }
                // Terminal records are already queued in the persistent store.
                { let mut entries = downloads.entries.borrow_mut();
                  if entries.len() >= 128 {
                    let oldest = entries.values().filter(|e| !active(&e.record.state)).min_by_key(|e| &e.record.created_at).map(|e| e.record.id.clone());
                    if let Some(id) = oldest { entries.remove(&id); }
                  }
                }
                let mut suggested = PWSTR::null(); args.ResultFilePath(&mut suggested)?;
                let mut total = 0; operation.TotalBytesToReceive(&mut total)?;
                let id = uuid::Uuid::new_v4().to_string();
                let record = Record { id: id.clone(), tab: tab.clone(), url,
                    name: files::filename(&take_pwstr(suggested)), state: "waiting".into(), can_resume: false, received: 0,
                    total: (total > 0).then_some(total), path: None, partial_path: None, error: None, created_at: chrono::Utc::now().to_rfc3339() };
                let pending = (args.clone(), args.GetDeferral()?);
                let callback_id = id.clone(); let changed = Rc::downgrade(&downloads);
                let mut token = 0;
                if let Err(error) = operation.add_StateChanged(&StateChangedEventHandler::create(Box::new(move |_, _| {
                    if let Some(downloads) = changed.upgrade() { downloads.update(&callback_id); }
                    Ok(())
                })), &mut token) { pending.1.Complete()?; return Err(error); }
                downloads.entries.borrow_mut().insert(id, Entry { record: record.clone(), operation, pending: Some(pending), staging: None, cancelling: false });
                downloads.emit(record);
                Ok(())
            })), &mut 0) }
    }
    #[allow(dead_code)] // The standalone engine probe has no trusted save/list chrome.
pub fn name(&self, id: &str) -> Result<String, String> {
        let entries = self.entries.borrow(); let entry = entries.get(id).ok_or("Download is no longer available")?;
        if entry.pending.is_none() { return Err("Download is no longer waiting for approval".into()); }
        Ok(entry.record.name.clone())
    }
    #[allow(dead_code)] // The standalone engine probe has no trusted save/list chrome.
pub fn save(&self, id: &str, target: &Path) -> Result<(), String> {
        self.name(id)?;
        let staging = files::prepare(target, id)?;
        let (args, deferral, record) = {
            let mut entries = self.entries.borrow_mut(); let entry = entries.get_mut(id).ok_or("Download is no longer available")?;
            let (args, deferral) = entry.pending.take().ok_or("Download is no longer waiting for approval")?;
            entry.record.state = "downloading".into(); entry.record.path = Some(target.to_string_lossy().into_owned());
            entry.record.name = target.file_name().unwrap_or_default().to_string_lossy().into_owned();
            entry.record.partial_path = Some(staging.to_string_lossy().into_owned());
            entry.staging = Some(staging.clone());
            (args, deferral, entry.record.clone())
        };
        self.emit(record);
        // Complete may synchronously re-enter StateChanged: no RefCell borrow survives.
        let result = unsafe {
            args.SetResultFilePath(&HSTRING::from(dunce::simplified(&staging).as_os_str()))
                .and_then(|_| args.SetCancel(false))
        };
        if result.is_err() { let _ = unsafe { args.SetCancel(true) }; }
        let completion = unsafe { deferral.Complete() };
        if let Err(error) = result.and(completion) {
            let _ = self.cancel(id);
            return Err(error.to_string());
        }
        self.update(id); Ok(())
    }
    #[allow(dead_code)] // The standalone probe has no download controls.
    pub fn set_paused(&self, id: &str, paused: bool) -> Result<(), String> {
        self.update(id);
        let operation = {
            let entries = self.entries.borrow();
            let entry = entries.get(id).ok_or("Download is no longer available")?;
            match (paused, entry.record.state.as_str()) {
                (true, "paused") | (false, "downloading") => return Ok(()),
                (true, "downloading") => entry.operation.clone(),
                (false, "paused") if entry.record.can_resume => entry.operation.clone(),
                (false, "paused") => return Err("This download cannot continue".into()),
                _ => return Err("Download is not ready to pause or continue".into()),
            }
        };
        // Native state-change events may run synchronously inside these calls.
        let result = unsafe { if paused { operation.Pause() } else { operation.Resume() } };
        self.update(id);
        result.map_err(|error| error.to_string())
    }
    fn update(&self, id: &str) {
        let operation = self.entries.borrow().get(id)
            .filter(|entry| entry.pending.is_none() && !entry.cancelling && active(&entry.record.state))
            .map(|entry| entry.operation.clone());
        let Some(operation) = operation else { return; };
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default(); let mut received = 0;
        let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
        if unsafe { operation.State(&mut state).and_then(|_| operation.BytesReceived(&mut received)) }.is_err() { return; }
        if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED && unsafe { operation.InterruptReason(&mut reason) }.is_err() { return; }
        let user_paused = state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED
            && reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED;
        let mut resumable = BOOL::default();
        if user_paused {
            let _ = unsafe { operation.CanResume(&mut resumable) };
        }
        let notification = {
            let mut entries = self.entries.borrow_mut(); let Some(entry) = entries.get_mut(id) else { return; };
            if entry.pending.is_some() || entry.cancelling || !active(&entry.record.state) { return; }
            entry.record.received = received.max(0);
            let can_resume = resumable.as_bool();
            if user_paused {
                if entry.record.state == "paused" && entry.record.can_resume == can_resume { return; }
                entry.record.state = "paused".into();
                entry.record.error = None;
            } else if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
                let result = entry.staging.as_deref().zip(entry.record.path.as_deref()).ok_or("Missing download destination".to_owned())
                    .and_then(|(staging, target)| files::finish(staging, Path::new(target)));
                match result { Ok(()) => { entry.record.state = "completed".into(); entry.staging = None; entry.record.partial_path = None; entry.record.error = None; },
                    Err(error) => { entry.record.state = "failed".into(); entry.record.error = Some(format!("Could not finish saving download: {error}")); } }
            } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                entry.record.state = if reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED { "cancelled" } else { "failed" }.into();
                entry.record.error = (entry.record.state == "failed").then(|| format!("Download interrupted (code {})", reason.0));
            } else if state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS && entry.record.state == "paused" {
                entry.record.state = "downloading".into();
                entry.record.error = None;
            } else { return; }
            entry.record.can_resume = can_resume;
            Some(entry.record.clone())
        };
        if let Some(record) = notification { self.emit(record); }
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        self.update(id);
        let (pending, operation) = {
            let mut entries = self.entries.borrow_mut(); let entry = entries.get_mut(id).ok_or("Download is no longer available")?;
            if !active(&entry.record.state) || entry.cancelling { return Ok(()); }
            entry.cancelling = true;
            (entry.pending.clone(), entry.operation.clone())
        };
        let was_pending = pending.is_some();
        let result = unsafe { if let Some((args, deferral)) = pending {
            let result = args.SetCancel(true); let completion = deferral.Complete(); result.and(completion)
        } else { operation.Cancel() } };
        if !was_pending {
            let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
            if unsafe { operation.State(&mut state) }.is_ok() && state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
                if let Some(entry) = self.entries.borrow_mut().get_mut(id) { entry.cancelling = false; }
                self.update(id); return Ok(());
            }
        }
        let record = {
            let mut entries = self.entries.borrow_mut(); let entry = entries.get_mut(id).ok_or("Download is no longer available")?;
            entry.cancelling = false;
            match &result {
                Ok(()) => {
                    entry.pending = None; entry.record.state = "cancelled".into(); entry.record.can_resume = false; entry.record.error = None;
                    if let Some(path) = &entry.staging {
                        match std::fs::remove_file(path) {
                            Ok(()) => { entry.staging = None; entry.record.partial_path = None; },
                            Err(error) if error.kind() == std::io::ErrorKind::NotFound => { entry.staging = None; entry.record.partial_path = None; },
                            Err(_) => entry.record.error = Some("Download stopped; its partial file remains at the displayed location".into()),
                        }
                    }
                },
                Err(error) => entry.record.error = Some(format!("Could not cancel download: {error}")),
            }
            entry.record.clone()
        };
        self.emit(record); result.map_err(|e| e.to_string())
    }
    pub fn cancel_tab(&self, tab: &str) {
        let ids: Vec<_> = self.entries.borrow().values().filter(|e| e.record.tab == tab && active(&e.record.state)).map(|e| e.record.id.clone()).collect();
        for id in ids { let _ = self.cancel(&id); }
    }
    #[allow(dead_code)] // The standalone engine probe has no trusted save/list chrome.
pub fn list(&self) -> Vec<Record> {
        let ids: Vec<_> = self.entries.borrow().keys().cloned().collect();
        for id in ids { self.update(&id); }
        self.entries.borrow().values().map(|e| e.record.clone()).collect()
    }
    pub fn cancel_all(&self) {
        let ids: Vec<_> = self.entries.borrow().keys().cloned().collect();
        for id in ids { let _ = self.cancel(&id); }
    }
}
impl Drop for Downloads {
    fn drop(&mut self) {
        self.cancel_all();
    }
}
pub fn active(state: &str) -> bool { matches!(state, "waiting" | "downloading" | "paused") }
