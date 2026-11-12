//! Each untrusted page owns a child HWND. Wry 0.55.1 removes its parent
//! subclass even for child views on drop; never give it the Studio HWND.
use super::{event_lifetime::EventLifetime, Bounds};
use raw_window_handle::{
    HandleError, HasWindowHandle, RawWindowHandle, Win32WindowHandle, WindowHandle,
};
use std::{cell::Cell, num::NonZeroIsize, rc::Rc};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::{
    core::w,
    Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE,
            SW_HIDE, SW_SHOWNA, WINDOW_EX_STYLE, WS_CHILD, WS_CLIPSIBLINGS,
        },
    },
};
use wry::{dpi::LogicalPosition, WebView};

pub(super) struct Container(HWND);
impl Container {
    pub fn new(parent: &impl HasWindowHandle) -> Result<Self, String> {
        let RawWindowHandle::Win32(handle) =
            parent.window_handle().map_err(|e| e.to_string())?.as_raw()
        else {
            return Err("Browser requires a Windows owner".into());
        };
        // A hidden, inert child; it contains no app IPC or window userdata.
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!(""),
                WS_CHILD | WS_CLIPSIBLINGS,
                0,
                0,
                1,
                1,
                Some(HWND(handle.hwnd.get() as *mut _)),
                None,
                None,
                None,
            )
        }
        .map_err(|e| e.to_string())?;
        Ok(Self(hwnd))
    }
    fn bounds(&self, bounds: Bounds) -> Result<(), String> {
        bounds.rect()?;
        let scale = unsafe { GetDpiForWindow(self.0) } as f64 / 96.0;
        if scale <= 0.0 {
            return Err("Browser container is unavailable".into());
        }
        // The native page is a sibling of Studio's full-window chrome WebView.
        // Present it above that sibling; IsVisible alone does not prevent the
        // chrome surface from covering it. Keep keyboard focus unchanged.
        unsafe {
            SetWindowPos(
                self.0,
                Some(HWND_TOP),
                (bounds.x * scale).round() as i32,
                (bounds.y * scale).round() as i32,
                (bounds.width * scale).round() as i32,
                (bounds.height * scale).round() as i32,
                SWP_NOACTIVATE,
            )
        }
        .map_err(|e| e.to_string())
    }
}
impl HasWindowHandle for Container {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let hwnd = NonZeroIsize::new(self.0 .0 as isize).ok_or(HandleError::Unavailable)?;
        // This borrowed handle cannot outlive the UI-thread-owned container.
        Ok(unsafe {
            WindowHandle::borrow_raw(RawWindowHandle::Win32(Win32WindowHandle::new(hwnd)))
        })
    }
}
impl Drop for Container {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.0) };
    }
}
pub(super) struct NativeView {
    pub favicon: std::sync::Arc<super::native_favicon::Icon>,
    pub events: EventLifetime,
    pub opener: Option<String>,
    pub closing: Rc<Cell<bool>>,
    pub navigation: super::super::windows_policy::NavigationState,
    // Rust drops fields in declaration order: Wry must detach before the HWND dies.
    pub webview: WebView,
    pub container: Container,
}
impl NativeView {
    pub fn present(&self, bounds: Bounds, focus: bool) -> Result<(), String> {
        let mut rect = bounds.rect()?;
        rect.position = LogicalPosition::new(0.0, 0.0).into();
        self.container.bounds(bounds)?;
        self.webview.set_bounds(rect).map_err(|e| e.to_string())?;
        self.webview.set_visible(true).map_err(|e| e.to_string())?;
        let _ = unsafe { ShowWindow(self.container.0, SW_SHOWNA) };
        if focus {
            self.webview.focus().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn hide(&self) -> Result<(), String> {
        let _ = unsafe { ShowWindow(self.container.0, SW_HIDE) };
        self.webview.set_visible(false).map_err(|e| e.to_string())
    }
}

impl Drop for NativeView {
    fn drop(&mut self) {
        self.events.retire();
    }
}
