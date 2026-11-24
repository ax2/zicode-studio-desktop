//! Only the built-in PDF viewer belonging to this synthetic, hidden tab is driven.
use super::{
    inline_pdf, marker_pixels, pdf_fixture, picture, serve_inline_pdf, wait, BOUNDS, DOCUMENT, TAB,
};
use crate::browser::{
    engine::{native_privacy_tests::HiddenOwner, NativeBrowserEngine},
    policy::BrowserPolicy,
};
use serde_json::{json, Value};
use std::{
    sync::{atomic::AtomicBool, mpsc, Arc},
    time::{Duration, Instant},
};
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::ICoreWebView2_11,
};
use windows::core::{Interface, HSTRING, PWSTR};
use wry::WebViewExtWindows;

const READER_URL: &str = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/edge_pdf/index.html";

fn call(view: &wry::WebView, session: Option<&str>, method: &str, params: Value) -> Value {
    let (sent, received) = mpsc::channel();
    let handler =
        CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, body| {
            let _ = sent.send(status.map(|()| body));
            Ok(())
        }));
    let native = view.webview();
    let (name, params) = (HSTRING::from(method), HSTRING::from(params.to_string()));
    unsafe {
        if let Some(session) = session {
            native
                .cast::<ICoreWebView2_11>()
                .unwrap()
                .CallDevToolsProtocolMethodForSession(
                    &HSTRING::from(session),
                    &name,
                    &params,
                    &handler,
                )
        } else {
            native.CallDevToolsProtocolMethod(&name, &params, &handler)
        }
    }
    .unwrap_or_else(|error| panic!("{method}: {error}"));
    let body = wait(method, || received.try_recv().ok())
        .unwrap_or_else(|error| panic!("{method}: {error}"));
    serde_json::from_str(&body).unwrap()
}

fn owned_reader(view: &wry::WebView, url: &str) -> String {
    let root = call(view, None, "Target.getTargetInfo", json!({}));
    let root = &root["targetInfo"];
    assert_eq!(root["url"], url);
    assert!(root["targetId"].is_string() && root["browserContextId"].is_string());
    let target = wait("owned PDF reader target", || {
        let candidates = call(view, None, "Target.getTargets", json!({"filter":[{}]}));
        let owned: Vec<_> = candidates["targetInfos"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["browserContextId"] == root["browserContextId"])
            .collect();
        let reader: Vec<_> = owned
            .iter()
            .filter(|item| {
                item["type"] == "webview"
                    && item["parentId"] == root["targetId"]
                    && item["url"] == READER_URL
                    && owned.iter().any(|child| {
                        child["type"] == "iframe"
                            && child["url"] == url
                            && child["parentId"] == item["targetId"]
                    })
            })
            .collect();
        assert!(
            reader.len() <= 1,
            "ambiguous built-in reader for the test document"
        );
        reader.first()?.get("targetId")?.as_str().map(str::to_owned)
    });
    let reply = call(
        view,
        None,
        "Target.attachToTarget",
        json!({"targetId":target,"flatten":true}),
    );
    reply["sessionId"].as_str().unwrap().to_owned()
}

fn toolbar_position(view: &wry::WebView, session: &str, id: &str) -> Option<[u32; 2]> {
    let expression = r#"((id) => {
        function find(root) {
            const local = root.getElementById(id);
            if (local) return local;
            for (const element of root.querySelectorAll('*')) {
                if (element.shadowRoot) {
                    const nested = find(element.shadowRoot);
                    if (nested) return nested;
                }
            }
            return null;
        }
        if (!document.body) return null;
        const control = find(document);
        if (!control?.matches('button,input') || control.disabled) return null;
        const bounds = control.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) return null;
        const x = Math.round(bounds.x + bounds.width / 2);
        const y = Math.round(bounds.y + bounds.height / 2);
        if (!control.contains(control.getRootNode().elementFromPoint(x, y))) return null;
        return [x, y];
    })(__ID__)"#
        .replace("__ID__", &serde_json::to_string(id).unwrap());
    let reply = call(
        view,
        Some(session),
        "Runtime.evaluate",
        json!({ "expression":expression,"returnByValue":true }),
    );
    serde_json::from_value(reply["result"]["value"].clone()).ok()
}

fn click_toolbar(view: &wry::WebView, session: &str, [x, y]: [u32; 2]) {
    assert!(x < 800 && y < 80, "control is not inside the test toolbar");
    call(
        view,
        Some(session),
        "Input.dispatchMouseEvent",
        json!({
            "type":"mouseMoved","x":x,"y":y,
        }),
    );
    for (kind, buttons) in [("mousePressed", 1), ("mouseReleased", 0)] {
        call(
            view,
            Some(session),
            "Input.dispatchMouseEvent",
            json!({
                "type":kind,"x":x,"y":y,"button":"left","buttons":buttons,"clickCount":1,
            }),
        );
    }
}

fn stable_marker(view: &wry::WebView, label: &str, accept: impl Fn(usize) -> bool) -> usize {
    let (mut stable_since, mut previous) = (Instant::now(), 0);
    wait(label, || {
        let count = marker_pixels(&picture(view));
        if count != previous {
            previous = count;
            stable_since = Instant::now();
            println!("{label}: observed {count} pixels");
        }
        (accept(count) && stable_since.elapsed() >= Duration::from_millis(400)).then_some(count)
    })
}

