//! Opt-in integration through the real Windows Studio Host and native browser.
use super::*;
use crate::{
    browser::{
        capture::{self, browser_capture_page, Script},
        image_ocr::{browser_preview_image, ImageTarget},
    },
    host_server::HostServer,
    metadata_store::MetadataStore,
    native_pi_manager::NativePiManager,
    remote_auth::RemoteAuth,
};
use axum::{http::header, response::Html, routing::get, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage};
use std::{path::Path, sync::Mutex, time::Duration};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_3, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS,
};
use windows::core::{Interface, HSTRING};
use wry::WebViewExtWindows;

const OWNER: &str = "native-workspace-browser-image-test";
const TAB: &str = "5ac72386-4ce1-45a0-863f-268ee4dababe";
const FOREIGN_HOST: &str = "owned-studio-fixture.example";
const VIEWPORT: Bounds = Bounds {
    x: 0.0,
    y: 0.0,
    width: 760.0,
    height: 510.0,
};
const PIXEL: [u8; 3] = [21, 78, 149];
const COUNTERS: &str = r#"(() => {
    const counters = globalThis.studioOwnedFixtureCounters = {draw: 0, png: 0};
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    const png = HTMLCanvasElement.prototype.toDataURL;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        counters.draw++;
        return draw.apply(this, args);
    };
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
        counters.png++;
        return png.apply(this, args);
    };
    return counters;
})()"#;

async fn bind() -> tokio::net::TcpListener {
    tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap()
}

async fn fixture_server(foreign_directory: &Path) -> String {
    let mut png = std::io::Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(RgbImage::from_pixel(12, 9, Rgb(PIXEL)))
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
    let png = png.into_inner();
    std::fs::create_dir(foreign_directory).unwrap();
    std::fs::write(foreign_directory.join("foreign.png"), &png).unwrap();
    let foreign_url = format!("https://{FOREIGN_HOST}/foreign.png");
    let main = bind().await;
    let origin = format!("http://{}", main.local_addr().unwrap());
    let document = format!(
        r#"<!doctype html><title>Owned image fixture</title><main>
        <p>Local image provenance, no remote content.</p>
        <img id="first" alt="First" src="/pixels.png">
        <img id="second" alt="Second" src="/pixels.png">
        <img alt="Foreign" src="{foreign_url}">
        </main>"#
    );
    let pages = Router::new()
        .route("/", get(move || async move { Html(document) }))
        .route(
            "/pixels.png",
            get(move || async move { ([(header::CONTENT_TYPE, "image/png")], png) }),
        )
        .route(
            "/later",
            get(|| async { Html("<title>Later</title><p>Later document</p>") }),
        );
    tauri::async_runtime::spawn(async move { axum::serve(main, pages).await.unwrap() });
    origin
}

