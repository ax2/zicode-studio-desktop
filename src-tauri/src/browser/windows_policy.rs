use super::{engine::EngineEvent, policy::BrowserPolicy};
use std::sync::Arc;
use webview2_com::{
    take_pwstr, DownloadStartingEventHandler, Microsoft::Web::WebView2::Win32::*,
    NavigationCompletedEventHandler, PermissionRequestedEventHandler,
    WebResourceRequestedEventHandler,
};
use windows::core::{w, Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;

/// Deny privileged site capabilities until a per-site grant UI exists. This is
/// not a browser extension host; no host objects or web-message bridge exist.
pub fn install(
    view: &wry::WebView,
    policy: BrowserPolicy,
    download_staging: &std::path::Path,
    tab: String,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    unsafe {
        let native = view.webview();
        // Do not depend on the user's OS download folder existing or being
        // writable. All downloads are still canceled below, before any save.
        native
            .cast::<ICoreWebView2_13>()?
            .Profile()?
            .SetDefaultDownloadFolderPath(&HSTRING::from(download_staging.as_os_str()))?;
        // Wry 0.55.1 injects an ipc shim even without a handler. Disable the
        // underlying transport and host objects natively before navigation.
        let settings = native.Settings()?;
        settings.SetIsWebMessageEnabled(false)?;
        settings.SetAreHostObjectsAllowed(false)?;
        let mut token = 0;
        let dl_emit = emit.clone();
        let dl_tab = tab.clone();
        native.cast::<ICoreWebView2_4>()?.add_DownloadStarting(
            &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    // Cancel before resolving a default file path or presenting
                    // native download UI. A manager can provide a destination later.
                    args.SetCancel(true)?;
                    dl_emit(EngineEvent::NativeDownloadBlocked { tab: dl_tab.clone() });
                }
                Ok(())
            })), &mut token)?;
        let nav_emit = emit.clone();
        let nav_tab = tab.clone();
        native.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                if let Some(args) = args {
                    let mut success = windows::core::BOOL::default();
                    let mut error = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                    args.IsSuccess(&mut success)?;
                    args.WebErrorStatus(&mut error)?;
                    if success.as_bool() {
                        if let Some(sender) = sender {
                            let mut url = PWSTR::null(); sender.Source(&mut url)?;
                            let url = take_pwstr(url);
                            let mut title = PWSTR::null(); sender.DocumentTitle(&mut title)?;
                            nav_emit(EngineEvent::Visited { tab: nav_tab.clone(), url, title: take_pwstr(title).chars().take(512).collect() });
                        }
                    }
                    nav_emit(EngineEvent::NavigationFinished {
                        tab: nav_tab.clone(),
                        success: success.as_bool(),
                        error: error.0,
                    });
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
        let environment = view.environment();
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
                if !policy.permits(&uri) {
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
