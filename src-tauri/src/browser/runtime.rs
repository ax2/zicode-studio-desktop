//! Main-thread ownership. Webpages never select the parent window or profile.
use super::{
    engine::{Bounds, NativeBrowserEngine},
    policy::BrowserPolicy,
    Request, Viewport,
};
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager, WebviewWindow};
struct WindowBrowser {
    engine: NativeBrowserEngine,
    tabs: Vec<String>,
}
thread_local! { static WINDOWS: super::lifecycle::WindowRegistry<WindowBrowser> = super::lifecycle::WindowRegistry::default(); }
thread_local! { static REVISIONS: RefCell<HashMap<String,u64>> = RefCell::new(HashMap::new()); }
fn accept_revision(owner: &str, next: u64) -> Result<(), String> {
    REVISIONS.with(|slot| {
        let mut revisions = slot.borrow_mut();
        let previous = revisions.entry(owner.to_owned()).or_default();
        if next <= *previous {
            return Err("Stale browser surface request".into());
        }
        *previous = next;
        Ok(())
    })
}
fn bounds(window: &WebviewWindow, value: Viewport) -> Result<Bounds, String> {
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    if ![value.x, value.y, value.width, value.height]
        .iter()
        .all(|v| v.is_finite())
        || value.x < 0.0
        || value.y < 0.0
        || value.width < 1.0
        || value.height < 1.0
        || value.x + value.width > size.width + 1.0
        || value.y + value.height > size.height + 1.0
    {
        return Err("Browser viewport must fit inside its owner window".into());
    }
    Ok(Bounds {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
    })
}
// Focus only the visible native tab owned by this trusted Studio window.
fn focus(window: &WebviewWindow, engine: &NativeBrowserEngine, tab: &str, page: bool) -> Result<(), String> {
    use wry::WebViewExtWindows;
    let view = engine.view(tab)?;
    let mut visible = windows::core::BOOL::default();
    unsafe { view.controller().IsVisible(&mut visible) }.map_err(|e| e.to_string())?;
    if !visible.as_bool() { return Err("Browser tab is no longer active".into()); }
    if page { view.focus().map_err(|e| e.to_string()) }
    else { let chrome: &tauri::Webview = window.as_ref(); chrome.set_focus().map_err(|e| e.to_string()) }
}
pub(super) fn execute(
    window: &WebviewWindow,
    profile: Option<PathBuf>,
    request: Request,
) -> Result<Value, String> {
    if let Request::Fullscreen { enabled } = request { return super::window_controls::fullscreen(window, enabled); }
    WINDOWS.with(|slot| slot.with_mut(|windows| {
        if matches!(&request, Request::Status) {
            let revision=REVISIONS.with(|values|values.borrow().get(window.label()).copied().unwrap_or(0));
            let tabs=if let Some(browser)=windows.get(window.label()) {
                browser.tabs.iter().map(|id| {
                    use wry::WebViewExtWindows;
                    let view = browser.engine.view(id)?;
                    let mut visible = windows::core::BOOL::default();
                    unsafe { view.controller().IsVisible(&mut visible) }.map_err(|e|e.to_string())?;
                    let mut title = windows::core::PWSTR::null();
                    let title_result = unsafe { view.webview().DocumentTitle(&mut title) };
                    let title = webview2_com::take_pwstr(title).chars().take(512).collect::<String>();
                    title_result.map_err(|error| error.to_string())?;
                    let history = super::windows_policy::history_state(&view.webview()).map_err(|e|e.to_string())?;
                    Ok(json!({"id":id,"history":history,"title":title,"url":view.url().map_err(|e|e.to_string())?,"visible":visible.as_bool(),"favicon":browser.engine.favicon(id),"settings":super::engine::page_controls::read(view)?}))
                }).collect::<Result<Vec<_>,String>>()?
            } else {Vec::new()};
            return Ok(json!({"surfaceRevision":revision,"tabs":tabs}));
        }
        if let Request::Create {
            url,
            bounds: viewport,
            tab_id, zoom, muted,
        } = request
        {
            let rect = bounds(window, viewport)?;
            if !BrowserPolicy::public_web().permits(&url) {
                return Err("Browser navigation blocked".into());
            }
            let tab = tab_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if let std::collections::hash_map::Entry::Vacant(entry) =
                windows.entry(window.label().to_owned())
            {
                let app = window.app_handle().clone();
                let owner = window.label().to_owned();
                let engine = NativeBrowserEngine::new(
                    profile.ok_or("Browser profile unavailable")?,
                    BrowserPolicy::public_web(),
                    Arc::new(move |event| {
                        if let super::engine::EngineEvent::Visited { url, title, .. } = &event {
                            let error_app = app.clone(); let error_owner = owner.clone();
                            let failed = move |_error: String| { let _ = error_app.emit_to(tauri::EventTarget::webview_window(&error_owner), "zicode:browser-event", json!({"kind":"historyFailed"})); };
                            if super::history_worker::record(owner.clone(), url.clone(), title.clone(), failed).is_err() {
                                let _ = app.emit_to(tauri::EventTarget::webview_window(&owner), "zicode:browser-event", json!({"kind":"historyFailed"}));
                            }
                        }
                        if let super::engine::EngineEvent::DownloadChanged { download } = &event {
                            let error_app = app.clone(); let error_owner = owner.clone();
                            let failed = move |_error: String| { let _ = error_app.emit_to(tauri::EventTarget::webview_window(&error_owner), "zicode:browser-event", json!({"kind":"downloadHistoryFailed"})); };
                            match serde_json::to_value(download) {
                                Ok(value) => { if super::download_journal::record(owner.clone(), value, failed).is_err() { let _ = app.emit_to(tauri::EventTarget::webview_window(&owner), "zicode:browser-event", json!({"kind":"downloadHistoryFailed"})); } },
                                Err(error) => failed(error.to_string()),
                            }
                        }
                        let _ = app.emit_to(
                            tauri::EventTarget::webview_window(&owner),
                            "zicode:browser-event",
                            event,
                        );
                    }),
                )?;
                entry.insert(WindowBrowser { engine, tabs: Vec::new() });
            }
            let browser = windows
                .get_mut(window.label())
                .ok_or("Browser unavailable")?;
            browser.engine.create(window, &tab, &url, rect, zoom, muted)?;
            browser.tabs.push(tab.clone());
            return Ok(json!({"tab":tab}));
        }
        if matches!(&request, Request::DownloadLive) && !windows.contains_key(window.label()) { return Ok(json!([])); }
        // Keep the hide revision even before the first native view is created.
        if !windows.contains_key(window.label()) {
            if let Request::Hide { revision } = &request {
                accept_revision(window.label(), *revision)?;
                return Ok(Value::Null);
            }
        }
        let browser = windows
            .get_mut(window.label())
            .ok_or("Browser unavailable")?;
        match request {
            Request::Present {
                tab,
                bounds: viewport,
                revision,
                focus,
            } => {
                let rect = bounds(window, viewport)?;
                accept_revision(window.label(), revision)?;
                browser.engine.activate(tab.as_deref(), rect, focus)?;
            }
            Request::Hide { revision } => {
                accept_revision(window.label(), revision)?;
                browser.engine.activate(
                    None,
                    Bounds {
                        x: 0.0,
                        y: 0.0,
                        width: 1.0,
                        height: 1.0,
                    },
                    false,
                )?;
            }
            Request::DownloadLive => return serde_json::to_value(browser.engine.downloads.list()).map_err(|e| e.to_string()),
            Request::DownloadName { id } => return Ok(json!(browser.engine.downloads.name(&id)?)),
            Request::DownloadSave { id } => {
                let directory = window.app_handle().path().download_dir().map_err(|e| e.to_string())?;
                let path = super::engine::native_downloads::files::default_target(&directory, &browser.engine.downloads.name(&id)?)?;
                browser.engine.downloads.save(&id, &path)?;
            },
            Request::DownloadCancel { id } => browser.engine.downloads.cancel(&id)?,
            Request::Downloads { .. } | Request::DownloadChoose { .. } | Request::DownloadRemove { .. } => unreachable!(),
            Request::MenuLanguage { chinese } => browser.engine.menu_chinese.store(chinese, std::sync::atomic::Ordering::Relaxed),
            Request::Navigate { tab, url } => browser.engine.navigate(&tab, &url)?,
            Request::Action { tab, action } => browser.engine.action(&tab, &action)?,
            Request::Close { tab } => {browser.engine.destroy(&tab)?; browser.tabs.retain(|id| id != &tab);},
            Request::FocusChrome { tab } => focus(window, &browser.engine, &tab, false)?,
            Request::FocusPage { tab } => focus(window, &browser.engine, &tab, true)?,
            Request::FindStatus { tab } => return super::native_find::status(browser.engine.view(&tab)?),
            Request::FindStep { tab, backward } => super::native_find::step(browser.engine.view(&tab)?, backward)?,
            Request::FindStop { tab } => super::native_find::stop(browser.engine.view(&tab)?)?,
            Request::PageSettings { tab } => return serde_json::to_value(super::engine::page_controls::read(browser.engine.view(&tab)?)?).map_err(|e|e.to_string()),
            Request::SetZoom { tab, zoom } => return serde_json::to_value(super::engine::page_controls::set_zoom(browser.engine.view(&tab)?,zoom)?).map_err(|e|e.to_string()),
            Request::SetMuted { tab, muted } => return serde_json::to_value(super::engine::page_controls::set_muted(browser.engine.view(&tab)?,muted)?).map_err(|e|e.to_string()),
            Request::Url { tab } => {
                return Ok(
                    json!({"url":browser.engine.view(&tab)?.url().map_err(|e|e.to_string())?}),
                )
            }
            Request::Create { .. } | Request::Status | Request::Fullscreen { .. } | Request::FindStart { .. } | Request::Snapshot { .. } => unreachable!(),
        }
        Ok(Value::Null)
    }))
}
pub(super) fn save_download(window: &WebviewWindow, id: &str, path: &std::path::Path) -> Result<(), String> {
    WINDOWS.with(|slot| slot.with_mut(|windows| windows.get(window.label()).ok_or("Browser unavailable".to_owned())?.engine.downloads.save(id,path)))
}
pub(super) fn shutdown_downloads() {
    // Clone managers, release registry borrow before native cancellation can pump callbacks.
    let managers = WINDOWS.with(|slot| slot.with_mut(|windows| Ok(windows.values().map(|browser| browser.engine.downloads.clone()).collect::<Vec<_>>())));
    if let Ok(managers) = managers { for manager in managers { manager.cancel_all(); } }
}
pub(super) fn start_find(window: &WebviewWindow, tab: String, text: String, case_sensitive: bool,
    sender: tokio::sync::oneshot::Sender<Result<Value, String>>) {
    let sender = std::rc::Rc::new(RefCell::new(Some(sender)));
    let completion = sender.clone();
    let result = WINDOWS.with(|slot| slot.with_mut(|windows| {
        let browser = windows.get(window.label()).ok_or("Browser unavailable")?;
        super::native_find::start(browser.engine.view(&tab)?, &text, case_sensitive, move |result| {
            if let Some(sender) = completion.borrow_mut().take() { let _ = sender.send(result); }
        })
    }));
    if let Err(error) = result { if let Some(sender) = sender.borrow_mut().take() { let _ = sender.send(Err(error)); } }
}
pub(super) fn forget(label: &str) {
    REVISIONS.with(|slot| {
        slot.borrow_mut().remove(label);
    });
    WINDOWS.with(|slot| slot.retire(label));
}

