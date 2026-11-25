//! Windows-only HTTPS proxy acceptance with local sockets and a fresh test certificate.
use super::{BOUNDS, HTTPS, HTTPS_REQUEST, TAB, wait};
use crate::browser::{
    engine::{NativeBrowserEngine, native_privacy_tests::HiddenOwner},
    policy::BrowserPolicy,
    proxy_endpoint::HttpProxy,
};
use rustls::{
    ServerConfig, ServerConnection, StreamOwned,
    pki_types::{CertificateDer, PrivatePkcs8KeyDer, pem::PemObject},
};
use std::{
    io::{self, BufRead, BufReader, Read, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream},
    sync::{Arc, mpsc},
    thread,
    time::{Duration, Instant},
};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
        COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL, ICoreWebView2_14,
    },
    ServerCertificateErrorDetectedEventHandler, take_pwstr,
};
use windows::core::{Interface, PWSTR};
use wry::WebViewExtWindows;

const HOST: &str = "studio-proxy-fixture.example";
const REQUEST: &str = "GET /proxy-check HTTP/1.1";
const TITLE: &str = "Local HTTPS through Studio proxy";
const IO_TIMEOUT: Duration = Duration::from_secs(10);

fn headers(stream: &mut impl Read) -> io::Result<String> {
    // The CONNECT parser must leave any subsequent TLS bytes in the stream.
    let mut reader = BufReader::with_capacity(1, stream.take(4096));
    let mut first = String::new();
    reader.read_line(&mut first)?;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line)? {
            0 => return Err(io::ErrorKind::UnexpectedEof.into()),
            _ if line == "\r\n" => return Ok(first.trim_end().to_owned()),
            _ => {}
        }
    }
}

fn bounded(stream: &TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))
}

fn connections(listener: TcpListener, mut handle: impl FnMut(TcpStream) -> bool) {
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((socket, _)) => {
                if !handle(socket) {
                    return;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("Local TLS test could not accept a connection: {error}"),
        }
    }
}
fn local_origin() -> (SocketAddr, CertificateDer<'static>, mpsc::Receiver<String>) {
    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(vec![HOST.to_owned()]).unwrap();
    let der = cert.der().clone();
    let config = Arc::new(
        ServerConfig::builder_with_provider(
            Arc::new(rustls::crypto::aws_lc_rs::default_provider()),
        )
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![der.clone()],
            PrivatePkcs8KeyDer::from(signing_key.serialize_der()).into(),
        )
        .unwrap(),
    );
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let endpoint = listener.local_addr().unwrap();
    let (observed, requests) = mpsc::channel();
    thread::spawn(move || {
        connections(listener, |stream| {
            if bounded(&stream).is_err() {
                return true;
            }
            let connection = ServerConnection::new(config.clone()).unwrap();
            let mut tls = StreamOwned::new(connection, stream);
            if headers(&mut tls).as_deref().ok() != Some(REQUEST) {
                return true;
            }
            assert_eq!(tls.conn.server_name(), Some(HOST));
            let page =
                format!("<!doctype html><title>{TITLE}</title><main>owned TLS endpoint</main>");
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                page.len()
            );
            tls.write_all(reply.as_bytes()).unwrap();
            tls.conn.send_close_notify();
            tls.flush().unwrap();
            let _ = observed.send(REQUEST.to_owned());
            false
        });
    });
    (endpoint, der, requests)
}

