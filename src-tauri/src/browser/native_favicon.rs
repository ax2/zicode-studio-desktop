//! Use the engine's already fetched icon, never fetch an arbitrary URL in Host.
use super::EngineEvent;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::sync::{atomic::{AtomicU64, Ordering}, Arc, Mutex};
use webview2_com::{take_pwstr, FaviconChangedEventHandler, GetFaviconCompletedHandler, Microsoft::Web::WebView2::Win32::{ICoreWebView2_15, COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG}};
use windows::{core::{Interface, PWSTR}, Win32::System::Com::{IStream, STATSTG, STATFLAG_NONAME, STREAM_SEEK_SET}};
use wry::WebViewExtWindows;

#[derive(Default)]
pub struct Icon { generation: AtomicU64, image: Mutex<Option<String>> }
impl Icon {
    pub fn clear(&self) { self.generation.fetch_add(1, Ordering::SeqCst); if let Ok(mut image) = self.image.lock() { *image = None; } }
    #[allow(dead_code)] // Host metadata reads this; the standalone engine probe has no chrome.
    pub fn image(&self) -> Option<String> { self.image.lock().ok().and_then(|image| image.clone()) }
    fn begin(&self) -> u64 { self.generation.fetch_add(1, Ordering::SeqCst) + 1 }
    fn apply(&self, ticket: u64, next: Option<String>) -> bool {
        if self.generation.load(Ordering::SeqCst) != ticket { return false; }
        let Ok(mut current) = self.image.lock() else { return false; };
        if *current == next { return false; }
        *current = next; true
    }
}
fn png(bytes: &[u8]) -> Option<String> {
    if !(33..=65536).contains(&bytes.len()) || bytes.get(..8)? != b"\x89PNG\r\n\x1a\n" || bytes.get(12..16)? != b"IHDR" { return None; }
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    if !(1..=256).contains(&width) || !(1..=256).contains(&height) { return None; }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}
fn read(stream: Option<IStream>) -> Option<String> {
    let stream = stream?;
    unsafe {
        let mut stat = STATSTG::default(); stream.Stat(&mut stat, STATFLAG_NONAME).ok()?;
        if !(33..=65536).contains(&stat.cbSize) { return None; }
        stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
        let mut bytes = vec![0u8; stat.cbSize as usize]; let mut count = 0;
        stream.Read(bytes.as_mut_ptr().cast(), bytes.len() as u32, Some(&mut count)).ok().ok()?;
        if count as usize != bytes.len() { return None; }
        png(&bytes)
    }
}
pub fn install(view: &wry::WebView, tab: String, icon: Arc<Icon>, emit: Arc<dyn Fn(EngineEvent) + Send + Sync>) {
    // Older runtimes retain a normal default icon without preventing navigation.
    let Ok(core) = view.webview().cast::<ICoreWebView2_15>() else { return; };
    unsafe {
        let mut token = 0;
        let _ = core.add_FaviconChanged(&FaviconChangedEventHandler::create(Box::new(move |sender, _| {
            let Some(sender) = sender else { return Ok(()); };
            let core = sender.cast::<ICoreWebView2_15>()?;
            let ticket = icon.begin(); let state = icon.clone(); let changed = emit.clone(); let id = tab.clone();
            let mut uri = PWSTR::null();
            let found = core.FaviconUri(&mut uri).is_ok();
            let uri = take_pwstr(uri);
            // Some runtimes return a built-in PNG even when the page has no icon.
            if !found || uri.is_empty() {
                if icon.apply(ticket, None) { emit(EngineEvent::Favicon { tab: tab.clone(), image: None }); }
                return Ok(());
            }
            let result = core.GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
                &GetFaviconCompletedHandler::create(Box::new(move |status, stream| {
                    let image = status.ok().and_then(|_| read(stream));
                    if state.apply(ticket, image.clone()) { changed(EngineEvent::Favicon { tab: id.clone(), image }); }
                    Ok(())
                })));
            if result.is_err() && icon.apply(ticket, None) { emit(EngineEvent::Favicon { tab: tab.clone(), image: None }); }
            Ok(())
        })), &mut token);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_and_newer_icons_reject_late_completions() {
        let icon = Icon::default(); let before = icon.begin(); icon.clear();
        assert!(!icon.apply(before, Some("old page".into())));
        let first = icon.begin(); let latest = icon.begin();
        assert!(icon.apply(latest, Some("latest".into())));
        assert!(!icon.apply(first, Some("late old icon".into())));
        assert!(!icon.apply(latest, Some("latest".into())));
        assert_eq!(icon.image().as_deref(), Some("latest")); icon.clear(); assert_eq!(icon.image(), None);
    }
    #[test]
    fn only_bounded_png_dimensions_are_forwarded() {
        let mut bytes = vec![0; 33]; bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n"); bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&16u32.to_be_bytes()); bytes[20..24].copy_from_slice(&16u32.to_be_bytes());
        assert!(png(&bytes).is_some()); bytes[16..20].copy_from_slice(&257u32.to_be_bytes()); assert!(png(&bytes).is_none());
        bytes[16..20].copy_from_slice(&0u32.to_be_bytes()); assert!(png(&bytes).is_none());
        assert!(png(b"<svg onload=alert(1)></svg>").is_none()); assert!(png(&vec![0; 65537]).is_none());
    }
}
