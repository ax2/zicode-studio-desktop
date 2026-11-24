//! Native isolation checks for synthetic documents with two owned local fixtures.
use super::{
    engine::{native_privacy_tests::HiddenOwner, Bounds, NativeBrowserEngine},
    policy::BrowserPolicy,
};
use axum::{
    http::{header, StatusCode, Uri},
    Router,
};
use serde_json::Value;
use std::{
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tokio::sync::oneshot;
use webview2_com::{
    FrameCreatedEventHandler, FrameWebMessageReceivedEventHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2Frame2, ICoreWebView2_4},
    WebMessageReceivedEventHandler,
};
use windows::{
    core::Interface,
    Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    },
};
use wry::WebViewExtWindows;

const SCRIPT: &str = include_str!("native_boundary_fixture.js");
const ARMS: &[&str] = &["document", "frame", "sandboxed", "worker"];

struct Fixture {
    origin: String,
    paths: Arc<Mutex<Vec<String>>>,
    stop: Option<oneshot::Sender<()>>,
    server: Option<JoinHandle<()>>,
}

impl Fixture {
    fn start(blocked_origin: Option<&str>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let paths = Arc::new(Mutex::new(Vec::new()));
        let observed = paths.clone();
        let script = blocked_origin.map(|origin| {
            format!(
                "const blockedOrigin = {};\n{SCRIPT}",
                serde_json::to_string(origin).unwrap()
            )
        });
        let routes = Router::new().fallback(move |uri: Uri| {
            observed.lock().unwrap().push(uri.path().to_owned());
            let script = script.clone();
            async move {
                let (status, kind, body) = match (script, uri.path()) {
                    (None, _) => (StatusCode::OK, "text/plain", "owned excluded fixture".to_owned()),
                    (Some(_), "/" | "/frame" | "/sandboxed") => (
                        StatusCode::OK,
                        "text/html",
                        "<!doctype html><title>Owned fixture</title><body><script src='/check.js'></script></body>".to_owned(),
                    ),
                    (Some(script), "/check.js") => (StatusCode::OK, "text/javascript", script),
                    (Some(_), path) if path.starts_with("/ready/") => (StatusCode::OK, "text/plain", path.to_owned()),
                    _ => (StatusCode::NOT_FOUND, "text/plain", String::new()),
                };
                (status, [(header::CONTENT_TYPE, kind),
                    (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
                    (header::CACHE_CONTROL, "no-store")], body)
            }
        });
        let (stop, closed) = oneshot::channel();
        let server = thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async {
                    let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                    axum::serve(listener, routes)
                        .with_graceful_shutdown(async {
                            let _ = closed.await;
                        })
                        .await
                        .unwrap();
                });
        });
        Self {
            origin,
            paths,
            stop: Some(stop),
            server: Some(server),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(server) = self.server.take() {
            server.join().unwrap();
        }
    }
}

fn pump() {
    unsafe {
        let mut message = MSG::default();
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    thread::sleep(Duration::from_millis(10));
}

fn evaluate(view: &wry::WebView, script: &str) -> Value {
    let (sent, received) = mpsc::channel();
    view.evaluate_script_with_callback(script, move |value| {
        let _ = sent.send(value);
    })
    .unwrap();
    let end = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(result) = received.try_recv() {
            return serde_json::from_str(&result).unwrap();
        }
        assert!(Instant::now() < end, "WebView2 callback timed out");
        pump();
    }
}