fn local_proxy(origin: SocketAddr) -> (HttpProxy, mpsc::Receiver<String>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let proxy = HttpProxy::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
    let (observed, requests) = mpsc::channel();
    thread::spawn(move || {
        connections(listener, |stream| {
            let observed = observed.clone();
            thread::spawn(move || -> io::Result<()> {
                let mut client = stream;
                bounded(&client)?;
                let request = headers(&mut client)?;
                if !request.starts_with(HTTPS_REQUEST) {
                    return client.write_all(b"HTTP/1.1 502 Test fixture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                }
                // The request cannot choose a forwarding destination. Only the owned TLS origin is reachable.
                let mut upstream = TcpStream::connect_timeout(&origin, IO_TIMEOUT)?;
                bounded(&upstream)?;
                client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")?;
                let _ = observed.send(request);
                let (mut input, mut output) = (client.try_clone()?, upstream.try_clone()?);
                thread::spawn(move || {
                    let _ = io::copy(&mut input, &mut output);
                    let _ = output.shutdown(Shutdown::Write);
                });
                io::copy(&mut upstream, &mut client)?;
                client.shutdown(Shutdown::Write)
            });
            true
        });
    });
    (proxy, requests)
}

#[test]
#[ignore = "Explicit Windows WebView2 verification with two owned local sockets and a disposable profile"]
fn native_browser_loads_https_document_through_established_proxy_tunnel() {
    let scratch = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    std::fs::create_dir_all(&scratch).unwrap();
    let profile = tempfile::Builder::new()
        .prefix("https-proxy-")
        .tempdir_in(scratch)
        .unwrap();
    let (origin, certificate, origin_requests) = local_origin();
    let (proxy, proxy_requests) = local_proxy(origin);
    let owner = HiddenOwner::new();
    let mut engine = NativeBrowserEngine::new(
        profile.path().join("browser"),
        BrowserPolicy::public_web(),
        Arc::new(|_| {}),
    )
    .unwrap();
    engine.http_proxy = Some(proxy);
    engine
        .create(&owner, TAB, "about:blank", BOUNDS, 1.0, false)
        .unwrap();

    let core = engine
        .view(TAB)
        .unwrap()
        .webview()
        .cast::<ICoreWebView2_14>()
        .unwrap();
    let (trust, trusted) = mpsc::channel();
    // This one disposable WebView may accept only the exact generated leaf for the exact fixture URL.
    // System stores and the production certificate policy are untouched.
    let handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        unsafe {
            let mut uri = PWSTR::null();
            args.RequestUri(&mut uri)?;
            let mut pem = PWSTR::null();
            args.ServerCertificate()?.ToPemEncoding(&mut pem)?;
            let leaf = CertificateDer::from_pem_slice(take_pwstr(pem).as_bytes());
            let allowed = take_pwstr(uri) == HTTPS && leaf.as_ref().ok() == Some(&certificate);
            args.SetAction(if allowed {
                COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW
            } else {
                COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_CANCEL
            })?;
            if allowed {
                let _ = trust.send(());
            }
        }
        Ok(())
    }));
    let mut token = 0;
    unsafe { core.add_ServerCertificateErrorDetected(&handler, &mut token) }.unwrap();

    engine.navigate(TAB, HTTPS).unwrap();
    let connect = wait(|| proxy_requests.try_recv().ok());
    assert!(connect.starts_with(HTTPS_REQUEST));
    wait(|| trusted.try_recv().ok());
    assert_eq!(wait(|| origin_requests.try_recv().ok()), REQUEST);
    wait(|| engine.export_ready(TAB).then_some(()));
    let (result, page) = mpsc::channel();
    engine
        .view(TAB)
        .unwrap()
        .evaluate_script_with_callback(
            "({title:document.title,url:location.href,body:document.body.innerText})",
            move |value| {
                let _ = result.send(value);
            },
        )
        .unwrap();
    let page: serde_json::Value = serde_json::from_str(&wait(|| page.try_recv().ok())).unwrap();
    assert_eq!(
        page,
        serde_json::json!({"title": TITLE, "url": HTTPS, "body": "owned TLS endpoint"})
    );
    assert_eq!(engine.view(TAB).unwrap().url().unwrap(), HTTPS);
    unsafe { core.remove_ServerCertificateErrorDetected(token) }.unwrap();
    println!("Owned proxy forwarded TLS to the fixture origin; WebView2 rendered {HTTPS}");
}
