//! Listen only for failures that invalidate the page or its native controller.
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
    },
    ProcessFailedEventHandler,
};
use wry::WebViewExtWindows;

fn invalidates_page(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> bool {
    matches!(
        kind,
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
            | COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
    )
}

pub(super) fn install(
    view: &wry::WebView,
    recover: impl Fn() + 'static,
) -> windows::core::Result<()> {
    let mut token = 0;
    unsafe {
        view.webview().add_ProcessFailed(
            &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                    args.ProcessFailedKind(&mut kind)?;
                    if invalidates_page(kind) {
                        recover();
                    }
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
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };

    #[test]
    fn only_browser_and_main_frame_exit_invalidate_the_controller() {
        assert!(invalidates_page(
            COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
        ));
        assert!(invalidates_page(
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
        ));
        assert!(!invalidates_page(
            COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED
        ));
        assert!(!invalidates_page(
            COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED
        ));
        assert!(!invalidates_page(
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
        ));
    }
}
