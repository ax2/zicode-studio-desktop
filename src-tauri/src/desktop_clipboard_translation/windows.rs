use crate::translation::MAX_TEXT_CHARS;
use std::thread;
use windows::Win32::Foundation::{HGLOBAL, LPARAM, WPARAM};
use windows::Win32::System::{DataExchange::*, Memory::*, Threading::GetCurrentThreadId};
use windows::Win32::UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*};

const SHORTCUT_ID: i32 = 0x592;
const UNICODE_TEXT: u32 = 13;

pub(super) struct Hotkey(u32);

impl Hotkey {
    pub(super) fn register(mut run: impl FnMut() + Send + 'static) -> Result<Self, &'static str> {
        let (ready, registered) = std::sync::mpsc::sync_channel(0);
        thread::Builder::new()
            .name("clipboard-translation-hotkey".into())
            .spawn(move || unsafe {
                let mut message = MSG::default();
                let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
                let registration = RegisterHotKey(
                    None,
                    SHORTCUT_ID,
                    MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
                    VK_F8.0.into(),
                );
                let result = registration.map(|_| GetCurrentThreadId()).map_err(|error| {
                    if error.code().0 as u32 == 0x8007_0581 {
                        "Translation shortcut is already in use"
                    } else {
                        "Translation shortcut could not be registered"
                    }
                });
                let active = result.is_ok();
                if ready.send(result).is_ok() && active {
                    while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                        if message.message == WM_HOTKEY && message.wParam.0 == SHORTCUT_ID as usize
                        {
                            run();
                        }
                    }
                }
                if active {
                    let _ = UnregisterHotKey(None, SHORTCUT_ID);
                }
            })
            .map_err(|_| "Translation shortcut could not be registered")?;
        registered
            .recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| "Translation shortcut could not be registered")?
            .map(Self)
    }
}

impl Drop for Hotkey {
    fn drop(&mut self) {
        let _ = unsafe { PostThreadMessageW(self.0, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
}

struct OpenedClipboard;

impl Drop for OpenedClipboard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

struct LockedText(HGLOBAL);

impl Drop for LockedText {
    fn drop(&mut self) {
        let _ = unsafe { GlobalUnlock(self.0) };
    }
}

pub(super) fn read_text() -> Result<String, &'static str> {
    const INVALID: &str = "Could not read text from the clipboard";
    unsafe {
        OpenClipboard(None).map_err(|_| INVALID)?;
        let _clipboard = OpenedClipboard;
        IsClipboardFormatAvailable(UNICODE_TEXT).map_err(|_| "Clipboard contains no text")?;
        let handle = HGLOBAL(GetClipboardData(UNICODE_TEXT).map_err(|_| INVALID)?.0);
        let size = GlobalSize(handle) / std::mem::size_of::<u16>();
        let address = GlobalLock(handle).cast::<u16>();
        if address.is_null() {
            return Err(INVALID);
        }
        let _locked = LockedText(handle);
        // A Unicode code point takes at most two UTF-16 units. Scan a bounded
        // prefix of the clipboard-owned allocation while it is still locked.
        let cap = MAX_TEXT_CHARS * 2 + 1;
        let units = std::slice::from_raw_parts(address, size.min(cap));
        let end = units
            .iter()
            .position(|unit| *unit == 0)
            .ok_or(if size >= cap {
                "Clipboard text exceeds the 50,000-character translation limit"
            } else {
                INVALID
            })?;
        let text = String::from_utf16(&units[..end]).map_err(|_| INVALID)?;
        if text.trim().is_empty() {
            return Err("Clipboard contains no text");
        }
        if text.chars().count() > MAX_TEXT_CHARS {
            return Err("Clipboard text exceeds the 50,000-character translation limit");
        }
        Ok(text)
    }
}
