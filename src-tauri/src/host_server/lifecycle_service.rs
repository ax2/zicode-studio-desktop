//! Listener completion can precede destruction of its connection services.
//! Keep shutdown waiting until those services and their request futures release state.
use std::task::{Context, Poll};
use tokio_util::task::task_tracker::{TaskTrackerToken, TrackedFuture};
use tower::Service;

#[derive(Clone)]
pub(super) struct TrackedService<S> {
    // Rust drops fields in declaration order: state must go before the lease.
    inner: S,
    lease: TaskTrackerToken,
}

impl<S> TrackedService<S> {
    pub fn new(inner: S, lease: TaskTrackerToken) -> Self {
        Self { inner, lease }
    }
}

impl<S, Request> Service<Request> for TrackedService<S>
where
    S: Service<Request>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = TrackedFuture<S::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: Request) -> Self::Future {
        self.lease
            .task_tracker()
            .track_future(self.inner.call(request))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        convert::Infallible,
        sync::{mpsc, Arc},
        time::Duration,
    };
    use tokio_util::task::TaskTracker;

    struct DropGate {
        _resource: Arc<()>,
        reached: mpsc::SyncSender<()>,
        resume: mpsc::Receiver<()>,
    }

    impl Drop for DropGate {
        fn drop(&mut self) {
            self.reached.send(()).unwrap();
            self.resume.recv_timeout(Duration::from_secs(5)).unwrap();
        }
    }

    #[tokio::test]
    async fn shutdown_waits_for_service_destructor_to_release_state() {
        let tracker = TaskTracker::new();
        let resource = Arc::new(());
        let weak = Arc::downgrade(&resource);
        let (reached_tx, reached_rx) = mpsc::sync_channel(1);
        let (resume_tx, resume_rx) = mpsc::sync_channel(1);
        let service = TrackedService::new(
            DropGate {
                _resource: resource,
                reached: reached_tx,
                resume: resume_rx,
            },
            tracker.token(),
        );
        tracker.close();
        let dropping = std::thread::spawn(move || drop(service));
        reached_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        // Deterministic destructor gate, not a timing guess about socket shutdown.
        let premature = tokio::time::timeout(Duration::from_millis(20), tracker.wait()).await;
        resume_tx.send(()).unwrap();
        dropping.join().unwrap();
        assert!(
            premature.is_err(),
            "shutdown returned before service state was dropped"
        );
        tokio::time::timeout(Duration::from_secs(1), tracker.wait())
            .await
            .unwrap();
        assert!(weak.upgrade().is_none());
    }

    #[tokio::test]
    async fn service_clones_and_unpolled_requests_keep_shutdown_pending() {
        let tracker = TaskTracker::new();
        let resource = Arc::new(());
        let weak = Arc::downgrade(&resource);
        let service = TrackedService::new(
            tower::service_fn(move |()| {
                let resource = resource.clone();
                async move {
                    let _resource = resource;
                    std::future::pending::<()>().await;
                    Ok::<_, Infallible>(())
                }
            }),
            tracker.token(),
        );
        let mut connection = service.clone();
        tracker.close();
        drop(service);
        assert!(!tracker.is_empty());
        let request = connection.call(());
        drop(connection);
        assert!(!tracker.is_empty());
        assert!(weak.upgrade().is_some());
        drop(request);
        tokio::time::timeout(Duration::from_secs(1), tracker.wait())
            .await
            .unwrap();
        assert!(weak.upgrade().is_none());
    }
}
