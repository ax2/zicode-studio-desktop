//! Native page output for temporary viewport previews and explicit local exports.
use super::engine::native_downloads::Record;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{io::Write, path::Path, time::Duration};
use tauri::{Manager, WebviewWindow};
use webview2_com::{
    CapturePreviewCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PrintSettings, ICoreWebView2_16,
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    },
    PrintToPdfStreamCompletedHandler,
};
use windows::{
    core::{Interface, BOOL},
    Win32::System::Com::{IStream, STREAM_SEEK_SET},
};
use wry::WebViewExtWindows;

/// The operating system owns printer selection, confirmation and cancellation.
pub(super) fn show_print_dialog(view: &wry::WebView) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM;
    let mut visible = BOOL::default();
    unsafe { view.controller().IsVisible(&mut visible) }.map_err(|e| e.to_string())?;
    if !visible.as_bool() {
        return Err("Browser page is not visible".into());
    }
    let native: ICoreWebView2_16 = view.webview().cast().map_err(|e| format!("{e}"))?;
    unsafe { native.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM) }.map_err(|e| e.to_string())
}

#[derive(Clone, Copy)]
pub(super) enum Format {
    Jpeg,
    Png,
    Pdf,
}

#[link(name = "shlwapi")]
unsafe extern "system" {
    fn SHCreateMemStream(initial: *const u8, bytes: u32) -> *mut std::ffi::c_void;
}

pub(super) struct ExpectedDocument {
    pub(super) url: String,
    pub(super) revision: String,
}

async fn request(
    window: &WebviewWindow,
    tab: String,
    expected: Option<ExpectedDocument>,
    format: Format,
) -> Result<Vec<u8>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let owner = window.clone();
    window
        .app_handle()
        .run_on_main_thread(move || {
            super::runtime::page_output(&owner, tab, expected, format, sender);
        })
        .map_err(|error| error.to_string())?;
    let (seconds, timeout) = match format {
        Format::Pdf => (30, "Page PDF export timed out"),
        Format::Jpeg | Format::Png => (10, "Page capture timed out"),
    };
    tokio::time::timeout(Duration::from_secs(seconds), receiver)
        .await
        .map_err(|_| timeout)?
        .map_err(|_| "Browser UI thread stopped")?
}

pub(super) async fn snapshot(window: WebviewWindow, tab: String) -> Result<Value, String> {
    let bytes = request(&window, tab, None, Format::Jpeg).await?;
    Ok(Value::String(format!(
        "data:image/jpeg;base64,{}",
        STANDARD.encode(bytes)
    )))
}

pub(super) async fn save(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
    expected_document_revision: String,
    format: Format,
) -> Result<Value, String> {
    let directory = window
        .app_handle()
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    let expected = ExpectedDocument {
        url: expected_url.clone(),
        revision: expected_document_revision,
    };
    let bytes = request(&window, tab.clone(), Some(expected), format).await?;
    crate::require_workspace_window(&window)?;
    let completed = tauri::async_runtime::spawn_blocking(move || {
        publish(&directory, tab, &expected_url, format, &bytes)
    })
    .await
    .map_err(|_| "Page file save worker stopped")??;
    let output = json!({ "name": &completed.name, "bytes": completed.received });

    // The file is already available in Downloads even if its history cannot be written.
    let report =
        |error: String| log::warn!("Could not record browser export in download history: {error}");
    let history = serde_json::to_value(completed)
        .map_err(|error| error.to_string())
        .and_then(|value| {
            super::download_journal::record(window.label().to_owned(), value, report)
        });
    if let Err(error) = history {
        report(error);
    }
    Ok(output)
}