pub(super) fn capture(
    window: &WebviewWindow,
    tab: String,
    expected_url: String,
    sender: tokio::sync::oneshot::Sender<Result<super::capture::Capture, String>>,
) {
    // Share a single sender between setup failure and asynchronous completion.
    let sender = Arc::new(std::sync::Mutex::new(Some(sender)));
    let completion = sender.clone();
    let result = (|| {
        crate::require_workspace_window(window)?;
        WINDOWS.with(|slot| {
            slot.with_mut(|windows| {
                let browser = windows.get(window.label()).ok_or("Browser unavailable")?;
                let view = browser.engine.view(&tab)?;
                let url = view.url().map_err(|e| e.to_string())?;
                if url != expected_url {
                    return Err("Browser page changed; read it again".into());
                }
                let stamp = browser.engine.document_revision(&tab)?;
                let surface =
                    REVISIONS.with(|s| s.borrow().get(window.label()).copied().unwrap_or(0));
                let owner = window.clone();
                view.evaluate_script_with_callback(super::capture::SCRIPT, move |raw| {
                    let owner = owner.clone();
                    let tab = tab.clone();
                    let url = url.clone();
                    let stamp = stamp.clone();
                    let app = owner.app_handle().clone();
                    let queued = completion.clone();
                    let dispatched = app.run_on_main_thread(move || {
                        let result = (|| {
                            crate::require_workspace_window(&owner)?;
                            WINDOWS.with(|s| {
                                s.with_mut(|windows| {
                                    let browser =
                                        windows.get(owner.label()).ok_or("Browser was closed")?;
                                    let current = browser
                                        .engine
                                        .view(&tab)?
                                        .url()
                                        .map_err(|e| e.to_string())?;
                                    let same_surface = REVISIONS.with(|v| {
                                        v.borrow().get(owner.label()).copied().unwrap_or(0)
                                            == surface
                                    });
                                    if current != url
                                        || browser.engine.document_revision(&tab)? != stamp
                                        || !same_surface
                                    {
                                        return Err(
                                            "Browser page or selection changed; read it again"
                                                .into(),
                                        );
                                    }
                                    Ok(super::capture::Capture {
                                        tab,
                                        document_revision: stamp,
                                        captured_at: chrono::Utc::now().to_rfc3339(),
                                        source_trust: "untrusted-web-content",
                                        page: super::capture::decode(&raw, &url)?,
                                    })
                                })
                            })
                        })();
                        if let Ok(mut sender) = queued.lock() {
                            if let Some(sender) = sender.take() {
                                let _ = sender.send(result);
                            }
                        }
                    });
                    if let Err(error) = dispatched {
                        if let Ok(mut sender) = completion.lock() {
                            if let Some(sender) = sender.take() {
                                let _ = sender.send(Err(error.to_string()));
                            }
                        }
                    }
                })
                .map_err(|e| e.to_string())
            })
        })
    })();
    if let Err(error) = result {
        if let Ok(mut sender) = sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(Err(error));
            }
        }
    }
}

