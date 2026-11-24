//! Opt-in Windows PDF viewer/rendering acceptance with an owned local site.
use super::{
    engine::{native_privacy_tests::HiddenOwner, Bounds, NativeBrowserEngine},
    page_output::{capture, Format},
    policy::BrowserPolicy,
};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
};

use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings7, COREWEBVIEW2_PDF_TOOLBAR_ITEMS,
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_SEARCH, COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ZOOM_IN,
        COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ZOOM_OUT,
    },
};
use windows::core::{Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;

const DOCUMENT: &str = "/owned-inline-report";
const TAB: &str = "18e39725-d300-4841-b3f2-1564bbdb7ed7";
const BOUNDS: Bounds = Bounds {
    x: 0.0,
    y: 0.0,
    width: 800.0,
    height: 600.0,
};

fn pdf_fixture() -> Vec<u8> {
    // The colored block is deliberately off-center so the preview proves PDF rendering.
    let content = "0.89 0.13 0.63 rg\n56 174 142 86 re f\n0 0 0 rg\nBT /F1 16 Tf 35 280 Td (Studio reader fixture text) Tj ET\n";
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 340 340] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_owned(),
        format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        ),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
    ];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, entry) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        writeln!(pdf, "{} 0 obj\n{entry}\nendobj", index + 1).unwrap();
    }
    let xref = pdf.len();
    writeln!(pdf, "xref\n0 {}\n0000000000 65535 f ", objects.len() + 1).unwrap();
    for offset in offsets {
        writeln!(pdf, "{offset:010} 00000 n ").unwrap();
    }
    writeln!(
        pdf,
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF",
        objects.len() + 1
    )
    .unwrap();
    pdf
}

fn inline_pdf(publish_html: Arc<AtomicBool>) -> String {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(50);
        let pdf = pdf_fixture();
        let html = b"<!doctype html><title>HTML fixture, not the PDF</title><iframe src='/nested-pdf'></iframe>";
        while Instant::now() < deadline {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_millis(500)))
                .unwrap();
            let mut request = String::new();
            let mut reader = BufReader::new((&mut stream).take(4096));
            if reader.read_line(&mut request).is_err() {
                continue;
            }
            let (kind, body): (&str, &[u8]) = match request.split_ascii_whitespace().nth(1) {
                Some(DOCUMENT) if !publish_html.load(Ordering::Relaxed) => {
                    ("application/pdf", &pdf)
                }
                Some(DOCUMENT | "/page.pdf") => ("text/html", html),
                Some("/nested-pdf") => ("application/pdf", &pdf),
                _ => ("text/plain", b""),
            };
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Disposition: inline\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = stream.write_all(body);
        }
    });
    origin
}

fn wait<T>(label: &str, mut check: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(value) = check() {
            return value;
        }
        assert!(Instant::now() < deadline, "{label} timed out");
        unsafe {
            let mut message = MSG::default();
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn picture(view: &wry::WebView) -> Vec<u8> {
    let (sent, received) = mpsc::channel();
    capture(view, Format::Png, move |result| {
        let _ = sent.send(result);
    })
    .unwrap();
    wait("WebView2 PNG preview", || received.try_recv().ok()).unwrap()
}

fn marker_pixels(image: &[u8]) -> usize {
    image::load_from_memory(image)
        .unwrap()
        .to_rgb8()
        .pixels()
        .filter(|pixel| {
            let [red, green, blue] = pixel.0;
            (205..=245).contains(&red) && (15..=60).contains(&green) && (140..=185).contains(&blue)
        })
        .count()
}

fn probe_input(view: &wry::WebView, method: &str, args: serde_json::Value) {
    let (sent, received) = mpsc::channel();
    unsafe {
        view.webview().CallDevToolsProtocolMethod(
            &HSTRING::from(method),
            &HSTRING::from(args.to_string()),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, _| {
                let _ = sent.send(result);
                Ok(())
            })),
        )
    }
    .unwrap();
    wait("Fixture-only WebView2 input callback", || {
        received.try_recv().ok()
    })
    .unwrap();
}

fn toolbar_click(view: &wry::WebView, key: &str) -> bool {
    let Ok(coords) = std::env::var(key) else {
        return false;
    };
    let (x, y) = coords.split_once(',').unwrap();
    let (x, y): (u32, u32) = (x.parse().unwrap(), y.parse().unwrap());
    assert!(
        x < 800 && y < 150,
        "fixture clicks are restricted to the PDF toolbar"
    );
    for (kind, buttons) in [("mousePressed", 1), ("mouseReleased", 0)] {
        probe_input(
            view,
            "Input.dispatchMouseEvent",
            serde_json::json!({
                "type": kind, "x": x, "y": y, "button": "left", "buttons": buttons, "clickCount": 1
            }),
        );
    }
    true
}

