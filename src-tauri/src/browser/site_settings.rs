use super::SiteAction;
use serde_json::{json, Value};
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler, GetCookiesCompletedHandler, GetNonDefaultPermissionSettingsCompletedHandler,
    SetPermissionStateCompletedHandler, Microsoft::Web::WebView2::Win32::*,
};
use windows::core::{Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;

fn entries(settings: ICoreWebView2PermissionSettingCollectionView, origin: &str) -> windows::core::Result<Value> {
    let mut result = Vec::new();
    unsafe {
        let mut count = 0;
        settings.Count(&mut count)?;
        for index in 0..count {
            let item = settings.GetValueAtIndex(index)?;
            let mut raw = PWSTR::null();
            item.PermissionOrigin(&mut raw)?;
            let saved = take_pwstr(raw);
            if tauri::Url::parse(&saved).ok().map(|url| url.origin().ascii_serialization()).as_deref() != Some(origin) { continue; }
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            let mut state = COREWEBVIEW2_PERMISSION_STATE::default();
            item.PermissionKind(&mut kind)?;
            item.PermissionState(&mut state)?;
            result.push(json!({"permission":kind.0, "allowed":state == COREWEBVIEW2_PERMISSION_STATE_ALLOW}));
        }
    }
    Ok(json!(result))
}

pub(super) fn run(
    view: &wry::WebView, expected_origin: &str, action: SiteAction,
    done: impl FnOnce(Result<Value, String>) + 'static,
) -> Result<(), String> {
    let url = tauri::Url::parse(&view.url().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let origin = url.origin().ascii_serialization();
    if !matches!(url.scheme(), "https" | "http") || origin != expected_origin {
        return Err("Site changed. Open site settings again.".into());
    }
    let native = view.webview();
    unsafe {
        match action {
            SiteAction::ClearHostCookies { confirmed: true } => {
                let host = url.host_str().ok_or("Missing site host")?.to_owned();
                let manager = native.cast::<ICoreWebView2_2>().and_then(|n| n.CookieManager()).map_err(|e| e.to_string())?;
                let remove = manager.clone();
                // A URI query omits cookies at other paths. Inspect only domains, never cookie values.
                manager.GetCookies(&HSTRING::new(), &GetCookiesCompletedHandler::create(Box::new(move |status, cookies| {
                    let result = status.and_then(|_| {
                        let cookies = cookies.ok_or_else(windows::core::Error::empty)?;
                        let mut count = 0;
                        cookies.Count(&mut count)?;
                        for index in 0..count {
                            let cookie = cookies.GetValueAtIndex(index)?;
                            let mut raw = PWSTR::null();
                            cookie.Domain(&mut raw)?;
                            if take_pwstr(raw).eq_ignore_ascii_case(&host) { remove.DeleteCookie(&cookie)?; }
                        }
                        Ok(Value::Null)
                    });
                    done(result.map_err(|e| e.to_string())); Ok(())
                })))
            }
            SiteAction::ClearStorage { confirmed: true } => {
                // Cookies can be shared by sibling origins. Only clear the explicitly listed origin stores.
                let params = json!({"origin":origin,"storageTypes":"local_storage,indexeddb,cache_storage,service_workers"});
                native.CallDevToolsProtocolMethod(&HSTRING::from("Storage.clearDataForOrigin"), &HSTRING::from(params.to_string()),
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, _| {
                        done(status.map(|_| Value::Null).map_err(|e| e.to_string())); Ok(())
                    })))
            }
            SiteAction::List => {
                let profile = native.cast::<ICoreWebView2_13>().and_then(|n| n.Profile()).and_then(|p| p.cast::<ICoreWebView2Profile4>()).map_err(|e| e.to_string())?;
                profile.GetNonDefaultPermissionSettings(&GetNonDefaultPermissionSettingsCompletedHandler::create(Box::new(move |status, settings| {
                    let result = status.and_then(|_| entries(settings.ok_or_else(windows::core::Error::empty)?, &origin));
                    done(result.map_err(|e| e.to_string())); Ok(())
                })))
            }
            SiteAction::Revoke { permission, confirmed: true } => {
                let profile = native.cast::<ICoreWebView2_13>().and_then(|n| n.Profile()).and_then(|p| p.cast::<ICoreWebView2Profile4>()).map_err(|e| e.to_string())?;
                profile.SetPermissionState(COREWEBVIEW2_PERMISSION_KIND(permission), &HSTRING::from(origin), COREWEBVIEW2_PERMISSION_STATE_DENY,
                    &SetPermissionStateCompletedHandler::create(Box::new(move |status| {
                        done(status.map(|_| Value::Null).map_err(|e| e.to_string())); Ok(())
                    })))
            }
            _ => return Err("Confirmation required".into()),
        }.map_err(|e| e.to_string())
    }
}
