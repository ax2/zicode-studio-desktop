//! A native page must stop delivering UI events before its controller closes.
use super::EngineEvent;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
pub(super) type Emit = Arc<dyn Fn(EngineEvent) + Send + Sync>;
pub(super) struct EventLifetime {
    live: Arc<AtomicBool>,
    emit: Emit,
}
impl EventLifetime {
    pub fn new(emit: Emit) -> (Self, Emit) {
        let live = Arc::new(AtomicBool::new(true));
        let check = live.clone();
        (
            Self {
                live,
                emit: emit.clone(),
            },
            Arc::new(move |event| {
                if check.load(Ordering::Acquire) {
                    emit(event);
                }
            }),
        )
    }
    pub fn is_live(&self) -> bool {
        self.live.load(Ordering::Acquire)
    }
    pub fn retire(&self) {
        self.live.store(false, Ordering::Release);
    }
    pub fn on_failure<F: Fn() + 'static>(&self, tab: String, hide: F) -> impl Fn() + use<F> {
        let live = self.live.clone();
        let emit = self.emit.clone();
        move || {
            if live.swap(false, Ordering::AcqRel) {
                hide();
                emit(EngineEvent::ProcessFailed { tab: tab.clone() });
            }
        }
    }
}
impl Drop for EventLifetime {
    fn drop(&mut self) {
        self.retire();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    fn title(value: &str) -> EngineEvent {
        EngineEvent::Title {
            tab: "same-restored-id".into(),
            title: value.into(),
        }
    }
    #[test]
    fn retired_page_cannot_update_recreated_identity() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let emit: Emit = Arc::new(move |event| {
            if let EngineEvent::Title { title, .. } = event {
                sink.lock().unwrap().push(title);
            }
        });
        let (old, old_callback) = EventLifetime::new(emit.clone());
        old_callback(title("before close"));
        old.retire();
        let (_new, new_callback) = EventLifetime::new(emit);
        old_callback(title("late old title"));
        new_callback(title("restored page"));
        assert_eq!(*received.lock().unwrap(), ["before close", "restored page"]);
    }
    #[test]
    fn process_failure_hides_and_retires_before_emitting_once() {
        use std::cell::Cell;
        use std::rc::Rc;

        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let emit: Emit = Arc::new(move |event| {
            let mut events = sink.lock().unwrap();
            match event {
                EngineEvent::ProcessFailed { tab } => events.push(tab),
                EngineEvent::Title { title, .. } => events.push(title),
                _ => {}
            }
        });
        let (page, callback) = EventLifetime::new(emit.clone());
        let (peer, peer_callback) = EventLifetime::new(emit);
        let hidden = Rc::new(Cell::new(0));
        let hide = hidden.clone();
        let same_page_callback = callback.clone();
        let crash = page.on_failure("failed tab".into(), move || {
            hide.set(hide.get() + 1);
            same_page_callback(title("late synchronous event"));
        });
        crash();
        crash();
        callback(title("late callback"));
        peer_callback(title("peer callback"));
        assert_eq!(hidden.get(), 1);
        assert!(!page.is_live());
        assert!(peer.is_live());
        assert_eq!(*received.lock().unwrap(), ["failed tab", "peer callback"]);
    }

    #[test]
    fn failed_creation_drop_revokes_callbacks_without_retiring_peer() {
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let sink = count.clone();
        let emit: Emit = Arc::new(move |_| {
            sink.fetch_add(1, Ordering::SeqCst);
        });
        let (failed, callback) = EventLifetime::new(emit.clone());
        let (_peer, peer_callback) = EventLifetime::new(emit);
        drop(failed);
        callback(title("late"));
        peer_callback(title("peer"));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
