//! Native WebView2 route acceptance. Every response comes from an owned local socket.
use super::{
    engine::{native_privacy_tests::HiddenOwner, Bounds, NativeBrowserEngine},
    policy::BrowserPolicy,
    proxy_endpoint::HttpProxy,
};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
};

const HTTP: &str = "http://studio-proxy-fixture.example:7080/proxy-check";
const HTTPS: &str = "https://studio-proxy-fixture.example:7443/proxy-check";
const HTTP_REQUEST: &str = "GET http://studio-proxy-fixture.example:7080/proxy-check HTTP/";
const HTTPS_REQUEST: &str = "CONNECT studio-proxy-fixture.example:7443 HTTP/";
const TAB: &str = "8c34cc94-c30b-49f9-9303-2debddfe8412";
const BOUNDS: Bounds = Bounds {
    x: 0.0,
    y: 0.0,
    width: 600.0,
    height: 400.0,
};

fn wait<T>(mut poll: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(value) = poll() {
            return value;
        }
        assert!(Instant::now() < deadline, "Native proxy callback timed out");
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn fixture() -> (HttpProxy, mpsc::Receiver<String>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let proxy = HttpProxy::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    listener.set_nonblocking(true).unwrap();
    let (sent, received) = mpsc::channel();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(45);
        while Instant::now() < deadline {
            if let Ok((mut stream, _)) = listener.accept() {
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_millis(500)))
                    .unwrap();
                let mut first_line = String::new();
                let _ = BufReader::new((&mut stream).take(4096)).read_line(&mut first_line);
                let response = if first_line.starts_with(HTTP_REQUEST) {
                    let body = "<!doctype html><title>Owned proxy fixture</title>";
                    format!(
                        "HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: {}
Connection: close

{body}",
                        body.len()
                    )
                } else {
                    // Observe the HTTPS tunnel request without intercepting TLS or forwarding it.
                    "HTTP/1.1 502 Fixture
Content-Length: 0
Connection: close

"
                    .into()
                };
                let _ = stream.write_all(response.as_bytes());
                if sent.send(first_line).is_err() {
                    return;
                }
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    (proxy, received)
}

#[test]
#[ignore = "Explicit Windows WebView2 acceptance; hidden owned window and local synthetic proxy only"]
fn native_browser_routes_http_and_https_connect_through_configured_proxy() {
    let profile = tempfile::tempdir().unwrap();
    let (proxy, requests) = fixture();
    let owner = HiddenOwner::new();
    let mut engine = NativeBrowserEngine::new(
        profile.path().join("browser"),
        BrowserPolicy::public_web(),
        Arc::new(|_| {}),
    )
    .unwrap();
    engine.http_proxy = Some(proxy);
    engine
        .create(&owner, TAB, HTTP, BOUNDS, 1.0, false)
        .unwrap();
    let http = wait(|| {
        requests
            .try_iter()
            .find(|line| line.starts_with(HTTP_REQUEST))
    });
    assert!(http.starts_with(HTTP_REQUEST));
    wait(|| engine.export_ready(TAB).then_some(()));
    let (sent, received) = mpsc::channel();
    engine
        .view(TAB)
        .unwrap()
        .evaluate_script_with_callback("document.title", move |value| {
            let _ = sent.send(value);
        })
        .unwrap();
    let title = wait(|| received.try_recv().ok());
    assert_eq!(
        serde_json::from_str::<String>(&title).unwrap(),
        "Owned proxy fixture"
    );

    assert!(engine.navigate(TAB, "http://127.0.0.1:81/private").is_err());
    assert!(engine
        .navigate(TAB, "http://user:pass@studio-proxy-fixture.example/")
        .is_err());
    engine.navigate(TAB, HTTPS).unwrap();
    let https = wait(|| {
        requests
            .try_iter()
            .find(|line| line.starts_with(HTTPS_REQUEST))
    });
    assert!(https.starts_with(HTTPS_REQUEST));
    println!("Real WebView2 reached the owned proxy with HTTP and HTTPS CONNECT");
}