#[test]
#[ignore = "Opt-in real WebView2 built-in PDF zoom, requires the Edge PDF reader target"]
fn native_pdf_toolbar_zoom_changes_and_restores_rendered_pixels() {
    let profile = tempfile::tempdir().unwrap();
    let origin = inline_pdf(Arc::new(AtomicBool::new(false)));
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
    wait("owned PDF loaded", || {
        engine.is_pdf_document(TAB).then_some(())
    });
    let view = engine.view(TAB).unwrap();
    let mut version = PWSTR::null();
    unsafe { view.environment().BrowserVersionString(&mut version) }.unwrap();
    println!("WebView2 {}", take_pwstr(version));

    wait("painted PDF toolbar", || {
        let preview = picture(view);
        let pixels = image::load_from_memory(&preview).unwrap().to_rgb8();
        assert_eq!(pixels.dimensions(), (800, 600));
        let dark = (3..33)
            .flat_map(|y| (250..640).map(move |x| (x, y)))
            .filter(|(x, y)| {
                pixels
                    .get_pixel(*x, *y)
                    .0
                    .iter()
                    .all(|channel| *channel < 140)
            })
            .count();
        (dark > 40).then_some(())
    });
    let reader = owned_reader(view, &url);
    let baseline = stable_marker(view, "rendered PDF marker", |count| count > 1500);
    let zoom_in = wait("visible PDF zoom-in button", || {
        toolbar_position(view, &reader, "zoom-in")
    });
    println!("Click the PDF reader zoom-in button at {zoom_in:?}");
    click_toolbar(view, &reader, zoom_in);
    let enlarged = stable_marker(view, "enlarged PDF marker", |count| {
        count > baseline * 11 / 10
    });
    let zoom_out = wait("visible PDF zoom out after enlargement", || {
        toolbar_position(view, &reader, "zoom-out")
    });
    println!("Click the PDF reader zoom-out button at {zoom_out:?}");
    click_toolbar(view, &reader, zoom_out);
    let restored = stable_marker(view, "restored PDF marker", |count| {
        count.abs_diff(baseline) <= baseline / 100
    });
    println!("PDF zoom in {zoom_in:?}, out {zoom_out:?}: {baseline} -> {enlarged} -> {restored} marker pixels");
}

fn select_page(view: &wry::WebView, reader: &str, number: u8) {
    let selector = wait("visible PDF page selector", || {
        toolbar_position(view, reader, "pageselector")
    });
    click_toolbar(view, reader, selector);

    for kind in ["keyDown", "keyUp"] {
        call(
            view,
            Some(reader),
            "Input.dispatchKeyEvent",
            json!({"type":kind, "key":"a", "code":"KeyA", "modifiers":2,
                "windowsVirtualKeyCode":65, "nativeVirtualKeyCode":65, "commands":["selectAll"]}),
        );
    }
    call(
        view,
        Some(reader),
        "Input.insertText",
        json!({"text":number.to_string()}),
    );
    let entered = call(
        view,
        Some(reader),
        "Runtime.evaluate",
        json!({
            "expression": r#"(() => {
            let focused = document.activeElement;
            while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
            return focused?.id === 'pageselector' ? focused.value : null;
        })()"#,
            "returnByValue": true
        }),
    );
    assert_eq!(entered["result"]["value"], number.to_string());
    call(
        view,
        Some(reader),
        "Input.dispatchKeyEvent",
        json!({"type":"keyDown", "key":"Enter", "code":"Enter", "text":"\r",
            "windowsVirtualKeyCode":13, "nativeVirtualKeyCode":13}),
    );
    call(
        view,
        Some(reader),
        "Input.dispatchKeyEvent",
        json!({"type":"keyUp", "key":"Enter", "code":"Enter",
            "windowsVirtualKeyCode":13, "nativeVirtualKeyCode":13}),
    );
}

fn page_marker(view: &wry::WebView, page: u8) -> usize {
    // Compare channel relationships so the proof survives PDF color management.
    let pixels = image::load_from_memory(&picture(view)).unwrap().to_rgb8();
    (90..400)
        .flat_map(|y| (150..650).map(move |x| (x, y)))
        .filter(|(x, y)| {
            let [r, g, b] = pixels.get_pixel(*x, *y).0.map(i16::from);
            match page {
                1 => r - g > 90 && b - g > 75,
                2 => g - r > 45 && g - b > 45,
                3 => b - r > 75 && b - g > 75,
                _ => unreachable!(),
            }
        })
        .count()
}

#[test]
#[ignore = "Opt-in real WebView2 built-in PDF page selection, requires the Edge PDF reader target"]
fn native_pdf_page_selector_jumps_to_the_requested_document_page() {
    const COLORS: [&str; 3] = ["0.89 0.13 0.63", "0.12 0.67 0.31", "0.16 0.29 0.88"];
    let profile = tempfile::tempdir().unwrap();
    let origin = serve_inline_pdf(pdf_fixture(&COLORS), Arc::new(AtomicBool::new(false)));
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
    wait("owned three-page PDF loaded", || {
        engine.is_pdf_document(TAB).then_some(())
    });
    let view = engine.view(TAB).unwrap();
    let mut version = PWSTR::null();
    unsafe { view.environment().BrowserVersionString(&mut version) }.unwrap();
    println!("WebView2 {}", take_pwstr(version));
    let reader = owned_reader(view, &url);

    for (step, page) in [1, 3, 2, 1].into_iter().enumerate() {
        if step > 0 {
            select_page(view, &reader, page);
        }
        println!("Waiting for requested PDF page {page}");
        let pixels = wait("requested PDF page rendered", || {
            let count = page_marker(view, page);
            (count > 8_000).then_some(count)
        });
        println!("PDF page {page}: {pixels} matching marker pixels");
        assert_eq!(view.url().unwrap(), url);
    }
}
