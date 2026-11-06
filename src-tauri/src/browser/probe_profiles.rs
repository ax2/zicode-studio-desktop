use super::{
    engine::{Bounds, NativeBrowserEngine},
    evaluate,
    policy::BrowserPolicy,
    require, ui, wait_page, A, ENGINE, SHELL,
};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Manager};
use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::ICoreWebView2_13};
use windows::core::{Interface, PWSTR};
use wry::WebViewExtWindows;

pub fn verify(app: &AppHandle, root: &Path, origin: &str, phase: &str) -> Result<Value, String> {
    let receipt = root.join("peer-profile.json");
    let peer = if phase == "first" {
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(&receipt, serde_json::to_vec(&json!({"id":id})).unwrap())
            .map_err(|e| e.to_string())?;
        id
    } else {
        let stored: Value =
            serde_json::from_slice(&std::fs::read(&receipt).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let id = stored["id"].as_str().ok_or("Missing owned peer profile")?;
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid owned peer profile")?;
        require(parsed.to_string() == id, "Invalid peer profile identity")?;
        id.to_string()
    };
    let profile = root.join("profiles").join(peer);
    let profile_copy = profile.clone();
    let origin = origin.to_string();
    ui(app, move |app| {
        let parent = app
            .get_webview_window(SHELL)
            .ok_or("Missing Studio shell")?;
        let mut engine = NativeBrowserEngine::new(
            profile_copy,
            BrowserPolicy::isolated_probe(&origin)?,
            Arc::new(|_| {}),
        )?;
        engine.create(
            &parent,
            A,
            &format!("{origin}/a"),
            Bounds {
                x: 48.0,
                y: 96.0,
                width: 640.0,
                height: 400.0,
            },
            1.0, false,
        )?;
        ENGINE.with(|slot| *slot.borrow_mut() = Some(engine));
        Ok(())
    })?;
    wait_page(app, A, "Browser fixture A")?;
    let before = evaluate(
        app,
        A,
        "({cookie:document.cookie,storage:localStorage.getItem('browser_probe')})",
    )?;
    if phase == "first" {
        require(
            before["cookie"] == "" && before["storage"].is_null(),
            "New profile shares the default profile's data",
        )?;
    } else {
        require(
            before["cookie"]
                .as_str()
                .unwrap_or("")
                .contains("browser_probe=isolated-peer")
                && before["storage"] == "isolated-peer",
            "Peer profile did not preserve its separate site data",
        )?;
    }
    let saved = evaluate(app,A,"(document.cookie='browser_probe=isolated-peer; Max-Age=86400; SameSite=Lax; Path=/',localStorage.setItem('browser_probe','isolated-peer'),({cookie:document.cookie,storage:localStorage.getItem('browser_probe')}))")?;
    let native = ui(app, |_| {
        ENGINE.with(|slot| {
            let slot = slot.borrow();
            let engine = slot.as_ref().ok_or("Missing peer engine")?;
            unsafe {
                let profile = engine
                    .view(A)?
                    .webview()
                    .cast::<ICoreWebView2_13>()
                    .and_then(|web| web.Profile())
                    .map_err(|e| e.to_string())?;
                let mut private = windows::core::BOOL::default();
                profile
                    .IsInPrivateModeEnabled(&mut private)
                    .map_err(|e| e.to_string())?;
                let mut path = PWSTR::null();
                profile.ProfilePath(&mut path).map_err(|e| e.to_string())?;
                require(
                    !private.as_bool(),
                    "Durability probe unexpectedly uses private mode",
                )?;
                Ok(json!({"private":private.as_bool(),"profilePath":take_pwstr(path)}))
            }
        })
    })?;
    ui(app, |_| {
        ENGINE.with(|slot| {
            *slot.borrow_mut() = None;
            Ok(())
        })
    })?;
    Ok(
        json!({"profile":profile,"before":before,"saved":saved,"native":native,"isolatedFromDefault":true}),
    )
}
