//! WebView2 keeps the controller and document while a hidden tab is suspended.
use super::event_lifetime::EventLifetime;
use std::{
    cell::Cell,
    rc::Rc,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{ICoreWebView2_3, ICoreWebView2_8},
    TrySuspendCompletedHandler,
};
use windows::core::{Interface, BOOL};
use wry::WebViewExtWindows;

const IN_USE: &str = "This tab is still in use";
const UNAVAILABLE: &str = "Browser tab is no longer available";
type Completion = Result<bool, String>;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Awake,
    Requesting,
    WakeRequested,
    Suspended,
}

#[derive(Debug, PartialEq, Eq)]
enum CompletionAction {
    Unavailable,
    Awake,
    Suspended,
    Resume,
}

#[derive(Clone, Copy, Default)]
struct Lifecycle {
    phase: Phase,
}

impl Lifecycle {
    fn begin(&mut self) -> bool {
        if matches!(self.phase, Phase::Requesting | Phase::WakeRequested) {
            return false;
        }
        self.phase = Phase::Requesting;
        true
    }

    fn wake(&mut self) -> bool {
        match self.phase {
            Phase::Awake => false,
            Phase::Requesting | Phase::WakeRequested => {
                self.phase = Phase::WakeRequested;
                true
            }
            Phase::Suspended => {
                self.phase = Phase::Awake;
                true
            }
        }
    }

    fn complete(&mut self, accepted: bool, live: bool, busy: bool) -> CompletionAction {
        let previous = std::mem::replace(&mut self.phase, Phase::Awake);
        if !live {
            CompletionAction::Unavailable
        } else if !accepted {
            CompletionAction::Awake
        } else if previous == Phase::WakeRequested || busy {
            CompletionAction::Resume
        } else {
            self.phase = Phase::Suspended;
            CompletionAction::Suspended
        }
    }
}

struct Native {
    core: ICoreWebView2_3,
    lifecycle: Cell<Lifecycle>,
    is_live: Box<dyn Fn() -> bool>,
}

impl Native {
    fn mutate<T>(&self, change: impl FnOnce(&mut Lifecycle) -> T) -> T {
        let mut lifecycle = self.lifecycle.get();
        let result = change(&mut lifecycle);
        self.lifecycle.set(lifecycle);
        result
    }

    fn wake(&self) -> windows::core::Result<()> {
        if self.mutate(Lifecycle::wake) {
            self.resume()?;
        }
        Ok(())
    }

    fn resume(&self) -> windows::core::Result<()> {
        let result = unsafe { self.core.Resume() };
        if result.is_err() {
            // A later presentation or explicit page operation may retry.
            self.mutate(|lifecycle| {
                if lifecycle.phase == Phase::Awake {
                    lifecycle.phase = Phase::Suspended;
                }
            });
        }
        result
    }
}

pub(crate) struct PageWork(Arc<AtomicUsize>);
impl Drop for PageWork {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) struct Suspension {
    native: Option<Rc<Native>>,
    work: Arc<AtomicUsize>,
}

