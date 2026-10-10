use super::HostServer;
use std::future::Future;
use std::time::Duration;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

#[derive(Clone, Default)]
pub(super) struct HostLifecycle {
    shutdown: CancellationToken,
    tasks: TaskTracker,
}

pub(super) struct StartupGuard(Option<HostLifecycle>);

impl StartupGuard {
    pub fn commit(&mut self) {
        self.0 = None;
    }
}

impl Drop for StartupGuard {
    fn drop(&mut self) {
        if let Some(lifecycle) = self.0.take() {
            lifecycle.stop();
        }
    }
}

impl HostLifecycle {
    pub fn startup_guard(&self) -> StartupGuard {
        StartupGuard(Some(self.clone()))
    }
    pub fn lease(&self) -> tokio_util::task::task_tracker::TaskTrackerToken {
        self.tasks.token()
    }
    pub fn stopping(&self) -> bool {
        self.shutdown.is_cancelled()
    }

    pub fn stop(&self) {
        self.shutdown.cancel();
        self.tasks.close();
    }

    pub async fn cancelled(&self) {
        self.shutdown.cancelled().await;
    }

    pub fn track<F: Future + Send + 'static>(
        &self,
        future: F,
    ) -> impl Future<Output = F::Output> + Send + 'static {
        // The library wrapper drops the future before decrementing the tracker.
        // A plain scope token can wake drain before captured resources are dropped.
        self.tasks.track_future(future)
    }

    pub fn spawn<F>(&self, future: F) -> tokio::task::JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        tokio::spawn(self.track(future))
    }

    pub fn background<F>(&self, future: F) -> tokio::task::JoinHandle<()>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        let lifecycle = self.clone();
        self.spawn(async move {
            let _ = lifecycle.until_stopped(future).await;
        })
    }

    pub fn blocking<F, T>(&self, operation: F) -> tokio::task::JoinHandle<T>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let lease = self.lease();
        tokio::task::spawn_blocking(move || {
            let _lease = lease;
            operation()
        })
    }

    pub async fn until_stopped<F: Future>(&self, future: F) -> Option<F::Output> {
        tokio::select! {
            biased;
            _ = self.cancelled() => None,
            result = future => Some(result),
        }
    }

    #[cfg(test)]
    async fn drain(&self, timeout: Duration) -> Result<(), String> {
        tokio::time::timeout(timeout, self.tasks.wait())
            .await
            .map_err(|_| {
                "Host shutdown timed out while connections or listeners were still active"
                    .to_owned()
            })
    }

    async fn drain_with_commands(
        &self,
        commands: &TaskTracker,
        terminals: &TaskTracker,
    ) -> Result<(), String> {
        tokio::time::timeout(Duration::from_secs(8), async {
            tokio::join!(self.tasks.wait(), commands.wait(), terminals.wait());
        })
        .await
        .map_err(|_| {
            "Host shutdown timed out while connections or project commands were still active"
                .to_owned()
        })
    }
}

impl HostServer {
    /// Begin shutdown without waiting. Used by the application exit event and Drop.
    pub fn request_shutdown(&self) {
        self.state.lifecycle.stop();
        self.state.runtimes.stop_all();
        self.state.project_tasks.stop_all();
        self.state.terminals.stop_all();
        if let Some(handle) = &self.lan_shutdown {
            handle.graceful_shutdown(Some(Duration::from_secs(5)));
        }
        if let Some(handle) = &self.public_shutdown {
            handle.graceful_shutdown(Some(Duration::from_secs(5)));
        }
    }

    /// Wait for tracked listeners, background jobs and upgraded connections.
    /// External clones of storage/runtime handles are not owned by this barrier.
    pub async fn stop_and_wait(self) -> Result<(), String> {
        let lifecycle = self.state.lifecycle.clone();
        let commands = self.state.project_tasks.completion_tracker();
        let terminals = self.state.terminals.completion_tracker();
        self.stop();
        lifecycle.drain_with_commands(&commands, &terminals).await
    }

    pub async fn wait_for_shutdown(&self) -> Result<(), String> {
        self.state
            .lifecycle
            .drain_with_commands(
                &self.state.project_tasks.completion_tracker(),
                &self.state.terminals.completion_tracker(),
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_startup_cancels_started_background_work() {
        let lifecycle = HostLifecycle::default();
        let guard = lifecycle.startup_guard();
        lifecycle.background(std::future::pending::<()>());
        drop(guard);
        assert!(lifecycle.stopping());
        lifecycle.drain(Duration::from_secs(1)).await.unwrap();
    }

    #[tokio::test]
    async fn cancels_background_work_and_waits_for_resource_drop() {
        let lifecycle = HostLifecycle::default();
        let resource = std::sync::Arc::new(());
        let weak = std::sync::Arc::downgrade(&resource);
        lifecycle.background(async move {
            let _resource = resource;
            std::future::pending::<()>().await;
        });
        lifecycle.stop();
        lifecycle.drain(Duration::from_secs(1)).await.unwrap();
        assert!(weak.upgrade().is_none());
        assert!(lifecycle.until_stopped(async { 1 }).await.is_none());
    }

    #[tokio::test]
    async fn timeout_does_not_report_success_or_discard_active_work() {
        let lifecycle = HostLifecycle::default();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        lifecycle.spawn(async {
            let _ = rx.await;
        });
        lifecycle.stop();
        assert!(lifecycle.drain(Duration::from_millis(5)).await.is_err());
        tx.send(()).unwrap();
        lifecycle.drain(Duration::from_secs(1)).await.unwrap();
    }
}
