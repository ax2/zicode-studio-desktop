//! Route user-initiated public links to trusted Studio chrome, never a free popup.
use super::{BrowserPolicy, EngineEvent};
use std::sync::Arc;
use webview2_com::{take_pwstr, NewWindowRequestedEventHandler};
use windows::core::{BOOL, PWSTR};
use wry::WebViewExtWindows;

fn allowed_link(policy: &BrowserPolicy, url: &str, initiated: bool, visible: bool) -> bool {
    initiated
        && visible
        && url.len() <= 16384
        && (url.starts_with("https://") || url.starts_with("http://"))
        && policy.permits(url)
}

pub fn install(
    view: &wry::WebView,
    policy: BrowserPolicy,
    tab: String,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    let controller = view.controller();
    unsafe {
        let mut token = 0;
        view.webview().add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                // Complete synchronously without supplying NewWindow. New tab creation
                // runs later through the owner-bound Host and its normal navigation policy.
                args.SetHandled(true)?;
                let mut initiated = BOOL::default();
                args.IsUserInitiated(&mut initiated)?;
                let mut visible = BOOL::default();
                controller.IsVisible(&mut visible)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let url = take_pwstr(uri);
                let allowed = allowed_link(&policy, &url, initiated.as_bool(), visible.as_bool());
                emit(EngineEvent::Popup {
                    tab: tab.clone(),
                    url: if allowed { url } else { String::new() },
                    user_initiated: initiated.as_bool(),
                    allowed,
                    background: false,
                });
                Ok(())
            })),
            &mut token,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn links_require_a_visible_user_gesture_and_public_url() {
        let policy = BrowserPolicy::public_web();
        assert!(allowed_link(
            &policy,
            "https://example.org/page",
            true,
            true
        ));
        assert!(!allowed_link(
            &policy,
            "https://example.org/page",
            false,
            true
        ));
        assert!(!allowed_link(
            &policy,
            "https://example.org/page",
            true,
            false
        ));
        for url in [
            "about:blank",
            "file:///D:/private",
            "javascript:alert(1)",
            "http://127.0.0.1:57620/",
            "https://user:pass@example.org/",
        ] {
            assert!(!allowed_link(&policy, url, true, true), "{url}");
        }
        assert!(!allowed_link(
            &policy,
            &format!("https://example.org/{}", "a".repeat(16384)),
            true,
            true
        ));
    }
}