#[test]
#[ignore = "Opt-in real WebView2 PDF classifier acceptance, hidden owner and one synthetic loopback site"]
fn native_pdf_viewer_classifies_only_the_current_committed_top_document() {
    let profile = tempfile::tempdir().unwrap();
    let publish_html = Arc::new(AtomicBool::new(false));
    let origin = inline_pdf(publish_html.clone());
    let url = format!("{origin}{DOCUMENT}");
    let owner = HiddenOwner::new();
    let mut engine = NativeBrowserEngine::new(
        profile.path().join("browser"),
        BrowserPolicy::isolated_probe(&origin).unwrap(),
        Arc::new(|_| {}),
    )
    .unwrap();
    engine
        .create(&owner, TAB, &url, BOUNDS, 1.0, false)
        .unwrap();
    engine.activate(Some(TAB), BOUNDS, false).unwrap();
    wait("actual top-level PDF committed MIME", || {
        engine.is_pdf_document(TAB).then_some(())
    });
    let view = engine.view(TAB).unwrap();
    let mut version = PWSTR::null();
    unsafe { view.environment().BrowserVersionString(&mut version) }.unwrap();
    println!(
        "Loaded WebView2 environment version: {}",
        take_pwstr(version)
    );
    let (bitmap, pixels) = wait("Rendered PDF marker pixels", || {
        let bitmap = picture(view);
        let pixels = marker_pixels(&bitmap);
        (pixels > 1500).then_some((bitmap, pixels))
    });
    println!("PDF document marker pixels {pixels}");
    if let Some(path) = std::env::var_os("STUDIO_PDF_VIEWER_TEST_CAPTURE") {
        std::fs::write(path, bitmap).unwrap();
    }

    let settings = unsafe { view.webview().Settings() }.unwrap();
    let pdf_toolbar = settings.cast::<ICoreWebView2Settings7>().unwrap();
    let mut hidden = COREWEBVIEW2_PDF_TOOLBAR_ITEMS::default();
    unsafe { pdf_toolbar.HiddenPdfToolbarItems(&mut hidden) }.unwrap();
    let reader_controls = COREWEBVIEW2_PDF_TOOLBAR_ITEMS_SEARCH.0
        | COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ZOOM_IN.0
        | COREWEBVIEW2_PDF_TOOLBAR_ITEMS_ZOOM_OUT.0;
    assert_eq!(hidden.0 & reader_controls, 0);

    if toolbar_click(view, "STUDIO_PDF_TEST_ZOOM_AT") {
        let zoomed = wait("Native PDF toolbar zoom pixels", || {
            let count = marker_pixels(&picture(view));
            (count > pixels * 11 / 10).then_some(count)
        });
        println!("PDF viewer toolbar zoom pixels: {pixels} -> {zoomed}");
    }
    if toolbar_click(view, "STUDIO_PDF_TEST_FIND_AT") {
        probe_input(
            view,
            "Input.insertText",
            serde_json::json!({ "text": "Studio reader fixture text" }),
        );
        let settle = Instant::now() + Duration::from_millis(650);
        wait("PDF reader search UI settles", || {
            (Instant::now() >= settle).then_some(())
        });
        let destination = std::env::var_os("STUDIO_PDF_TEST_FIND_CAPTURE").unwrap();
        std::fs::write(destination, picture(view)).unwrap();
    }
    let revision = engine.document_revision(TAB).unwrap();
    publish_html.store(true, Ordering::Relaxed);
    engine.action(TAB, "reload").unwrap();
    wait("same URL HTML navigation", || {
        (engine.export_ready(TAB) && engine.document_revision(TAB).ok().as_ref() != Some(&revision))
            .then_some(())
    });
    assert_eq!(view.url().unwrap(), url);
    assert!(!engine.is_pdf_document(TAB));

    let html = format!("{origin}/page.pdf");
    engine.navigate(TAB, &html).unwrap();
    wait("HTML navigation with PDF suffix and PDF iframe", || {
        (engine.export_ready(TAB) && view.url().ok().as_deref() == Some(html.as_str()))
            .then_some(())
    });
    assert!(!engine.is_pdf_document(TAB));
}
