//! Trusted, top-frame document type from WebView2's own committed frame.
use serde::Deserialize;
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::ICoreWebView2,
};
use windows::core::{w, PWSTR};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameResponse {
    frame_tree: FrameTree,
}

#[derive(Deserialize)]
struct FrameTree {
    frame: Frame,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    mime_type: String,
    url: String,
}

fn document_url(value: &str) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    url.set_fragment(None);
    Some(url)
}

fn is_pdf(raw: &str, expected: &reqwest::Url) -> bool {
    if raw.len() > 512 * 1024 {
        return false;
    }
    serde_json::from_str::<FrameResponse>(raw).is_ok_and(|value| {
        let frame = value.frame_tree.frame;
        frame.mime_type == "application/pdf" && document_url(&frame.url).as_ref() == Some(expected)
    })
}

pub(super) fn classify_pdf(
    view: &ICoreWebView2,
    complete: impl FnOnce(bool) + 'static,
) -> windows::core::Result<()> {
    unsafe {
        let mut value = PWSTR::null();
        view.Source(&mut value)?;
        let value = take_pwstr(value);
        let Some(expected) = document_url(&value) else {
            return Ok(());
        };
        // Read only the root frame record. Nested frames can have a different MIME.
        view.CallDevToolsProtocolMethod(
            w!("Page.getFrameTree"),
            w!("{}"),
            &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, response| {
                    complete(status.is_ok() && is_pdf(&response, &expected));
                    Ok(())
                },
            )),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_uses_the_committed_root_http_document_type() {
        let url = document_url("https://example.invalid/report#page=2").unwrap();
        let root_pdf = r#"{"frameTree":{"frame":{"url":"https://example.invalid/report","mimeType":"application/pdf"}}}"#;
        let nested_pdf = r#"{"frameTree":{"frame":{"url":"https://example.invalid/report","mimeType":"text/html"},"childFrames":[{"frame":{"url":"https://example.invalid/report.pdf","mimeType":"application/pdf"}}]}}"#;
        assert!(is_pdf(root_pdf, &url));
        assert!(!is_pdf(nested_pdf, &url));
        assert!(!is_pdf(
            root_pdf,
            &document_url("https://example.invalid/another").unwrap()
        ));
        assert!(!is_pdf("{}", &url));
        assert!(document_url("file:///report.pdf").is_none());
    }
}
