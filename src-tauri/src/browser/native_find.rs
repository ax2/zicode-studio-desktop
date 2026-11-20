//! WebView2 text search. Query text is data, never evaluated as page JavaScript.
use serde_json::{json, Value};
use webview2_com::{FindStartCompletedHandler, Microsoft::Web::WebView2::Win32::*};
use windows::core::{Interface, HSTRING};
use wry::WebViewExtWindows;

fn finder(view: &wry::WebView) -> Result<ICoreWebView2Find, String> {
    unsafe {
        view.webview()
            .cast::<ICoreWebView2_28>()
            .map_err(|_| "Page search requires a newer WebView2 runtime".to_string())?
            .Find()
            .map_err(|e| e.to_string())
    }
}
fn validate(text: &str) -> Result<(), String> {
    if text.len() > 1024 || text.contains('\0') {
        return Err("Search text is too long or contains an unsupported character".into());
    }
    Ok(())
}
pub fn start(
    view: &wry::WebView,
    text: &str,
    case_sensitive: bool,
    completed: impl FnOnce(Result<Value, String>) + 'static,
) -> Result<(), String> {
    validate(text)?;
    let find = finder(view)?;
    unsafe {
        let options = view
            .environment()
            .cast::<ICoreWebView2Environment15>()
            .and_then(|e| e.CreateFindOptions())
            .map_err(|e| e.to_string())?;
        options
            .SetFindTerm(&HSTRING::from(text))
            .map_err(|e| e.to_string())?;
        options
            .SetIsCaseSensitive(case_sensitive)
            .map_err(|e| e.to_string())?;
        options
            .SetShouldHighlightAllMatches(true)
            .map_err(|e| e.to_string())?;
        options
            .SetSuppressDefaultFindDialog(true)
            .map_err(|e| e.to_string())?;
        find.Stop().map_err(|e| e.to_string())?;
        find.Start(
            &options,
            &FindStartCompletedHandler::create(Box::new(move |result| {
                completed(result.map(|_| Value::Null).map_err(|e| e.to_string()));
                Ok(())
            })),
        )
        .map_err(|e| e.to_string())
    }
}
pub fn status(view: &wry::WebView) -> Result<Value, String> {
    let find = finder(view)?;
    let (mut count, mut active) = (0, -1);
    unsafe {
        find.MatchCount(&mut count).map_err(|e| e.to_string())?;
        find.ActiveMatchIndex(&mut active)
            .map_err(|e| e.to_string())?;
    }
    Ok(json!({"count":count.max(0),"active":active.max(0)}))
}
pub fn step(view: &wry::WebView, backward: bool) -> Result<(), String> {
    let find = finder(view)?;
    unsafe {
        if backward {
            find.FindPrevious()
        } else {
            find.FindNext()
        }
    }
    .map_err(|e| e.to_string())
}
pub fn stop(view: &wry::WebView) -> Result<(), String> {
    unsafe { finder(view)?.Stop() }.map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_search_data_without_treating_it_as_script() {
        assert!(validate("\"; window.close(); // 中文").is_ok());
        assert!(validate(&"x".repeat(1024)).is_ok());
        assert!(validate(&"x".repeat(1025)).is_err());
        assert!(validate("a\0b").is_err());
    }
}