// Capture only the current owner-bound native page; discard late navigation results.
pub(super) fn preview(window: &WebviewWindow, tab: String, sender: tokio::sync::oneshot::Sender<Result<Value,String>>) {
    let sender = Arc::new(std::sync::Mutex::new(Some(sender)));
    let completion = sender.clone();
    let result = WINDOWS.with(|slot| slot.with_mut(|windows| {
        let browser = windows.get(window.label()).ok_or("Browser unavailable")?;
        let stamp = browser.engine.document_revision(&tab)?;
        let owner = window.clone();
        super::native_preview::capture(browser.engine.view(&tab)?, move |image| {
            let queued = completion.clone(); let app = owner.app_handle().clone();
            let dispatched = app.run_on_main_thread(move || {
                let result = crate::require_workspace_window(&owner).and_then(|_| WINDOWS.with(|slot| slot.with_mut(|windows| {
                    let browser = windows.get(owner.label()).ok_or("Browser unavailable")?;
                    if browser.engine.document_revision(&tab)? != stamp { return Err("Browser page changed".into()); }
                    image.map(Value::String)
                })));
                if let Ok(mut sender) = queued.lock() { if let Some(sender) = sender.take() { let _ = sender.send(result); } }
            });
            if let Err(error) = dispatched { if let Ok(mut sender) = completion.lock() { if let Some(sender) = sender.take() { let _ = sender.send(Err(error.to_string())); } } }
        })
    }));
    if let Err(error) = result { if let Ok(mut sender) = sender.lock() { if let Some(sender) = sender.take() { let _ = sender.send(Err(error)); } } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hide_before_creation_rejects_late_show_and_isolates_windows() {
        let owner = uuid::Uuid::new_v4().to_string();
        let peer = uuid::Uuid::new_v4().to_string();
        assert!(accept_revision(&owner, 3).is_ok());
        assert!(accept_revision(&owner, 2).is_err());
        assert!(accept_revision(&owner, 3).is_err());
        assert!(accept_revision(&peer, 1).is_ok());
        assert!(accept_revision(&owner, 4).is_ok());
        forget(&owner);
        forget(&peer);
    }
}