async fn navigate(window: &WebviewWindow, url: String) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let owner = window.label().to_owned();
    window
        .app_handle()
        .run_on_main_thread(move || {
            let result = WINDOWS.with(|slot| {
                slot.with_mut(|windows| windows.get(&owner).unwrap().engine.navigate(TAB, &url))
            });
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

async fn world(window: &WebviewWindow, url: &str, source: &str) -> Result<Value, String> {
    capture::run(
        window.clone(),
        TAB.to_owned(),
        url.to_owned(),
        None,
        Script::Isolated {
            source: source.to_owned(),
            fallback: None,
        },
        |raw, _| serde_json::from_str(raw).map_err(|error| error.to_string()),
    )
    .await
    .map(|value| value.page)
}

fn target(capture: &Value, image: &Value) -> ImageTarget {
    serde_json::from_value(json!({
        "tab": TAB,
        "expectedUrl": capture["page"]["url"],
        "expectedRevision": capture["documentRevision"],
        "image": image,
    }))
    .unwrap()
}

async fn preview(
    window: &WebviewWindow,
    capture: &Value,
    image: &Value,
    confirmed: bool,
) -> Result<Value, String> {
    let receipt = browser_preview_image(window.clone(), target(capture, image), confirmed).await?;
    serde_json::to_value(receipt).map_err(|error| error.to_string())
}

async fn run_fixture(window: WebviewWindow, url: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let host_origin = window.state::<HostServer>().origin().to_owned();
    let health: Value = client
        .get(format!("{host_origin}/health"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    assert_eq!(health["status"], "ok");
    assert_eq!(health["lanAccessEnabled"], false);
    let command = || browser_capture_page(window.clone(), TAB.to_owned(), url.clone());
    let page = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(snapshot) = command().await {
                if snapshot.page.images.len() == 3
                    && snapshot
                        .page
                        .images
                        .iter()
                        .all(|image| image.locator.is_some())
                {
                    break serde_json::to_value(snapshot).unwrap();
                }
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .map_err(|_| "The three owned images did not enter the Studio capture")?;
    assert_eq!(page["sourceTrust"], "untrusted-web-content");
    let [a, b, foreign] = page["page"]["images"].as_array().unwrap().as_slice() else {
        unreachable!()
    };
    assert_eq!(a["alt"], "First");
    assert_eq!(b["alt"], "Second");
    assert_eq!(a["url"], b["url"]);
    assert_eq!(a["width"], b["width"]);
    assert_ne!(a["locator"], b["locator"]);

    assert_eq!(
        world(&window, &url, COUNTERS).await?,
        json!({"draw":0,"png":0})
    );
    let counters = || world(&window, &url, "globalThis.studioOwnedFixtureCounters");
    let refused = preview(&window, &page, a, false).await.unwrap_err();
    assert_eq!(refused, "Choose an image to preview first.");
    assert_eq!(counters().await?, json!({"draw":0,"png":0}));

    world(&window, &url, "(() => { document.querySelector('#first').replaceWith(document.querySelector('#first').cloneNode()); return true; })()").await?;
    let stale = preview(&window, &page, a, true).await.unwrap_err();
    assert!(stale.contains("This image changed"), "{stale}");
    assert_eq!(counters().await?, json!({"draw":0,"png":0}));

    let accepted = preview(&window, &page, b, true).await?;
    assert_eq!(counters().await?, json!({"draw":1,"png":1}));
    assert_eq!(accepted["source"]["alt"], "Second");
    assert_eq!(accepted["source"]["url"], b["url"]);
    assert_eq!(accepted["pageUrl"], url);
    assert_eq!(accepted["documentRevision"], page["documentRevision"]);
    assert!(accepted["source"].get("locator").is_none());
    assert!(chrono::DateTime::parse_from_rfc3339(accepted["capturedAt"].as_str().unwrap()).is_ok());
    let bytes = STANDARD
        .decode(accepted["pngBase64"].as_str().unwrap())
        .unwrap();
    let pixels = image::load_from_memory_with_format(&bytes, ImageFormat::Png).unwrap();
    assert_eq!(pixels.dimensions(), (12, 9));
    assert!(pixels.into_rgb8().pixels().all(|pixel| pixel.0 == PIXEL));

    let cross_origin = preview(&window, &page, foreign, true).await.unwrap_err();
    assert!(
        cross_origin.contains("does not allow access to its pixels"),
        "{cross_origin}"
    );
    assert_eq!(counters().await?, json!({"draw":2,"png":2}));

    let after_read = command().await?;
    assert_ne!(
        after_read.page.images[1].locator,
        b["locator"].as_str().map(str::to_owned)
    );
    assert!(preview(&window, &page, b, true)
        .await
        .unwrap_err()
        .contains("This image changed"));
    assert_eq!(counters().await?, json!({"draw":2,"png":2}));

    let later = format!("{url}later");
    navigate(&window, later.clone()).await?;
    let later_page = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(snapshot) =
                browser_capture_page(window.clone(), TAB.to_owned(), later.clone()).await
            {
                if snapshot.page.title == "Later" {
                    break snapshot;
                }
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await
    .map_err(|_| "The later document did not load")?;
    assert_ne!(
        later_page.document_revision,
        page["documentRevision"].as_str().unwrap()
    );
    assert_eq!(
        world(&window, &later, COUNTERS).await?,
        json!({"draw":0,"png":0})
    );
    assert!(preview(&window, &page, b, true)
        .await
        .unwrap_err()
        .contains("Browser page changed"));
    assert_eq!(
        world(&window, &later, "globalThis.studioOwnedFixtureCounters").await?,
        json!({"draw":0,"png":0})
    );
    println!("Host/WebView2: duplicate URL locators, cancelled 0/0, replaced 0/0, one approved PNG with bound provenance, CORS blocked, reread and navigation rejected.");
    Ok(())
}

fn prepare_host(root: &Path) -> HostServer {
    let public = root.join("public");
    std::fs::create_dir(&public).unwrap();
    std::fs::write(
        public.join("index.html"),
        "<title>Isolated Studio Host</title>",
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    tauri::async_runtime::block_on(HostServer::start(public, NativePiManager::new(1), auth))
        .unwrap()
}

#[test]
#[ignore = "Windows WebView2 with a hidden owning window and an isolated Host; run alone"]
fn reviewed_image_pixels_require_confirmation_and_current_node() {
    let root = tempfile::tempdir().unwrap();
    crate::desktop_profile::initialize([
        "--isolated-profile".into(),
        root.path().join("profile").into_os_string(),
    ])
    .unwrap();
    assert!(!crate::desktop_profile::system_credentials_enabled());
    let host = prepare_host(root.path());
    let shell_url = format!("{}/index.html", host.origin()).parse().unwrap();
    let foreign = root.path().join("foreign");
    let origin = tauri::async_runtime::block_on(fixture_server(&foreign));
    assert!(BrowserPolicy::public_web().permits(&format!("https://{FOREIGN_HOST}/")));
    assert!(!BrowserPolicy::public_web().permits(&origin));
    let url = format!("{origin}/");
    let path = root.path().to_owned();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let builder = tauri::Builder::default()
        .any_thread()
        .manage(host)
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(app, OWNER, WebviewUrl::External(shell_url))
                .data_directory(path.join("shell"))
                .visible(false)
                .focused(false)
                .inner_size(900.0, 650.0)
                .build()?;
            let mut engine = NativeBrowserEngine::new(
                path.join("browser"),
                BrowserPolicy::isolated_probe(&origin)?,
                Arc::new(|_| {}),
            )?;
            // Only this hidden fixture maps its reserved .example image host to local bytes.
            // Native canvas origin rules still apply; the mapping does not send a request.
            engine.create(&window, TAB, "about:blank", VIEWPORT, 1.0, false)?;
            let view = engine.view(TAB)?.webview().cast::<ICoreWebView2_3>()?;
            unsafe {
                view.SetVirtualHostNameToFolderMapping(
                    &HSTRING::from(FOREIGN_HOST),
                    &HSTRING::from(foreign.as_os_str()),
                    COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS,
                )?;
            }
            engine.navigate(TAB, &url)?;
            engine.activate(Some(TAB), VIEWPORT, false)?;
            WINDOWS.with(|slot| {
                slot.with_mut(|windows| {
                    windows.insert(
                        OWNER.to_owned(),
                        WindowBrowser {
                            engine,
                            tabs: vec![TAB.to_owned()],
                        },
                    );
                    Ok(())
                })
            })?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Propagate assertion failure rather than leaving a native event loop running.
                let test = tauri::async_runtime::spawn(run_fixture(window, url));
                let report = match tokio::time::timeout(Duration::from_secs(60), test).await {
                    Ok(Ok(run)) => run,
                    Ok(Err(error)) => Err(error.to_string()),
                    Err(_) => Err("Integrated browser image acceptance timed out".to_owned()),
                };
                let passed = report.is_ok();
                let _ = sender.send(report);
                handle.exit(if passed { 0 } else { 1 });
            });
            Ok(())
        });
    let app = builder.build(tauri::generate_context!()).unwrap();
    let exit_code = app.run_return(|_, _| {});
    receiver.try_recv().expect("Host test receipt").unwrap();
    assert_eq!(exit_code, 0);
}
