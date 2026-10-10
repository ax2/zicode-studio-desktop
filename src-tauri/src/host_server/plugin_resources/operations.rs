//! Bound actual resource work, including work whose HTTP waiter disconnects.
use super::*;

const MAX_OPERATIONS: usize = 8;

pub(crate) struct Operations {
    slots: Arc<tokio::sync::Semaphore>,
}

impl Default for Operations {
    fn default() -> Self {
        Self {
            slots: Arc::new(tokio::sync::Semaphore::new(MAX_OPERATIONS)),
        }
    }
}

impl Operations {
    #[cfg(test)]
    pub(super) fn active_count(&self) -> usize {
        MAX_OPERATIONS - self.slots.available_permits()
    }
    pub(super) async fn run<F, T>(&self, operation: F) -> Result<Json<T>, ApiError>
    where
        F: FnOnce() -> Result<T, ApiError> + Send + 'static,
        T: Send + 'static,
    {
        // No unbounded wait queue, and no blocking job until admission succeeds.
        let permit = self.slots.clone().try_acquire_owned().map_err(|_| {
            plugin_api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "resource_busy",
                "Resource operations are busy",
            )
        })?;
        tokio::task::spawn_blocking(move || {
            // Keep ownership in the actual worker, not its HTTP waiter.
            let _permit = permit;
            operation()
        })
        .await
        .map_err(|_| rejected("resource_store_unavailable"))?
        .map(Json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn full_budget_rejects_without_queue_and_disconnected_work_keeps_its_slot() {
        let operations = Arc::new(Operations::default());
        let mut tasks = Vec::new();
        let mut releases = Vec::new();
        for _ in 0..MAX_OPERATIONS {
            let (ready_tx, ready_rx) = oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let work = operations.clone();
            tasks.push(tokio::spawn(async move {
                work.run(move || {
                    ready_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(json!({"finished":true}))
                })
                .await
            }));
            releases.push(release_tx);
            tokio::time::timeout(Duration::from_secs(2), ready_rx)
                .await
                .unwrap()
                .unwrap();
        }
        assert_eq!(operations.slots.available_permits(), 0);
        let rejected = tokio::time::timeout(
            Duration::from_millis(200),
            operations.run::<_, Value>(|| panic!("Over-budget work must not run")),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(rejected.0, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(rejected.1 .0["error"]["code"], "resource_busy");
        let detached = tasks.remove(0);
        detached.abort();
        assert!(detached.await.unwrap_err().is_cancelled());
        assert_eq!(operations.slots.available_permits(), 0);
        assert_eq!(
            operations
                .run::<_, Value>(|| panic!("Disconnected worker still owns quota"))
                .await
                .unwrap_err()
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        for release in releases {
            release.send(()).unwrap();
        }
        for task in tasks {
            assert!(task.await.unwrap().is_ok());
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            while operations.slots.available_permits() != MAX_OPERATIONS {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            operations.run(|| Ok(json!("next"))).await.unwrap().0,
            "next"
        );
    }

    #[tokio::test]
    async fn failure_and_panic_release_actual_work_quota() {
        let operations = Operations::default();
        assert!(operations
            .run::<_, Value>(|| Err(rejected("resource_content_mismatch")))
            .await
            .is_err());
        let error = operations
            .run::<_, Value>(|| panic!("Controlled test failure"))
            .await
            .unwrap_err();
        assert_eq!(error.1 .0["error"]["code"], "resource_store_unavailable");
        assert_eq!(operations.slots.available_permits(), MAX_OPERATIONS);
        assert!(operations.run(|| Ok(Value::Null)).await.is_ok());
    }
}
