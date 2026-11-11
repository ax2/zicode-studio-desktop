//! Fixed browser accelerators from native WebView2 input, never webpage messages.
use super::EngineEvent;
use std::sync::Arc;
use webview2_com::{AcceleratorKeyPressedEventHandler, Microsoft::Web::WebView2::Win32::*};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};
use wry::WebViewExtWindows;

fn shortcut(key: u32, control: bool, alt: bool, shift: bool) -> Option<&'static str> {
    if !control && !alt && !shift {
        if key == 0x7a { return Some("fullscreen"); }
        if key == 0x74 { return Some("reload"); }
    }
    if alt && !control && !shift {
        return match key {
            0x25 => Some("back"),
            0x27 => Some("forward"),
            _ => None,
        };
    }
    if !control || alt { return None; }
    match (key, shift) {
        (0x41, true) => Some("searchTabs"),
        (0x46, false) => Some("find"),
        (0x4c, false) => Some("address"),
        (0x52, false) => Some("reload"),
        (0x54, false) => Some("newTab"),
        (0x54, true) => Some("reopenTab"),
        (0x57, false) => Some("closeTab"),
        (0x09, false) => Some("nextTab"),
        (0x09, true) => Some("previousTab"),
        _ => None,
    }
}
pub fn install(
    view: &wry::WebView,
    tab: String,
    emit: Arc<dyn Fn(EngineEvent) + Send + Sync>,
) -> windows::core::Result<()> {
    unsafe {
        let mut token = 0;
        view.controller().add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                {
                    return Ok(());
                }
                let mut key = 0;
                args.VirtualKey(&mut key)?;
                let Some(action) = shortcut(
                    key,
                    GetKeyState(VK_CONTROL.0 as i32) < 0,
                    GetKeyState(VK_MENU.0 as i32) < 0,
                    GetKeyState(VK_SHIFT.0 as i32) < 0,
                ) else {
                    return Ok(());
                };
                // Release the browser's synchronous input wait before notifying chrome.
                // No navigation, search or focus operation runs inside this callback.
                args.SetHandled(true)?;
                let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                args.PhysicalKeyStatus(&mut status)?;
                if !status.WasKeyDown.as_bool() {
                    emit(EngineEvent::Shortcut {
                        tab: tab.clone(),
                        action: action.into(),
                    });
                }
                Ok(())
            })),
            &mut token,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_browser_control_shortcuts_are_intercepted() {
        assert_eq!(shortcut(0x46, true, false, false), Some("find"));
        assert_eq!(shortcut(0x4c, true, false, false), Some("address"));
        for key in [0x46, 0x4c] {
            assert_eq!(shortcut(key, false, false, false), None);
            assert_eq!(shortcut(key, true, true, false), None);
            assert_eq!(shortcut(key, true, false, true), None);
        }
        assert_eq!(shortcut(0x7a, false, false, false), Some("fullscreen"));
        assert_eq!(shortcut(0x74, false, false, false), Some("reload"));
        assert_eq!(shortcut(0x52, true, false, false), Some("reload"));
        assert_eq!(shortcut(0x52, true, false, true), None);
        assert_eq!(shortcut(0x74, true, false, false), None);
        assert_eq!(shortcut(0x25, false, true, false), Some("back"));
        assert_eq!(shortcut(0x27, false, true, false), Some("forward"));
        assert_eq!(shortcut(0x25, true, true, false), None);
        assert_eq!(shortcut(0x27, false, true, true), None);
        for (control, alt, shift) in [(true, false, false), (false, true, false), (false, false, true)] {
            assert_eq!(shortcut(0x7a, control, alt, shift), None);
        }
        assert_eq!(shortcut(0x43, true, false, false), None);
        assert_eq!(shortcut(0x41, true, false, true), Some("searchTabs"));
        assert_eq!(shortcut(0x41, true, false, false), None);
        assert_eq!(shortcut(0x41, false, false, true), None);
        assert_eq!(shortcut(0x41, true, true, true), None);
        for (key, shift, action) in [(0x54, false, "newTab"), (0x54, true, "reopenTab"),
            (0x57, false, "closeTab"), (0x09, false, "nextTab"), (0x09, true, "previousTab")] {
            assert_eq!(shortcut(key, true, false, shift), Some(action));
            assert_eq!(shortcut(key, false, false, shift), None);
            assert_eq!(shortcut(key, true, true, shift), None);
        }
        assert_eq!(shortcut(0x57, true, false, true), None);
    }
}
