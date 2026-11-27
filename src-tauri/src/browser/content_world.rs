//! Execute only Studio's bundled content readers in a named WebView2 isolated world.
use serde::Deserialize;
use serde_json::{json, value::RawValue, Value};
use std::{cell::RefCell, rc::Rc};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, ExecuteScriptCompletedHandler,
    Microsoft::Web::WebView2::Win32::ICoreWebView2,
};
use windows::core::HSTRING;
use wry::WebViewExtWindows;

const UNAVAILABLE: &str = "Browser content is unavailable. Read the page again.";
const MAX_REPLY: usize = 8 * 1024 * 1024;

fn request(
    view: &ICoreWebView2,
    method: &str,
    params: Value,
    done: impl FnOnce(Result<String, String>) + 'static,
) {
    let pending = Rc::new(RefCell::new(Some(done)));
    let completion = pending.clone();
    let handler =
        CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, json| {
            let done = completion.borrow_mut().take();
            if let Some(done) = done {
                done(
                    status
                        .ok()
                        .filter(|_| json.len() <= MAX_REPLY)
                        .map(|_| json)
                        .ok_or_else(|| UNAVAILABLE.to_owned()),
                );
            }
            Ok(())
        }));
    let sent = unsafe {
        view.CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(params.to_string()),
            &handler,
        )
    };
    if sent.is_err() {
        let done = pending.borrow_mut().take();
        if let Some(done) = done {
            done(Err(UNAVAILABLE.into()));
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameTree {
    frame_tree: RootFrame,
}
#[derive(Deserialize)]
struct RootFrame {
    frame: Frame,
}
#[derive(Deserialize)]
struct Frame {
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct World {
    execution_context_id: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Evaluation {
    result: RemoteValue,
    exception_details: Option<Box<RawValue>>,
}
#[derive(Deserialize)]
struct RemoteValue {
    value: Option<Box<RawValue>>,
}

fn read_response(response: &str) -> Result<String, String> {
    serde_json::from_str::<Evaluation>(response)
        .ok()
        .filter(|reply| reply.exception_details.is_none())
        .and_then(|reply| reply.result.value)
        .map(|value| value.get().to_owned())
        .ok_or_else(|| UNAVAILABLE.into())
}

fn evaluate_metadata(
    view: &ICoreWebView2,
    script: &str,
    done: impl FnOnce(Result<String, String>) + 'static,
) {
    let pending = Rc::new(RefCell::new(Some(done)));
    let completion = pending.clone();
    let handler = ExecuteScriptCompletedHandler::create(Box::new(move |status, json| {
        let done = completion.borrow_mut().take();
        if let Some(done) = done {
            done(
                status
                    .ok()
                    .filter(|_| json.len() <= MAX_REPLY)
                    .map(|_| json)
                    .ok_or_else(|| UNAVAILABLE.to_owned()),
            );
        }
        Ok(())
    }));
    if unsafe { view.ExecuteScript(&HSTRING::from(script), &handler) }.is_err() {
        let done = pending.borrow_mut().take();
        if let Some(done) = done {
            done(Err(UNAVAILABLE.into()));
        }
    }
}

pub(super) fn evaluate(
    view: &wry::WebView,
    script: &str,
    fallback: Option<&str>,
    done: impl FnOnce(Result<String, String>, bool) + 'static,
) {
    let native = view.webview();
    let fallback_view = native.clone();
    let fallback = fallback.map(str::to_owned);
    let done = move |raw| match (raw, fallback) {
        (Err(_), Some(script)) => {
            evaluate_metadata(&fallback_view, &script, move |result| done(result, true))
        }
        (raw, _) => done(raw, false),
    };
    let for_world = native.clone();
    let script = script.to_owned();
    request(&native, "Page.getFrameTree", json!({}), move |reply| {
        let frame = reply.and_then(|reply| {
            serde_json::from_str::<FrameTree>(&reply).map_err(|_| UNAVAILABLE.to_owned())
        });
        let Ok(frame) = frame else {
            return done(Err(UNAVAILABLE.into()));
        };
        let for_evaluation = for_world.clone();
        request(
            &for_world,
            "Page.createIsolatedWorld",
            json!({
                "frameId": frame.frame_tree.frame.id,
                "worldName": "StudioBrowserContent",
            }),
            move |reply| {
                let world = reply.and_then(|reply| {
                    serde_json::from_str::<World>(&reply).map_err(|_| UNAVAILABLE.to_owned())
                });
                let Ok(world) = world else {
                    return done(Err(UNAVAILABLE.into()));
                };
                request(
                    &for_evaluation,
                    "Runtime.evaluate",
                    json!({
                        "contextId": world.execution_context_id,
                        "expression": script,
                        "returnByValue": true,
                        "silent": true,
                    }),
                    move |reply| done(reply.and_then(|reply| read_response(&reply))),
                );
            },
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_script_exceptions_and_accepts_only_returned_values() {
        assert_eq!(
            read_response(r#"{"result":{"type":"object","value":{"ok":true}}}"#).unwrap(),
            r#"{"ok":true}"#
        );
        assert!(
            read_response(r#"{"result":{"type":"object","description":"untrusted"}}"#).is_err()
        );
        assert!(read_response(
            r#"{"result":{"value":{"ok":true}},"exceptionDetails":{"text":"untrusted"}}"#
        )
        .is_err());
    }
}
