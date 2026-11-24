//! Native acceptance with loopback pages and synthetic browser profiles.
use super::*;
use crate::browser::{
    engine::{native_privacy_tests::HiddenOwner, Bounds, EngineEvent, NativeBrowserEngine},
    policy::BrowserPolicy,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
};

const BOUNDS: Bounds = Bounds {
    x: 0.0,
    y: 0.0,
    width: 600.0,
    height: 400.0,
};

fn site() -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let addr = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline {
            if let Ok((mut stream, _)) = listener.accept() {
                stream
                    .set_read_timeout(Some(Duration::from_millis(500)))
                    .unwrap();
                let mut request = [0; 2048];
                let _ = stream.read(&mut request);
                let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: 2\r\n\r\nok");
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    format!("http://{addr}")
}

fn wait<T>(mut poll: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(value) = poll() {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "Native site permission callback timed out"
        );
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn open(
    owner: &HiddenOwner,
    path: &std::path::Path,
    origin: &str,
    emit: impl Fn(EngineEvent) + Send + Sync + 'static,
) -> (NativeBrowserEngine, String) {
    let mut engine = NativeBrowserEngine::new(
        path.to_owned(),
        BrowserPolicy::isolated_probe(origin).unwrap(),
        Arc::new(emit),
    )
    .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    engine
        .create(owner, &id, origin, BOUNDS, 1.0, false)
        .unwrap();
    wait(|| {
        engine
            .view(&id)
            .ok()?
            .url()
            .ok()
            .filter(|url| url.trim_end_matches('/') == origin)
    });
    (engine, id)
}
fn seed(view: &wry::WebView, origin: &str) {
    let (tx, rx) = mpsc::channel();
    let profile: ICoreWebView2Profile4 = unsafe {
        view.webview()
            .cast::<ICoreWebView2_13>()
            .unwrap()
            .Profile()
            .unwrap()
            .cast()
            .unwrap()
    };
    unsafe {
        profile
            .SetPermissionState(
                COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY,
                &HSTRING::from(origin),
                COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                &SetPermissionStateCompletedHandler::create(Box::new(move |status| {
                    let _ = tx.send(status);
                    Ok(())
                })),
            )
            .unwrap();
    }
    wait(|| rx.try_recv().ok()).unwrap();
}
fn action(view: &wry::WebView, origin: &str, action: SiteAction) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    run(view, origin, action, move |res| {
        let _ = tx.send(res);
    })?;
    wait(|| rx.try_recv().ok())
}
#[test]
#[ignore = "Explicit Windows WebView2 acceptance; private fixture, loopback only"]
fn remembered_autoplay_revocation_preserves_other_origin() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch/site-permissions-12")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("owner.txt"),
        "synthetic autoplay permission acceptance",
    )
    .unwrap();
    let profile = root.join("profile");
    let owner = HiddenOwner::new();
    let first = site();
    let neighbor = site();
    let kind = COREWEBVIEW2_PERMISSION_KIND_AUTOPLAY.0;
    let grant = json!([{"permission":kind,"allowed":true}]);
    let deny = json!([{"permission":kind,"allowed":false}]);
    {
        let (engine, id) = open(&owner, &profile, &first, |_| {});
        let view = engine.view(&id).unwrap();
        seed(view, &first);
        seed(view, &neighbor);
        assert_eq!(action(view, &first, SiteAction::List).unwrap(), grant);
    }
    {
        let (engine, id) = open(&owner, &profile, &first, |_| {});
        let view = engine.view(&id).unwrap();
        assert_eq!(action(view, &first, SiteAction::List).unwrap(), grant);
        assert!(action(
            view,
            &neighbor,
            SiteAction::Revoke {
                permission: kind,
                confirmed: true
            }
        )
        .is_err());
        assert!(action(
            view,
            &first,
            SiteAction::Revoke {
                permission: kind,
                confirmed: false
            }
        )
        .is_err());
        assert_eq!(action(view, &first, SiteAction::List).unwrap(), grant);
        action(
            view,
            &first,
            SiteAction::Revoke {
                permission: kind,
                confirmed: true,
            },
        )
        .unwrap();
        assert_eq!(action(view, &first, SiteAction::List).unwrap(), deny);
    }
    {
        let (engine, id) = open(&owner, &profile, &neighbor, |_| {});
        assert_eq!(
            action(engine.view(&id).unwrap(), &neighbor, SiteAction::List).unwrap(),
            grant
        );
    }
    let (engine, id) = open(&owner, &profile, &first, |_| {});
    assert_eq!(
        action(engine.view(&id).unwrap(), &first, SiteAction::List).unwrap(),
        deny
    );
}

#[test]
#[ignore = "Explicit Windows WebView2 acceptance; private fixture, loopback only"]
fn automatic_denial_stays_out_of_saved_site_permissions() {
    let root = tempfile::tempdir().unwrap();
    let profile = root.path().join("profile");
    let owner = HiddenOwner::new();
    let origin = site();
    let (send, blocked) = mpsc::channel();
    {
        let (engine, id) = open(&owner, &profile, &origin, move |event| {
            if let EngineEvent::PermissionBlocked { permission_kind, .. } = event {
                let _ = send.send(permission_kind);
            }
        });
        wait(|| engine.export_ready(&id).then_some(()));
        // Geolocation requests wait for a visible document. Show only the child
        // controller, under the hidden owner and without moving keyboard focus.
        engine.activate(Some(&id), BOUNDS, false).unwrap();
        let view = engine.view(&id).unwrap();
        let (send_state, state) = mpsc::channel();
        view.evaluate_script_with_callback(
            "({secure: isSecureContext, visible: document.visibilityState === 'visible'})",
            move |value| {
                let _ = send_state.send(value);
            },
        )
        .unwrap();
        let page: Value = serde_json::from_str(&wait(|| state.try_recv().ok())).unwrap();
        assert_eq!(page, json!({"secure":true,"visible":true}));
        assert_eq!(action(view, &origin, SiteAction::List).unwrap(), json!([]));
        view.evaluate_script("navigator.geolocation.getCurrentPosition(() => {}, () => {});")
            .unwrap();
        assert_eq!(
            wait(|| blocked.try_recv().ok()),
            COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION.0
        );
        assert_eq!(action(view, &origin, SiteAction::List).unwrap(), json!([]));
    }
    let (engine, id) = open(&owner, &profile, &origin, |_| {});
    assert_eq!(
        action(engine.view(&id).unwrap(), &origin, SiteAction::List).unwrap(),
        json!([])
    );
}
