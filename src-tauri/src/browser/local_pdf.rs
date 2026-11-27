//! A PDF selected in Studio's native picker and held only by its browser tab.
use std::{fs::File, io::Read, path::Path};
use webview2_com::{
    take_pwstr,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment, ICoreWebView2WebResourceRequestedEventArgs,
    },
};
use windows::{
    core::{w, Interface, HSTRING, PWSTR},
    Win32::System::Com::IStream,
};

// The standalone debug probe has no native file picker.
#[cfg_attr(debug_assertions, allow(dead_code))]
const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
pub(super) const WINDOW_BYTES: usize = 128 * 1024 * 1024;

#[link(name = "shlwapi")]
unsafe extern "system" {
    fn SHCreateMemStream(initial: *const u8, bytes: u32) -> *mut std::ffi::c_void;
}

pub(crate) struct Document {
    #[cfg_attr(debug_assertions, allow(dead_code))]
    name: String,
    url: String,
    bytes: Vec<u8>,
}

impl Document {
    #[cfg_attr(debug_assertions, allow(dead_code))]
    pub(crate) fn read(path: &Path) -> Result<Self, String> {
        if !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
        {
            return Err("Choose a PDF file.".into());
        }
        let file = File::open(path).map_err(|_| "Could not open the selected PDF.")?;
        let metadata = file
            .metadata()
            .map_err(|_| "Could not open the selected PDF.")?;
        if !metadata.is_file() {
            return Err("Choose a PDF file.".into());
        }
        if metadata.len() > MAX_FILE_BYTES as u64 {
            return Err("Choose a PDF no larger than 64 MiB.".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not open the selected PDF.")?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err("Choose a PDF no larger than 64 MiB.".into());
        }
        let header = bytes.get(..8).filter(|header| {
            header.starts_with(b"%PDF-")
                && header[5].is_ascii_digit()
                && header[6] == b'.'
                && header[7].is_ascii_digit()
        });
        if header.is_none() {
            return Err("The selected file is not a PDF.".into());
        }
        let name: String = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("PDF")
            .chars()
            .filter(|value| !value.is_control())
            .take(160)
            .collect();
        let id = uuid::Uuid::new_v4().simple();
        Ok(Self {
            name,
            url: format!("https://studio-local-pdf.invalid/{id}/document.pdf"),
            bytes,
        })
    }

    pub(crate) fn url(&self) -> &str {
        &self.url
    }
    #[cfg_attr(debug_assertions, allow(dead_code))]
    pub(crate) fn name(&self) -> &str {
        &self.name
    }
    pub(crate) fn len(&self) -> usize {
        self.bytes.len()
    }

    pub(crate) fn owns_url(expected: &str, requested: &str) -> bool {
        requested.split('#').next() == Some(expected)
    }

    // The response exists in this controller's event handler only. No on-disk mapping or server.
    pub(crate) fn respond(
        &self,
        environment: &ICoreWebView2Environment,
        args: &ICoreWebView2WebResourceRequestedEventArgs,
        uri: &str,
    ) -> windows::core::Result<bool> {
        if !Self::owns_url(&self.url, uri) {
            return Ok(false);
        }
        unsafe {
            let mut raw = PWSTR::null();
            args.Request()?.Method(&mut raw)?;
            let method = take_pwstr(raw);
            if method != "GET" && method != "HEAD" {
                return Ok(false);
            }
            let content = if method == "GET" {
                let stream = SHCreateMemStream(self.bytes.as_ptr(), self.bytes.len() as u32);
                if stream.is_null() {
                    return Err(windows::core::Error::from_hresult(
                        windows::Win32::Foundation::E_OUTOFMEMORY,
                    ));
                }
                Some(IStream::from_raw(stream))
            } else {
                None
            };
            let headers = HSTRING::from(format!("Content-Type: application/pdf\r\nContent-Disposition: inline\r\nContent-Length: {}\r\nAccept-Ranges: none\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff", self.bytes.len()));
            let response =
                environment.CreateWebResourceResponse(content.as_ref(), 200, w!("OK"), &headers)?;
            args.SetResponse(&response)?;
        }
        Ok(true)
    }
}

pub(super) fn block_external_navigation(view: &wry::WebView) -> windows::core::Result<()> {
    use webview2_com::{
        LaunchingExternalUriSchemeEventHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2_18,
        NewWindowRequestedEventHandler,
    };
    use wry::WebViewExtWindows;
    unsafe {
        let native = view.webview();
        native.add_NewWindowRequested(
            &NewWindowRequestedEventHandler::create(Box::new(|_, event| {
                if let Some(event) = event {
                    event.SetHandled(true)?;
                }
                Ok(())
            })),
            &mut 0,
        )?;
        native
            .cast::<ICoreWebView2_18>()?
            .add_LaunchingExternalUriScheme(
                &LaunchingExternalUriSchemeEventHandler::create(Box::new(|_, event| {
                    if let Some(event) = event {
                        event.SetCancel(true)?;
                    }
                    Ok(())
                })),
                &mut 0,
            )
    }
}
