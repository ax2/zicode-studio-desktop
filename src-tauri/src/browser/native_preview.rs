//! Ephemeral viewport image for chrome overlays. Never saved to disk or sent to Pi.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::cell::RefCell;
use std::rc::Rc;
use webview2_com::{CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG};
use windows::{core::{Interface, BOOL}, Win32::System::Com::{IStream, STATSTG, STATFLAG_NONAME, STREAM_SEEK_SET}};
use wry::WebViewExtWindows;

#[link(name = "shlwapi")]
unsafe extern "system" {
    fn SHCreateMemStream(initial: *const u8, bytes: u32) -> *mut std::ffi::c_void;
}

pub fn capture(view: &wry::WebView, complete: impl FnOnce(Result<String, String>) + 'static) -> Result<(), String> {
    unsafe {
        let mut visible = BOOL::default(); view.controller().IsVisible(&mut visible).map_err(|e| e.to_string())?;
        if !visible.as_bool() { return Err("Browser page is not visible".into()); }
        let mut bounds = windows::Win32::Foundation::RECT::default();
        view.controller().Bounds(&mut bounds).map_err(|e| e.to_string())?;
        let pixels = i64::from(bounds.right - bounds.left) * i64::from(bounds.bottom - bounds.top);
        if !(1..=32_000_000).contains(&pixels) { return Err("Page preview dimensions are unsupported".into()); }
        let raw = SHCreateMemStream(std::ptr::null(), 0);
        if raw.is_null() { return Err("Could not prepare page preview".into()); }
        let stream = IStream::from_raw(raw);
        let result_stream = stream.clone();
        let complete = Rc::new(RefCell::new(Some(complete)));
        view.webview().CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, &stream,
            &CapturePreviewCompletedHandler::create(Box::new(move |status| {
                let result = (|| {
                    status.map_err(|e|e.to_string())?;
                    let mut stat = STATSTG::default();
                    result_stream.Stat(&mut stat, STATFLAG_NONAME).map_err(|e|e.to_string())?;
                    if stat.cbSize == 0 || stat.cbSize > 8 * 1024 * 1024 { return Err("Page preview is too large".into()); }
                    result_stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e|e.to_string())?;
                    let mut bytes = vec![0u8; stat.cbSize as usize]; let mut read = 0;
                    result_stream.Read(bytes.as_mut_ptr().cast(), bytes.len() as u32, Some(&mut read)).ok().map_err(|e|e.to_string())?;
                    if read as usize != bytes.len() { return Err("Incomplete page preview".into()); }
                    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
                })();
                if let Some(complete) = complete.borrow_mut().take() { complete(result); }
                Ok(())
            }))).map_err(|e|e.to_string())
    }
}
