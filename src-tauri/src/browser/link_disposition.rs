//! Observe link disposition in a named Chromium isolated world. This signal
//! changes only tab activation; native WebView2 still authorizes every popup.
use serde::Deserialize;
use serde_json::json;
use std::{
    cell::Cell,
    rc::Rc,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
    DevToolsProtocolEventReceivedEventHandler,
};
use windows::core::{HSTRING, PWSTR};
use wry::WebViewExtWindows;

pub(super) struct Gesture {
    source: String,
    target: String,
    received: Instant,
    revision: u64,
}
impl Gesture {
    pub(super) fn matches(&self, source: &str, target: &str, revision: u64) -> bool {
        self.received.elapsed() < Duration::from_secs(1)
            && source == self.source
            && revision == self.revision
            && target == self.target
    }
}
#[derive(Deserialize)]
struct BindingEvent {
    name: String,
    payload: String,
}

pub(super) fn observe(view: &wry::WebView, revision: Arc<AtomicU64>) -> Rc<Cell<Option<Gesture>>> {
    let pending = Rc::new(Cell::new(None));
    let sink = pending.clone();
    let native = view.webview();
    let world = "StudioLinkDisposition";
    let binding = "studioLinkDisposition";
    unsafe {
        let installed = (|| -> windows::core::Result<()> {
            let receiver =
                native.GetDevToolsProtocolEventReceiver(&HSTRING::from("Runtime.bindingCalled"))?;
            receiver.add_DevToolsProtocolEventReceived(
                &DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut raw = PWSTR::null();
                    args.ParameterObjectAsJson(&mut raw)?;
                    let event = take_pwstr(raw);
                    if let Ok(event) = serde_json::from_str::<BindingEvent>(&event) {
                        if event.name == binding && event.payload.len() <= 131072 {
                            sink.set(
                                serde_json::from_str::<(String, String)>(&event.payload)
                                    .ok()
                                    .filter(|(source, target)| {
                                        source.len() <= 16384 && target.len() <= 16384
                                    })
                                    .map(|(source, target)| Gesture {
                                        source,
                                        target,
                                        received: Instant::now(),
                                        revision: revision.load(Ordering::SeqCst),
                                    }),
                            );
                        }
                    }
                    Ok(())
                })),
                &mut 0,
            )?;
            for (method, args) in [
                ("Page.enable", json!({})),
                ("Runtime.enable", json!({})),
                (
                    "Runtime.addBinding",
                    json!({"name":binding,"executionContextName":world}),
                ),
                (
                    "Page.addScriptToEvaluateOnNewDocument",
                    json!({"worldName":world,"source":include_str!("link_disposition.js")}),
                ),
            ] {
                native.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(args.to_string()),
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(()))),
                )?;
            }
            Ok(())
        })();
        if installed.is_err() {
            pending.set(None);
        }
    }
    pending
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_popup_must_match_the_recent_source_target_and_revision() {
        let mut hit = Gesture {
            source: "https://example.test/source".into(),
            target: "https://example.test/destination".into(),
            received: Instant::now(),
            revision: 3,
        };
        assert!(hit.matches(&hit.source, &hit.target, 3));
        assert!(!hit.matches("https://other.test/source", &hit.target, 3));
        assert!(!hit.matches(&hit.source, "https://example.test/elsewhere", 3));
        assert!(!hit.matches(&hit.source, &hit.target, 4));
        hit.received -= Duration::from_secs(2);
        assert!(!hit.matches(&hit.source, &hit.target, 3));
    }
}
