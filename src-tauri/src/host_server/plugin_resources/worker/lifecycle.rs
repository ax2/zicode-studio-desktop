//! At most one scoped authorization watcher per admitted resource Worker (three slots).
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const INTERVAL: Duration = Duration::from_millis(100);

struct Stop<'a> {
    done: &'a AtomicBool,
    thread: thread::Thread,
}
impl Drop for Stop<'_> {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Release);
        self.thread.unpark();
    }
}

pub(super) fn watch<T>(
    cancelled: &AtomicBool,
    authorized: impl Fn() -> bool + Sync,
    on_cancel: impl Fn() + Sync,
    execute: impl FnOnce() -> T,
) -> T {
    let done = AtomicBool::new(false);
    thread::scope(|scope| {
        let watcher = scope.spawn(|| {
            while !done.load(Ordering::Acquire) && !cancelled.load(Ordering::Acquire) {
                // A failed or panicking proof check cannot keep computation authorized.
                if !std::panic::catch_unwind(std::panic::AssertUnwindSafe(&authorized))
                    .unwrap_or(false)
                {
                    cancelled.store(true, Ordering::Release);
                    on_cancel();
                    break;
                }
                thread::park_timeout(INTERVAL);
            }
        });
        let stop = Stop {
            done: &done,
            thread: watcher.thread().clone(),
        };
        let result = execute();
        drop(stop);
        watcher
            .join()
            .expect("resource authorization watcher must not panic");
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn authorization_loss_sets_cancellation_without_an_explicit_cancel_request() {
        let cancelled = AtomicBool::new(false);
        let authorized = AtomicBool::new(true);
        watch(
            &cancelled,
            || authorized.load(Ordering::Acquire),
            || {},
            || {
                authorized.store(false, Ordering::Release);
                let until = Instant::now() + Duration::from_secs(2);
                while !cancelled.load(Ordering::Acquire) && Instant::now() < until {
                    thread::sleep(Duration::from_millis(5));
                }
                assert!(cancelled.load(Ordering::Acquire));
            },
        );
    }

    #[test]
    fn proof_panic_fails_closed_and_execution_panic_does_not_leave_a_watcher() {
        let cancelled = AtomicBool::new(false);
        watch(
            &cancelled,
            || panic!("synthetic proof failure"),
            || {},
            || {
                let until = Instant::now() + Duration::from_secs(2);
                while !cancelled.load(Ordering::Acquire) && Instant::now() < until {
                    thread::sleep(Duration::from_millis(5));
                }
                assert!(cancelled.load(Ordering::Acquire));
            },
        );
        let started = Instant::now();
        assert!(std::panic::catch_unwind(|| {
            watch(
                &AtomicBool::new(false),
                || true,
                || {},
                || panic!("synthetic execution failure"),
            );
        })
        .is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
        let fresh = AtomicBool::new(false);
        assert_eq!(watch(&fresh, || true, || {}, || 42), 42);
        assert!(!fresh.load(Ordering::Acquire));
    }
}
