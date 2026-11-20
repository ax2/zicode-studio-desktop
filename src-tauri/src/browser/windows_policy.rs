use super::{engine::EngineEvent, policy::BrowserPolicy};
use std::{cell::Cell, rc::Rc, sync::Arc};
use webview2_com::{
    take_pwstr, HistoryChangedEventHandler, Microsoft::Web::WebView2::Win32::*,
    NavigationCompletedEventHandler, NavigationStartingEventHandler, PermissionRequestedEventHandler,
    SourceChangedEventHandler, WebResourceRequestedEventHandler,
};
use windows::core::{w, Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HistoryState {
    pub(super) can_go_back: bool,
    pub(super) can_go_forward: bool,
}

pub(super) fn history_state(view: &ICoreWebView2) -> windows::core::Result<HistoryState> {
    let mut back = windows::core::BOOL::default();
    let mut forward = windows::core::BOOL::default();
    unsafe {
        view.CanGoBack(&mut back)?;
        view.CanGoForward(&mut forward)?;
    }
    Ok(HistoryState {
        can_go_back: back.as_bool(),
        can_go_forward: forward.as_bool(),
    })
}

fn emit_visit(
    view: &ICoreWebView2,
    policy: &BrowserPolicy,
    emit: &dyn Fn(EngineEvent),
    tab: &str,
    same_document: bool,
) -> windows::core::Result<()> {
    unsafe {
        let mut url = PWSTR::null();
        view.Source(&mut url)?;
        let url = take_pwstr(url);
        if url == "about:blank" || url.len() > 16384 || !policy.permits(&url) {
            return Ok(());
        }
        let mut title = PWSTR::null();
        view.DocumentTitle(&mut title)?;
        emit(EngineEvent::Visited {
            tab: tab.to_owned(),
            url,
            title: take_pwstr(title).chars().take(512).collect(),
            same_document,
            transient: false,
        });
    }
    Ok(())
}

#[derive(Default)]
pub(super) struct NavigationState {
    pending: Rc<Cell<Option<u64>>>,
    loaded: Rc<Cell<bool>>,
}

impl NavigationState {
    pub(super) fn ready(&self) -> bool {
        self.pending.get().is_none() && self.loaded.get()
    }
}

/// Deny privileged site capabilities until a per-site grant UI exists. This is
/// not a browser extension host; no host objects or web-message bridge exist.
pub(super) fn install(
    view: &wry::WebView,
    navigation: &NavigationState,
    policy: BrowserPolicy,
    download_staging: &std::path::Path,
    tab: String,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    unsafe {
        let native = view.webview();
        // A deeply nested profile path makes WebView2 truncate suggested names.
        // Prefer the usual destination for suggestions; the manager still defers
        // every save and supplies its own reserved path after explicit approval.
        let suggested_folder = dirs::download_dir().filter(|path| path.is_dir())
            .unwrap_or_else(|| download_staging.to_path_buf());
        // This is only a suggested filename location, not an authorization or
        // a download destination. A rejected folder must not prevent browsing.
        // The download handler still cancels every transfer until explicit save.
        let profile = native.cast::<ICoreWebView2_13>()?.Profile()?;
        let suggest = |folder: &std::path::Path| {
            profile.SetDefaultDownloadFolderPath(&HSTRING::from(dunce::simplified(folder).as_os_str()))
        };
        if let Err(error) = suggest(&suggested_folder) {
            log::warn!("WebView2 rejected the usual download folder; trying the private staging folder: {error}");
            if let Err(error) = suggest(download_staging) {
                log::warn!("WebView2 rejected the private suggested download folder; retaining its default: {error}");
            }
        }
        // Wry 0.55.1 injects an ipc shim even without a handler. Disable the
        // underlying transport and host objects natively before navigation.
        let settings = native.Settings()?;
        settings.SetIsWebMessageEnabled(false)?;
        settings.SetAreHostObjectsAllowed(false)?;
        let mut token = 0;
        let history_emit = emit.clone();
        let history_tab = tab.clone();
        native.add_HistoryChanged(
            &HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    history_emit(EngineEvent::HistoryChanged {
                        tab: history_tab.clone(),
                        history: history_state(&sender)?,
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
        // WebView2 can start a replacement before the previous navigation completes.
        let current_navigation = navigation.pending.clone();
        let started_navigation = current_navigation.clone();
        let started_emit = emit.clone();
        let started_tab = tab.clone();
        native.add_NavigationStarting(
            &NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut canceled = windows::core::BOOL::default();
                    let mut id = 0;
                    args.Cancel(&mut canceled)?;
                    args.NavigationId(&mut id)?;
                    if !canceled.as_bool() && started_navigation.get() != Some(id) {
                        started_navigation.set(Some(id));
                        started_emit(EngineEvent::NavigationStarted {
                            tab: started_tab.clone(),
                        });
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        let has_document = navigation.loaded.clone();
        let route_document = has_document.clone();
        let route_navigation = current_navigation.clone();
        let route_emit = emit.clone();
        let route_policy = policy.clone();
        let route_tab = tab.clone();
        native.add_SourceChanged(
            &SourceChangedEventHandler::create(Box::new(move |sender, args| {
                if let (Some(sender), Some(args)) = (sender, args) {
                    let mut new_document = windows::core::BOOL::default();
                    args.IsNewDocument(&mut new_document)?;
                    // NavigationCompleted records the final URL during initial load.
                    if !new_document.as_bool() && route_document.get() && route_navigation.get().is_none() {
                        emit_visit(&sender, &route_policy, route_emit.as_ref(), &route_tab, true)?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        let nav_emit = emit.clone();
        let nav_policy = policy.clone();
        let nav_tab = tab.clone();
        native.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                if let Some(args) = args {
                    let mut id = 0;
                    args.NavigationId(&mut id)?;
                    if current_navigation.get() != Some(id) {
                        return Ok(());
                    }
                    current_navigation.set(None);
                    let mut success = windows::core::BOOL::default();
                    let mut error = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                    args.IsSuccess(&mut success)?;
                    args.WebErrorStatus(&mut error)?;
                    let canceled = error == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED;
                    if !canceled {
                        has_document.set(success.as_bool());
                    }
                    nav_emit(EngineEvent::NavigationFinished {
                        tab: nav_tab.clone(),
                        success: success.as_bool(),
                        canceled,
                    });
                    if let Some(sender) = sender.filter(|_| success.as_bool()) {
                        emit_visit(&sender, &nav_policy, nav_emit.as_ref(), &nav_tab, false)?;
                    }
                }
                Ok(())
            })),
            &mut token,
        )?;
        native.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                    args.PermissionKind(&mut kind)?;
                    emit(EngineEvent::PermissionBlocked {
                        tab: tab.clone(),
                        permission_kind: kind.0,
                    });
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}

pub fn install_resources(view: &wry::WebView, policy: BrowserPolicy) -> windows::core::Result<()> {
    unsafe {
        let native = view.webview();
        let environment = view.environment();
        let mut token = 0;
        // Include frame and worker requests on runtimes which implement v22.
        if let Ok(all_sources) = native.cast::<ICoreWebView2_22>() {
            all_sources.AddWebResourceRequestedFilterWithRequestSourceKinds(
                w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
            )?;
        } else {
            native.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
        }
        native.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let request = args.Request()?;
                let mut uri = PWSTR::null();
                request.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                if !policy.permits_resource(&uri) {
                    let response = environment.CreateWebResourceResponse(
                        None,
                        403,
                        w!("Blocked by Studio browser policy"),
                        w!("Content-Type: text/plain\r\nCache-Control: no-store"),
                    )?;
                    args.SetResponse(&response)?;
                }
                Ok(())
            })),
            &mut token,
        )?;
    }
    Ok(())
}
