//! Native page controls. No page scripts or system audio settings are modified.
use serde::Serialize;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
use windows::core::{Interface, BOOL};
use wry::WebViewExtWindows;

#[derive(Serialize)]
pub struct PageSettings {
    pub zoom: f64,
    pub muted: bool,
}
pub fn read(view: &wry::WebView) -> Result<PageSettings, String> {
    unsafe {
        let mut zoom = 1.0;
        let mut muted = BOOL::default();
        view.controller()
            .ZoomFactor(&mut zoom)
            .map_err(|e| e.to_string())?;
        view.webview()
            .cast::<ICoreWebView2_8>()
            .map_err(|e| e.to_string())?
            .IsMuted(&mut muted)
            .map_err(|e| e.to_string())?;
        Ok(PageSettings {
            zoom,
            muted: muted.as_bool(),
        })
    }
}
pub fn set_zoom(view: &wry::WebView, zoom: f64) -> Result<PageSettings, String> {
    if !zoom.is_finite() || !(0.25..=5.0).contains(&zoom) {
        return Err("Page zoom must be between 25% and 500%".into());
    }
    unsafe {
        view.controller()
            .SetZoomFactor(zoom)
            .map_err(|e| e.to_string())?;
    }
    read(view)
}
pub fn set_muted(view: &wry::WebView, muted: bool) -> Result<PageSettings, String> {
    unsafe {
        view.webview()
            .cast::<ICoreWebView2_8>()
            .map_err(|e| e.to_string())?
            .SetIsMuted(muted)
            .map_err(|e| e.to_string())?;
    }
    read(view)
}
