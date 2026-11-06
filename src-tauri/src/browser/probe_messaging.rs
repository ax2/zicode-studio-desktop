//! Positive/negative native transport control for owned synthetic pages only.
use super::{evaluate, require, ui, B, ENGINE};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::AppHandle;
use webview2_com::WebMessageReceivedEventHandler;
use wry::WebViewExtWindows;

pub fn verify(app: &AppHandle) -> Result<Value, String> {
    let received = Arc::new(AtomicUsize::new(0));
    let capture = received.clone();
    let (token, settings) = ui(app, move |_| {
        ENGINE.with(|slot| {
        let slot = slot.borrow(); let engine = slot.as_ref().ok_or("No engine")?;
        let native = engine.view(B)?.webview();
        let mut messages = windows::core::BOOL::default();
        let mut objects = windows::core::BOOL::default();
        let mut token = 0;
        unsafe {
            let settings = native.Settings().map_err(|e| e.to_string())?;
            settings.IsWebMessageEnabled(&mut messages).map_err(|e| e.to_string())?;
            settings.AreHostObjectsAllowed(&mut objects).map_err(|e| e.to_string())?;
            require(!messages.as_bool() && !objects.as_bool(), "Browser native privileges are enabled")?;
            native.add_WebMessageReceived(&WebMessageReceivedEventHandler::create(Box::new(move |_, _| {
                capture.fetch_add(1,Ordering::SeqCst); Ok(())
            })), &mut token).map_err(|e| e.to_string())?;
            // A positive control ensures our handler actually observes messages.
            // This is only the debug acceptance runner, never product code.
            settings.SetIsWebMessageEnabled(true).map_err(|e| e.to_string())?;
        }
        Ok((token,json!({"webMessageEnabled":messages.as_bool(),"hostObjectsAllowed":objects.as_bool()})))
    })
    })?;
    evaluate(app, B, "(window.ipc.postMessage('positive-control'),true)")?;
    let deadline = Instant::now();
    while received.load(Ordering::SeqCst) == 0 && deadline.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(25));
    }
    require(
        received.load(Ordering::SeqCst) == 1,
        "Message positive control failed",
    )?;
    ui(app, |_| {
        ENGINE.with(|slot| {
            let slot = slot.borrow();
            let engine = slot.as_ref().ok_or("No engine")?;
            unsafe {
                engine
                    .view(B)?
                    .webview()
                    .Settings()
                    .and_then(|s| s.SetIsWebMessageEnabled(false))
                    .map_err(|e| e.to_string())
            }
        })
    })?;
    let calls = evaluate(app,B,"(()=>{let attempted=0;for(let i=0;i<3;i++){attempted++;try{window.ipc.postMessage('must-not-reach-host')}catch{}}return {attempted,tauri:typeof window.__TAURI__,token:typeof window.__zicodeDesktopToken}})()")?;
    std::thread::sleep(Duration::from_millis(150));
    let count = received.load(Ordering::SeqCst);
    ui(app, move |_| {
        ENGINE.with(|slot| {
            let slot = slot.borrow();
            let engine = slot.as_ref().ok_or("No engine")?;
            unsafe {
                engine
                    .view(B)?
                    .webview()
                    .remove_WebMessageReceived(token)
                    .map_err(|e| e.to_string())
            }
        })
    })?;
    require(
        count == 1,
        "Disabled native transport still delivers page messages",
    )?;
    require(
        calls["attempted"] == 3 && calls["tauri"] == "undefined" && calls["token"] == "undefined",
        "Untrusted native call probe invalid",
    )?;
    Ok(
        json!({"initialNativeSettings":settings,"positiveControlReceived":1,"blockedAttempts":3,
        "receivedAfterBlocking":count-1,"testOnlyTemporaryPositiveControl":true,"page":calls}),
    )
}
