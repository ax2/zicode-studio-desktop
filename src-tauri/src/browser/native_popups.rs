//! Native auxiliary windows retain an opener while ordinary link tabs stay durable.
use super::{BrowserPolicy, EngineEvent};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use webview2_com::{
    take_pwstr, Microsoft::Web::WebView2::Win32::*, NewWindowRequestedEventHandler,
    WindowCloseRequestedEventHandler,
};
use windows::core::{Interface, BOOL, PWSTR};
use wry::WebViewExtWindows;

pub const EXPIRY: Duration = Duration::from_secs(8);

#[derive(Default)]
pub(super) struct PendingPopups(RefCell<Option<Pending>>);
impl PendingPopups {
    fn insert(&self, request: Pending) -> bool {
        let mut slot = self.0.borrow_mut();
        if slot.is_some() {
            return false;
        }
        *slot = Some(request);
        true
    }
    pub(super) fn claim(&self, key: &str, url: &str) -> Result<Pending, String> {
        let request = self
            .take_if(|item| item.key == key)
            .ok_or("Browser popup request expired")?;
        if request.url != url || request.expired() {
            return Err("Browser popup request expired".into());
        }
        Ok(request)
    }
    pub(super) fn cancel(&self, key: &str) {
        drop(self.take_if(|request| request.key == key));
    }
    pub(super) fn retain_source(&self, tab: Option<&str>) {
        drop(self.take_if(|request| Some(request.tab.as_str()) != tab));
    }
    pub(super) fn cancel_source(&self, tab: &str) {
        drop(self.take_if(|request| request.tab == tab));
    }
    fn take_if(&self, predicate: impl FnOnce(&Pending) -> bool) -> Option<Pending> {
        let mut slot = self.0.borrow_mut();
        if slot.as_ref().is_some_and(predicate) {
            slot.take()
        } else {
            None
        }
    }
}

pub(super) struct Pending {
    key: String,
    url: String,
    pub tab: String,
    pub source_url: String,
    pub revision: Arc<AtomicU64>,
    pub stamp: u64,
    created: Instant,
    args: ICoreWebView2NewWindowRequestedEventArgs,
    deferral: Option<ICoreWebView2Deferral>,
}
impl Pending {
    pub(super) fn expired(&self) -> bool {
        self.created.elapsed() >= EXPIRY
    }
    pub(super) fn attach(&self, target: &wry::WebView) -> windows::core::Result<()> {
        unsafe { self.args.SetNewWindow(&target.webview()) }
    }
    pub(super) fn complete(&mut self) -> windows::core::Result<()> {
        if let Some(deferral) = self.deferral.take() {
            unsafe {
                deferral.Complete()?;
            }
        }
        Ok(())
    }
}
impl Drop for Pending {
    fn drop(&mut self) {
        let _ = self.complete();
    }
}

fn allowed_link(policy: &BrowserPolicy, url: &str, initiated: bool, visible: bool) -> bool {
    initiated
        && visible
        && url.len() <= 16384
        && (url.starts_with("https://") || url.starts_with("http://"))
        && policy.permits(url)
}

fn auxiliary(
    args: &ICoreWebView2NewWindowRequestedEventArgs,
    url: &str,
) -> windows::core::Result<bool> {
    if url == "about:blank" {
        return Ok(true);
    }
    unsafe {
        let features = args.WindowFeatures()?;
        let mut size = BOOL::default();
        let mut position = BOOL::default();
        features.HasSize(&mut size)?;
        features.HasPosition(&mut position)?;
        if size.as_bool() || position.as_bool() {
            return Ok(true);
        }
        if let Ok(named) = args.cast::<ICoreWebView2NewWindowRequestedEventArgs2>() {
            let mut raw = PWSTR::null();
            named.Name(&mut raw)?;
            let name = take_pwstr(raw);
            return Ok(!name.is_empty() && !name.starts_with('_'));
        }
    }
    Ok(false)
}

pub(super) fn install(
    view: &wry::WebView,
    policy: BrowserPolicy,
    tab: String,
    revision: Arc<AtomicU64>,
    requests: Rc<PendingPopups>,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    let controller = view.controller();
    unsafe {
        view.webview().add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                args.SetHandled(true)?;
                let mut initiated = BOOL::default();
                args.IsUserInitiated(&mut initiated)?;
                let mut visible = BOOL::default();
                controller.IsVisible(&mut visible)?;
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                let url = take_pwstr(uri);
                let gesture = initiated.as_bool() && visible.as_bool();
                let mut allowed =
                    allowed_link(&policy, &url, initiated.as_bool(), visible.as_bool());
                let mut request = None;
                if gesture && (allowed || url == "about:blank") && auxiliary(&args, &url)? {
                    let Some(sender) = sender else {
                        return Ok(());
                    };
                    let mut raw = PWSTR::null();
                    sender.Source(&mut raw)?;
                    let source_url = take_pwstr(raw);
                    allowed = false;
                    if allowed_link(&policy, &source_url, true, true) {
                        let key = uuid::Uuid::new_v4().to_string();
                        let deferral = args.GetDeferral()?;
                        allowed = requests.insert(Pending {
                            key: key.clone(),
                            url: url.clone(),
                            tab: tab.clone(),
                            source_url,
                            revision: revision.clone(),
                            stamp: revision.load(Ordering::SeqCst),
                            created: Instant::now(),
                            args,
                            deferral: Some(deferral),
                        });
                        if allowed {
                            request = Some(key);
                        }
                    }
                }
                emit(EngineEvent::Popup {
                    tab: tab.clone(),
                    url: if allowed { url } else { String::new() },
                    user_initiated: initiated.as_bool(),
                    allowed,
                    background: false,
                    request,
                });
                Ok(())
            })),
            &mut 0,
        )
    }
}

pub(super) fn install_close(
    view: &wry::WebView,
    tab: String,
    closing: Rc<Cell<bool>>,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    unsafe {
        view.webview().add_WindowCloseRequested(
            &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                if !closing.replace(true) {
                    emit(EngineEvent::PopupClosed { tab: tab.clone() });
                }
                Ok(())
            })),
            &mut 0,
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