#[test]
#[ignore = "Explicit Windows real-engine acceptance; hidden owned window and two synthetic loopback fixtures"]
fn native_browser_document_frames_and_worker_keep_the_web_boundary() {
    const TAB: &str = "f8bb2284-d184-46b6-90ab-4381058d5c2b";
    let profile = tempfile::tempdir().unwrap();
    let excluded = Fixture::start(None);
    let allowed = Fixture::start(Some(&excluded.origin));
    let owner = HiddenOwner::new();
    let mut engine = NativeBrowserEngine::new(
        profile.path().join("browser"),
        BrowserPolicy::isolated_probe(&allowed.origin).unwrap(),
        Arc::new(|_| {}),
    )
    .unwrap();
    engine
        .create(
            &owner,
            TAB,
            "about:blank",
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 600.0,
                height: 400.0,
            },
            1.0,
            false,
        )
        .unwrap();
    let view = engine.view(TAB).unwrap();
    let browser = view.webview();

    let roots = Arc::new(AtomicUsize::new(0));
    let frames = Arc::new(AtomicUsize::new(0));
    let observed_frames = Arc::new(AtomicUsize::new(0));
    let (mut root_token, mut frame_token) = (0, 0);
    let browser_frames = browser.cast::<ICoreWebView2_4>().unwrap();
    unsafe {
        let settings = browser.Settings().unwrap();
        let mut enabled = windows::core::BOOL::default();
        settings.IsWebMessageEnabled(&mut enabled).unwrap();
        assert!(!enabled.as_bool());
        settings.AreHostObjectsAllowed(&mut enabled).unwrap();
        assert!(!enabled.as_bool());
        let root_observer = roots.clone();
        browser
            .add_WebMessageReceived(
                &WebMessageReceivedEventHandler::create(Box::new(move |_, _| {
                    root_observer.fetch_add(1, Ordering::Relaxed);
                    Ok(())
                })),
                &mut root_token,
            )
            .unwrap();
        let frame_observer = frames.clone();
        let created = observed_frames.clone();
        browser_frames
            .add_FrameCreated(
                &FrameCreatedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let frame = args.Frame()?.cast::<ICoreWebView2Frame2>()?;
                        let received = frame_observer.clone();
                        let mut token = 0;
                        frame.add_WebMessageReceived(
                            &FrameWebMessageReceivedEventHandler::create(Box::new(move |_, _| {
                                received.fetch_add(1, Ordering::Relaxed);
                                Ok(())
                            })),
                            &mut token,
                        )?;
                        created.fetch_add(1, Ordering::Relaxed);
                    }
                    Ok(())
                })),
                &mut frame_token,
            )
            .unwrap();
    }
    engine.navigate(TAB, &allowed.origin).unwrap();
    let view = engine.view(TAB).unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    let report = loop {
        let report = evaluate(view, "globalThis.boundaryReport ?? null");
        if !report.is_null() {
            break report;
        }
        assert!(Instant::now() < deadline, "fixture contexts did not report");
        pump();
    };
    println!("Browser context observations: {report}");
    assert_eq!(report.as_object().unwrap().len(), ARMS.len());
    for arm in ARMS {
        let result = &report[*arm];
        assert_eq!(result["ordinary"], format!("/ready/{arm}"), "{arm}");
        assert_eq!(result["studioGlobals"], false, "{arm}");
        assert_eq!(result["excluded"], true, "{arm}");
    }
    assert_eq!(report["document"]["origin"], allowed.origin);
    assert_eq!(report["sandboxed"]["origin"], "null");
    assert_eq!(report["frame"]["origin"], allowed.origin);
    assert_eq!(report["worker"]["origin"], allowed.origin);
    let paths = allowed.paths.lock().unwrap();
    for arm in ARMS {
        assert!(paths.contains(&format!("/ready/{arm}")), "{arm}");
    }
    println!("Owned allowed HTTP receipt: {paths:?}");
    drop(paths);
    assert_eq!(observed_frames.load(Ordering::Relaxed), 2);
    assert_eq!(roots.load(Ordering::Relaxed), 0);
    assert_eq!(frames.load(Ordering::Relaxed), 0);
    assert!(excluded.paths.lock().unwrap().is_empty());
    println!("Native WebMessage: document 0, observed frame contexts 2, frame messages 0; excluded HTTP 0");
    unsafe {
        browser.remove_WebMessageReceived(root_token).unwrap();
        browser_frames.remove_FrameCreated(frame_token).unwrap();
    }
    engine.destroy(TAB).unwrap();
}
