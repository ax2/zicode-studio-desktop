//! Native page controls. No page scripts or system audio settings are modified.
use super::{event_lifetime::Emit, EngineEvent};
use serde::Serialize;
use webview2_com::{Microsoft::Web::WebView2::Win32::ICoreWebView2_8, ZoomFactorChangedEventHandler};
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
pub(super) fn observe_zoom(
    view: &wry::WebView,
    tab: String,
    emit: Emit,
) -> windows::core::Result<()> {
    let mut token = 0;
    unsafe {
        // Wry disables user zoom by default. Enable it only on this page.
        view.webview().Settings()?.SetIsZoomControlEnabled(true)?;
        view.controller().add_ZoomFactorChanged(
            &ZoomFactorChangedEventHandler::create(Box::new(move |sender, _| {
                let Some(controller) = sender else { return Ok(()); };
                let mut visible = BOOL::default();
                controller.IsVisible(&mut visible)?;
                if !visible.as_bool() {
                    return Ok(());
                }
                let mut zoom = 1.0;
                controller.ZoomFactor(&mut zoom)?;
                if supported_zoom(zoom) {
                    // WebView2's user zoom would reset on navigation. Applying it
                    // via the controller makes it the default for this view.
                    controller.SetZoomFactor(zoom)?;
                    emit(EngineEvent::PageZoomChanged { tab: tab.clone() });
                }
                Ok(())
            })),
            &mut token,
        )
    }
}

fn supported_zoom(zoom: f64) -> bool {
    (0.25..=5.0).contains(&zoom)
}

pub fn set_zoom(view: &wry::WebView, zoom: f64) -> Result<PageSettings, String> {
    if !supported_zoom(zoom) {
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