impl Suspension {
    pub(super) fn new(view: &wry::WebView, events: &EventLifetime) -> Self {
        Self {
            native: view.webview().cast::<ICoreWebView2_3>().ok().map(|core| {
                Rc::new(Native {
                    core,
                    lifecycle: Cell::default(),
                    is_live: Box::new(events.live_check()),
                })
            }),
            work: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub(super) fn begin_work(&self) -> Result<PageWork, String> {
        self.work.fetch_add(1, Ordering::AcqRel);
        let work = PageWork(self.work.clone());
        self.wake()?;
        Ok(work)
    }

    pub(super) fn wake(&self) -> Result<(), String> {
        if let Some(native) = &self.native {
            native.wake().map_err(|_| "Could not resume this tab")?;
        }
        Ok(())
    }

    pub(super) fn request(
        &self,
        view: &wry::WebView,
        complete: impl FnOnce(Completion) + 'static,
    ) -> Result<(), String> {
        let unsupported = "This WebView2 runtime cannot suspend tabs";
        let native = self.native.as_ref().ok_or(unsupported)?;
        let audio = view
            .webview()
            .cast::<ICoreWebView2_8>()
            .map_err(|_| unsupported)?;
        let mut playing_audio = BOOL::default();
        let mut visible = BOOL::default();
        unsafe {
            audio
                .IsDocumentPlayingAudio(&mut playing_audio)
                .map_err(|_| IN_USE)?;
            view.controller()
                .IsVisible(&mut visible)
                .map_err(|_| IN_USE)?;
        }
        if playing_audio.as_bool() || visible.as_bool() || self.work.load(Ordering::Acquire) != 0 {
            return Err(IN_USE.into());
        }
        if !native.mutate(Lifecycle::begin) {
            return Err("Browser tab suspension is already in progress".into());
        }

        // The native callback holds only a weak reference to its controller.
        let weak = Rc::downgrade(native);
        let work = self.work.clone();
        let handler = TrySuspendCompletedHandler::create(Box::new(move |status, accepted| {
            let result = if let Some(native) = weak.upgrade() {
                match native.mutate(|lifecycle| {
                    lifecycle.complete(
                        status.is_ok() && accepted,
                        (native.is_live)(),
                        work.load(Ordering::Acquire) != 0,
                    )
                }) {
                    CompletionAction::Unavailable => Err(UNAVAILABLE.into()),
                    CompletionAction::Awake => Ok(false),
                    CompletionAction::Suspended => Ok(true),
                    CompletionAction::Resume => native
                        .resume()
                        .map(|()| false)
                        .map_err(|_| "Could not resume this tab".into()),
                }
            } else {
                Err(UNAVAILABLE.into())
            };
            complete(result);
            Ok(())
        }));
        if unsafe { native.core.TrySuspend(&handler) }.is_err() {
            native.lifecycle.set(Lifecycle::default());
            return Err("Could not suspend this tab".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_suspend_is_deduplicated_and_late_success_resumes_a_reselected_tab() {
        let mut lifecycle = Lifecycle::default();
        assert!(lifecycle.begin());
        assert!(!lifecycle.begin());
        assert!(lifecycle.wake());
        assert!(!lifecycle.begin());
        assert_eq!(
            lifecycle.complete(true, true, false),
            CompletionAction::Resume
        );
        assert!(!lifecycle.wake());
        assert!(lifecycle.begin());
        assert_eq!(
            lifecycle.complete(true, true, false),
            CompletionAction::Suspended
        );
        assert!(lifecycle.wake());
        assert!(!lifecycle.wake());
    }

    #[test]
    fn a_closed_controller_is_never_resumed_by_its_old_callback() {
        let mut lifecycle = Lifecycle::default();
        assert!(lifecycle.begin());
        assert!(lifecycle.wake());
        assert_eq!(
            lifecycle.complete(true, false, false),
            CompletionAction::Unavailable
        );
    }

    #[test]
    fn pending_page_work_outweighs_suspend_and_failed_attempt_is_retryable() {
        let mut lifecycle = Lifecycle::default();
        assert!(lifecycle.begin());
        assert_eq!(
            lifecycle.complete(true, true, true),
            CompletionAction::Resume
        );
        assert!(lifecycle.begin());
        assert_eq!(
            lifecycle.complete(false, true, false),
            CompletionAction::Awake
        );
        assert!(lifecycle.begin());
    }

    #[test]
    fn page_work_is_counted_until_each_operation_releases_its_lease() {
        let count = Arc::new(AtomicUsize::new(2));
        let capture = PageWork(count.clone());
        let find = PageWork(count.clone());
        drop(capture);
        assert_eq!(count.load(Ordering::Acquire), 1);
        drop(find);
        assert_eq!(count.load(Ordering::Acquire), 0);
    }
}
