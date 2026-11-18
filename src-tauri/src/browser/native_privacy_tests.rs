//! Explicit, ordinary-profile privacy defaults acceptance. No site/network probes.
use super::*;
use raw_window_handle::{HandleError, RawWindowHandle, Win32WindowHandle, WindowHandle};
use std::{
    num::NonZeroIsize,
    sync::mpsc,
    time::{Duration, Instant},
};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
use windows::{
    Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, DispatchMessageW, IsWindowVisible, MSG, PM_REMOVE,
            PeekMessageW, TranslateMessage, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
            WS_OVERLAPPEDWINDOW,
        },
    },
    core::{Interface, w},
};

struct HiddenOwner(HWND);
impl HiddenOwner {
    fn new() -> Self {
        let window = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Studio isolated privacy policy test"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                800,
                600,
                None,
                None,
                None,
                None,
            )
        }
        .expect("create hidden owned test window");
        assert!(!unsafe { IsWindowVisible(window) }.as_bool());
        Self(window)
    }
}
impl HasWindowHandle for HiddenOwner {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let hwnd = NonZeroIsize::new(self.0.0 as isize).ok_or(HandleError::Unavailable)?;
        Ok(unsafe {
            WindowHandle::borrow_raw(RawWindowHandle::Win32(Win32WindowHandle::new(hwnd)))
        })
    }
}
impl Drop for HiddenOwner {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

fn read_flags(view: &WebView) -> serde_json::Value {
    unsafe {
        let settings = view.webview().Settings().unwrap();
        let autofill = settings.cast::<ICoreWebView2Settings4>().unwrap();
        let mut general = windows::core::BOOL::default();
        let mut passwords = windows::core::BOOL::default();
        let mut messages = windows::core::BOOL::default();
        let mut objects = windows::core::BOOL::default();
        let mut visible = windows::core::BOOL::default();
        autofill.IsGeneralAutofillEnabled(&mut general).unwrap();
        autofill.IsPasswordAutosaveEnabled(&mut passwords).unwrap();
        settings.IsWebMessageEnabled(&mut messages).unwrap();
        settings.AreHostObjectsAllowed(&mut objects).unwrap();
        view.controller().IsVisible(&mut visible).unwrap();
        serde_json::json!({"generalAutofill":general.as_bool(),"passwordAutosave":passwords.as_bool(),
            "webMessages":messages.as_bool(),"hostObjects":objects.as_bool(),"visible":visible.as_bool()})
    }
}

fn ordinary_form(view: &WebView) -> serde_json::Value {
    let (tx, rx) = mpsc::channel();
    view.evaluate_script_with_callback("(()=>{const field=document.createElement('input');field.type='text';field.name='qa-name';field.autocomplete='name';document.body.append(field);field.value='Synthetic ordinary edit';return {value:field.value,disabled:field.disabled,readOnly:field.readOnly}})()", move |raw| { let _ = tx.send(raw); }).unwrap();
    let start = Instant::now();
    loop {
        if let Ok(raw) = rx.try_recv() {
            return serde_json::from_str(&raw).unwrap();
        }
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "ordinary form callback timed out"
        );
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

#[test]
#[ignore = "Explicit real Windows WebView2 acceptance; creates hidden owned windows with a fresh profile only"]
fn hidden_webview_general_autofill_is_disabled_without_disabling_form_editing() {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch/browser-permissions-008")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("owner.json"), r#"{"purpose":"hidden native privacy defaults; synthetic form only","retention":"failure or referenced acceptance fixture"}"#).unwrap();
    let owner = HiddenOwner::new();
    let mut engine = NativeBrowserEngine::new(
        directory.join("profile"),
        BrowserPolicy::public_web(),
        Arc::new(|_| {}),
    )
    .unwrap();
    let first = "18561c5d-9b8d-4169-940a-35392695eb79";
    let second = "9392ff19-5581-411e-95be-61990e74167d";
    let bounds = Bounds {
        x: 0.0,
        y: 0.0,
        width: 800.0,
        height: 600.0,
    };
    engine
        .create(&owner, first, "about:blank", bounds, 1.0, false)
        .unwrap();
    let initial = read_flags(engine.view(first).unwrap());
    println!("initial privacy flags: {initial}");
    assert_eq!(
        initial,
        serde_json::json!({"generalAutofill":false,"passwordAutosave":false,
        "webMessages":false,"hostObjects":false,"visible":false})
    );
    let form = ordinary_form(engine.view(first).unwrap());
    assert_eq!(
        form,
        serde_json::json!({"value":"Synthetic ordinary edit","disabled":false,"readOnly":false})
    );
    // A fresh tab must reapply the default even if this temporary profile was
    // configured differently. This never reads or clears an existing profile.
    unsafe {
        engine
            .view(first)
            .unwrap()
            .webview()
            .Settings()
            .unwrap()
            .cast::<ICoreWebView2Settings4>()
            .unwrap()
            .SetIsGeneralAutofillEnabled(true)
            .unwrap();
    }
    assert_eq!(
        read_flags(engine.view(first).unwrap())["generalAutofill"],
        true
    );
    engine
        .create(&owner, second, "about:blank", bounds, 1.0, false)
        .unwrap();
    let second_flags = read_flags(engine.view(second).unwrap());
    assert_eq!(second_flags["generalAutofill"], false);
    assert_eq!(
        read_flags(engine.view(first).unwrap())["generalAutofill"],
        false
    );
    assert!(!unsafe { IsWindowVisible(owner.0) }.as_bool());
    assert_eq!(second_flags["visible"], false);
    engine.destroy(second).unwrap();
    engine.destroy(first).unwrap();
    println!(
        "hidden native privacy acceptance passed: fresh profile, general autofill off, manual form unchanged, second tab reapplies default"
    );
}