pub(super) fn publish(
    directory: &Path,
    tab: String,
    url: &str,
    format: Format,
    bytes: &[u8],
) -> Result<Record, String> {
    let (extension, signature, invalid): (&str, &[u8], &str) = match format {
        Format::Png => ("png", b"\x89PNG\r\n\x1a\n", "Could not capture a PNG image"),
        Format::Pdf => ("pdf", b"%PDF-", "Could not create a page PDF"),
        Format::Jpeg => return Err("JPEG is only available for browser previews".into()),
    };
    if !bytes.starts_with(signature) {
        return Err(invalid.into());
    }
    use super::engine::native_downloads::files;
    let name = format!(
        "Studio-{}.{extension}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let target = files::default_target(directory, &name)?;
    let (staging, mut file) = files::reserve(&target, &uuid::Uuid::new_v4().to_string())?;
    let written = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    let result = written
        .map_err(|error| error.to_string())
        .and_then(|_| files::finish(&staging, &target));
    if let Err(error) = result {
        let _ = std::fs::remove_file(&staging);
        return Err(error);
    }
    // Browser-generated files may come from private paths or bearer-token URLs.
    let origin = reqwest::Url::parse(url)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map_or_else(String::new, |url| url.origin().ascii_serialization());
    let size = bytes.len() as i64; // Capture already caps the largest output at 64 MiB.
    Ok(Record {
        id: uuid::Uuid::new_v4().to_string(),
        tab,
        url: origin,
        name: target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&name)
            .to_owned(),
        state: "completed".into(),
        can_resume: false,
        stalled: false,
        received: size,
        total: Some(size),
        path: Some(target.to_string_lossy().into_owned()),
        partial_path: None,
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

pub(super) fn capture(
    view: &wry::WebView,
    format: Format,
    complete: impl FnOnce(Result<Vec<u8>, String>) + 'static,
) -> Result<(), String> {
    let mut visible = BOOL::default();
    unsafe { view.controller().IsVisible(&mut visible) }.map_err(|error| error.to_string())?;
    if !visible.as_bool() {
        return Err("Browser page is not visible".into());
    }
    if matches!(format, Format::Pdf) {
        return print_pdf(view, complete);
    }
    let mut bounds = windows::Win32::Foundation::RECT::default();
    unsafe { view.controller().Bounds(&mut bounds) }.map_err(|error| error.to_string())?;
    let pixels = i64::from(bounds.right - bounds.left) * i64::from(bounds.bottom - bounds.top);
    if !(1..=32_000_000).contains(&pixels) {
        return Err("Page preview dimensions are unsupported".into());
    }
    let raw = unsafe { SHCreateMemStream(std::ptr::null(), 0) };
    if raw.is_null() {
        return Err("Could not prepare page preview".into());
    }
    let stream = unsafe { IStream::from_raw(raw) };
    let result_stream = stream.clone();
    let (format, max_bytes) = if matches!(format, Format::Png) {
        (
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            32 * 1024 * 1024,
        )
    } else {
        (
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
            8 * 1024 * 1024,
        )
    };
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |status| {
        complete(status.map_err(|error| error.to_string()).and_then(|_| {
            unsafe { result_stream.Seek(0, STREAM_SEEK_SET, None) }
                .map_err(|error| error.to_string())?;
            read_stream(&result_stream, max_bytes, "Page preview is too large")
        }));
        Ok(())
    }));
    unsafe { view.webview().CapturePreview(format, &stream, &handler) }
        .map_err(|error| error.to_string())
}

fn print_pdf(
    view: &wry::WebView,
    complete: impl FnOnce(Result<Vec<u8>, String>) + 'static,
) -> Result<(), String> {
    let native: ICoreWebView2_16 = view
        .webview()
        .cast()
        .map_err(|_| "Page PDF export is unavailable")?;
    let handler = PrintToPdfStreamCompletedHandler::create(Box::new(move |status, stream| {
        let result = status
            .map_err(|_| "Could not create a page PDF".to_string())
            .and_then(|_| {
                let stream = stream.ok_or("Could not create a page PDF")?;
                read_stream(&stream, 64 * 1024 * 1024, "Page PDF is too large")
            });
        complete(result);
        Ok(())
    }));
    unsafe { native.PrintToPdfStream(None::<&ICoreWebView2PrintSettings>, &handler) }
        .map_err(|_| "Could not create a page PDF".into())
}

fn read_stream(stream: &IStream, limit: usize, too_large: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 32 * 1024];
    loop {
        let mut read = 0;
        unsafe {
            stream.Read(
                chunk.as_mut_ptr().cast(),
                chunk.len() as u32,
                Some(&mut read),
            )
        }
        .ok()
        .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        if bytes.len() + read as usize > limit {
            return Err(too_large.into());
        }
        bytes.extend_from_slice(chunk.get(..read as usize).ok_or("Incomplete page output")?);
    }
    if bytes.is_empty() {
        return Err("Page output is empty".into());
    }
    Ok(bytes)
}
