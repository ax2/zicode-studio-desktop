#[path = "engine.rs"]
mod engine;
#[path = "policy.rs"]
mod policy;
mod probe_messaging;
mod probe_profiles;
#[path = "windows_policy.rs"]
mod windows_policy;
use engine::{Bounds, NativeBrowserEngine};
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use wry::WebViewExtWindows;

thread_local! { static ENGINE: RefCell<Option<NativeBrowserEngine>> = const { RefCell::new(None) }; }
const SHELL: &str = "native-workspace-browser-probe";
const A: &str = "1e81f0b4-fb28-4363-985b-c28a0b536480";
const B: &str = "11ce8da7-bd14-4857-b759-eb619cb71f46";
const C: &str = "0748cd90-d8cd-4925-b911-33cde179c33b";
const BOX: Bounds = Bounds {
    x: 48.0,
    y: 96.0,
    width: 800.0,
    height: 500.0,
};

fn ui<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(work(&handle));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(25))
        .map_err(|e| e.to_string())?
}
fn evaluate(app: &AppHandle, tab: &'static str, script: &str) -> Result<Value, String> {
    let script = script.to_string();
    let (tx, rx) = mpsc::channel();
    ui(app, move |_| {
        ENGINE.with(|slot| {
            slot.borrow()
                .as_ref()
                .ok_or("No engine")?
                .view(tab)?
                .evaluate_script_with_callback(&script, move |value| {
                    let _ = tx.send(value);
                })
                .map_err(|e| e.to_string())
        })
    })?;
    let raw = rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid script response: {e}: {raw}"))
}
fn wait_page(app: &AppHandle, tab: &'static str, title: &str) -> Result<Value, String> {
    let start = Instant::now();
    let mut last = Value::Null;
    while start.elapsed() < Duration::from_secs(25) {
        last = evaluate(app, tab, "({title:document.title,ready:document.readyState,url:location.href,text:document.body?.innerText?.slice(0,2048),tauri:typeof window.__TAURI__,internal:typeof window.__TAURI_INTERNALS__,ipc:typeof window.ipc,token:typeof window.__zicodeDesktopToken})")?;
        if last["title"] == title && last["ready"] == "complete" {
            let native_url = ui(app, move |_| {
                ENGINE.with(|slot| {
                    slot.borrow()
                        .as_ref()
                        .ok_or("No engine")?
                        .view(tab)?
                        .url()
                        .map_err(|e| e.to_string())
                })
            })?;
            require(
                last["url"] == native_url,
                "Page context does not match native tab URL",
            )?;
            last["nativeUrl"] = Value::String(native_url);
            return Ok(last);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("Page did not become ready: {last}"))
}
fn require(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn run(app: &AppHandle, root: PathBuf, origin: String, phase: String) -> Result<Value, String> {
    let started = Instant::now();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let event_path = root.join(format!("events-{phase}.json"));
    let profile = root.join("profiles/default");
    let profile_copy = profile.clone();
    let origin_copy = origin.clone();
    ui(app, move |app| {
        let parent = app
            .get_webview_window(SHELL)
            .ok_or("Missing Studio shell")?;
        let mut engine = NativeBrowserEngine::new(
            profile_copy,
            policy::BrowserPolicy::isolated_probe(&origin_copy)?,
            Arc::new(move |event| {
                let mut events = captured.lock().unwrap();
                events.push(event);
                let _ = std::fs::write(&event_path, serde_json::to_vec_pretty(&*events).unwrap());
            }),
        )?;
        for (id, path) in [(A, "/a"), (B, "/b"), (C, "/c")] {
            engine.create(&parent, id, &format!("{origin_copy}{path}"), BOX, 1.0, false)?;
        }
        require(
            app.get_webview_window(SHELL).is_some(),
            "Children changed Tauri shell identity",
        )?;
        require(
            app.webview_windows().len() == 1,
            "Browser child registered in privileged Tauri registry",
        )?;
        ENGINE.with(|slot| *slot.borrow_mut() = Some(engine));
        Ok(())
    })?;
    let mut pages = Vec::new();
    for (tab, title) in [
        (A, "Browser fixture A"),
        (B, "Browser fixture B"),
        (C, "Browser fixture C"),
    ] {
        let page = wait_page(app, tab, title)?;
        for key in ["tauri", "internal", "token"] {
            require(
                page[key] == "undefined",
                &format!("Untrusted page contains native bridge: {key}"),
            )?;
        }
        pages.push(page);
    }
    let first_three_ms = started.elapsed().as_millis();
    let visibility = ui(app, move |_| {
        ENGINE.with(|slot| {
        let slot = slot.borrow(); let engine = slot.as_ref().ok_or("No engine")?;
        let mut proof = Vec::new();
        for tab in [A,B,C,A] {
            engine.activate(Some(tab), BOX, false)?;
            let mut flags = Vec::new();
            for id in [A,B,C] {
                let mut visible = windows::core::BOOL::default();
                unsafe { engine.view(id)?.controller().IsVisible(&mut visible).map_err(|e| e.to_string())?; }
                require(visible.as_bool() == (id == tab), "Wrong native controller visibility")?;
                flags.push(visible.as_bool());
            }
            proof.push(json!({"active":tab,"visible":flags}));
        }
        let narrow = Bounds { x: 48.0, y: 96.0, width: 640.0, height: 400.0 };
        engine.activate(Some(A), narrow, false)?;
        let mut rect = windows::Win32::Foundation::RECT::default();
        unsafe { engine.view(A)?.controller().Bounds(&mut rect).map_err(|e| e.to_string())?; }
        require(rect.right > rect.left && rect.bottom > rect.top, "Invalid native viewport bounds")?;
        engine.activate(None, narrow, false)?;
        Ok(json!({"switches":proof,"resizedNativeRect":[rect.left,rect.top,rect.right,rect.bottom]}))
    })
    })?;
    let cookie = if phase == "first" {
        evaluate(app, A, "(document.cookie='browser_probe=persisted; Max-Age=86400; SameSite=Lax; Path=/',localStorage.setItem('browser_probe','persisted'),({cookie:document.cookie,storage:localStorage.getItem('browser_probe')}))")?
    } else {
        let value = evaluate(
            app,
            A,
            "({cookie:document.cookie,storage:localStorage.getItem('browser_probe')})",
        )?;
        require(
            value["cookie"]
                .as_str()
                .unwrap_or("")
                .contains("browser_probe=persisted"),
            "Persistent cookie missing after process restart",
        )?;
        require(
            value["storage"] == "persisted",
            "Persistent local storage missing after process restart",
        )?;
        value
    };
    let context = evaluate(app, A, "(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('h1'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return {title:document.title,url:location.href,text:document.body.innerText,selection:selection.toString()}})()")?;
    require(
        context["selection"] == "Fixture A content",
        "Selection extraction differs from selected text",
    )?;
    let origin_copy = origin.clone();
    ui(app, move |_| {
        ENGINE.with(|slot| {
            slot.borrow()
                .as_ref()
                .ok_or("No engine")?
                .navigate(A, &format!("{origin_copy}/b"))
        })
    })?;
    wait_page(app, A, "Browser fixture B")?;
    ui(app, |_| {
        ENGINE.with(|slot| slot.borrow().as_ref().ok_or("No engine")?.action(A, "back"))
    })?;
    wait_page(app, A, "Browser fixture A")?;
    ui(app, |_| {
        ENGINE.with(|slot| {
            slot.borrow()
                .as_ref()
                .ok_or("No engine")?
                .action(A, "forward")
        })
    })?;
    wait_page(app, A, "Browser fixture B")?;
    ui(app, |_| {
        ENGINE.with(|slot| {
            slot.borrow()
                .as_ref()
                .ok_or("No engine")?
                .action(A, "reload")
        })
    })?;
    wait_page(app, A, "Browser fixture B")?;
    // A blocked native navigation must leave the current page untouched.
    let blocked = ui(app, |_| {
        ENGINE.with(|slot| {
            Ok(slot
                .borrow()
                .as_ref()
                .ok_or("No engine")?
                .navigate(A, "file:///C:/Windows/win.ini")
                .is_err())
        })
    })?;
    require(blocked, "Native file navigation was accepted")?;
    let bridge_call = probe_messaging::verify(app)?;
    let fixture: Value = serde_json::from_slice(
        &std::fs::read(root.join("fixture.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let forbidden = serde_json::to_string(
        fixture["forbidden"]
            .as_str()
            .ok_or("Missing forbidden fixture")?,
    )
    .map_err(|e| e.to_string())?;
    evaluate(app,A,&format!("(window.__probeBlocked=null,fetch({forbidden}).then(r=>window.__probeBlocked={{status:r.status}}).catch(()=>window.__probeBlocked={{blocked:true}}),true)"))?;
    std::thread::sleep(Duration::from_millis(500));
    let private_request = evaluate(app, A, "window.__probeBlocked")?;
    require(
        private_request["blocked"] == true || private_request["status"] == 403,
        "Private network test did not settle",
    )?;
    evaluate(app, A, "(window.open('/c','_blank'),true)")?;
    ui(app, |_| {
        ENGINE.with(|slot| {
            slot.borrow()
                .as_ref()
                .ok_or("No engine")?
                .activate(Some(A), BOX, false)
        })
    })?;
    let download_url = format!("{origin}/download");
    ui(app, move |_| {
        ENGINE.with(|slot| {
            slot.borrow()
                .as_ref()
                .ok_or("No engine")?
                .navigate(A, &download_url)
        })
    })?;
    let download_wait = Instant::now();
    while download_wait.elapsed() < Duration::from_secs(4) {
        if events.lock().unwrap().iter().any(|event| {
            matches!(
                event,
                engine::EngineEvent::DownloadBlocked { .. }
                    | engine::EngineEvent::NativeDownloadBlocked { .. }
            )
        }) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let prior_https: Value = serde_json::from_slice(
        &std::fs::read(root.join("observations-first.json")).unwrap_or_default(),
    )
    .unwrap_or(Value::Null);
    let https = if phase == "second" && prior_https["https"]["passed"] == true {
        json!({"passed":true,"reusedActualReadOnlyEvidence":"same executable first-process observations-first.json","page":prior_https["https"]["page"]})
    } else {
        let loaded = ui(app, |_| {
            ENGINE.with(|slot| {
                slot.borrow()
                    .as_ref()
                    .ok_or("No engine")?
                    .navigate(C, "https://example.com/")
            })
        })
        .and_then(|_| wait_page(app, C, "Example Domain"));
        match loaded {
            Ok(page) => json!({"passed":true,"page":page}),
            Err(error) => json!({"passed":false,"error":error}),
        }
    };
    require(https["passed"] == true, "Public HTTPS evidence is missing")?;
    let destroyed = ui(app, |_| {
        ENGINE.with(|slot| {
            let mut slot = slot.borrow_mut();
            let engine = slot.as_mut().ok_or("No engine")?;
            engine.destroy(B)?;
            require(engine.view(B).is_err(), "Closed view remains accessible")?;
            engine.destroy(A)?;
            engine.destroy(C)?;
            *slot = None;
            Ok(true)
        })
    })?;
    let profile_isolation = probe_profiles::verify(app, &root, &origin, &phase)?;
    let events = events.lock().unwrap();
    let observations = json!({"phase":phase,"pages":pages,"firstThreeTabsMs":first_three_ms,
        "cookie":cookie,"profileIsolation":profile_isolation,"selection":context,"noNativeBridge":bridge_call,"privateRequest":private_request,
        "https":https,"visibility":visibility,"destroyed":destroyed,"events":*events});
    std::fs::write(
        root.join(format!("observations-{phase}.json")),
        serde_json::to_vec_pretty(&observations).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    require(
        events
            .iter()
            .any(|event| matches!(event, engine::EngineEvent::Popup { .. })),
        "Popup hook did not fire",
    )?;
    require(
        events.iter().any(|event| {
            matches!(
                event,
                engine::EngineEvent::DownloadBlocked { .. }
                    | engine::EngineEvent::NativeDownloadBlocked { .. }
            )
        }),
        "Download hook did not fire",
    )?;
    Ok(
        json!({"status":"passed","phase":phase,"engine":"wry 0.55.1 / WebView2","firstThreeTabsMs":first_three_ms,
        "elapsedMs":started.elapsed().as_millis(),"profile":profile,"pages":pages,"visibility":visibility,
        "cookie":cookie,"profileIsolation":profile_isolation,"selection":context,"noNativeBridge":bridge_call,"privateRequest":private_request,
        "https":https,"destroyed":destroyed,"events":*events,
        "notAccepted":["Studio integration","address bar UI","Pi handoff","download manager","file upload","real account login","physical focus","DNS rebinding","renderer crash recovery","other platforms"]}),
    )
}

static EXIT_CODE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(2);
pub fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!(
            "Usage: browser-engine-probe <owned-root> <numeric-loopback-origin> <first|second>"
        );
        std::process::exit(2);
    }
    let root = PathBuf::from(&args[1]);
    let origin = args[2].clone();
    let phase = args[3].clone();
    let expected_parent = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".cache/task-scratch/browser-p0");
    let root = root.canonicalize().expect("QA root must exist");
    assert_eq!(
        root.parent(),
        Some(
            expected_parent
                .canonicalize()
                .expect("QA owner directory")
                .as_path()
        )
    );
    assert_eq!(
        std::fs::read_to_string(root.join("owner.txt")).unwrap(),
        "browser-p0-native-acceptance"
    );
    assert!(phase == "first" || phase == "second");
    policy::BrowserPolicy::isolated_probe(&origin).expect("Invalid isolated fixture origin");
    require(
        !policy::BrowserPolicy::public_web().permits(&origin),
        "Production policy permits probe origin",
    )
    .unwrap();
    let output = root.join(format!("report-{phase}.json"));
    let shell_profile = root.join("studio-shell");
    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                SHELL,
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .data_directory(shell_profile.clone())
            .title("Studio browser acceptance — isolated")
            .visible(false)
            .focused(false)
            .inner_size(1000.0, 700.0)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = run(&handle, root, origin, phase);
                let success = result.is_ok();
                let report =
                    result.unwrap_or_else(|error| json!({"status":"failed","error":error}));
                if let Err(error) =
                    std::fs::write(&output, serde_json::to_vec_pretty(&report).unwrap())
                {
                    eprintln!("Cannot save acceptance report: {error}");
                }
                EXIT_CODE.store(
                    if success { 0 } else { 1 },
                    std::sync::atomic::Ordering::SeqCst,
                );
                handle.exit(if success { 0 } else { 1 });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Native browser acceptance stopped unexpectedly");
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::SeqCst));
}
