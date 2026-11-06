//! One bounded FIFO keeps native visit writes and chrome deletion requests ordered.
use crate::browser_store::{
    history::{Page, Request},
    Store,
};
use std::{
    path::PathBuf,
    sync::{
        mpsc::{sync_channel, SyncSender},
        OnceLock,
    },
};
type Job = Box<dyn FnOnce(Result<&mut Store, String>) + Send>;
static QUEUE: OnceLock<Result<SyncSender<Job>, String>> = OnceLock::new();
fn start(root: PathBuf) -> Result<SyncSender<Job>, String> {
    let (sender, receiver) = sync_channel::<Job>(128);
    std::thread::Builder::new()
        .name("browser-history".into())
        .spawn(move || {
            for job in receiver {
                let mut store = Store::open(&root);
                job(store.as_mut().map_err(|e| e.clone()));
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(sender)
}
fn submit(job: Job) -> Result<(), String> {
    let queue = QUEUE
        .get_or_init(|| start(crate::app_paths::data_root()?.join("browser")))
        .as_ref()
        .map_err(Clone::clone)?;
    queue
        .try_send(job)
        .map_err(|_| "Browser history is busy or unavailable".into())
}
pub async fn request(owner: String, request: Request) -> Result<Page, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    submit(Box::new(move |store| {
        let _ = tx.send(store.and_then(|s| s.history(&owner, request)));
    }))?;
    rx.await.map_err(|_| "Browser history worker stopped")?
}
/// App exit waits for all jobs queued before this barrier, with a bounded wait.
pub fn flush() -> Result<(), String> {
    let Some(queue) = QUEUE.get() else {
        return Ok(());
    };
    flush_queue(queue.as_ref().map_err(Clone::clone)?)
}
fn flush_queue(queue: &SyncSender<Job>) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    queue
        .try_send(Box::new(move |store| {
            let _ = tx.send(store.map(|_| ()));
        }))
        .map_err(|_| "Browser history could not queue its exit checkpoint")?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "Browser history exit checkpoint timed out")?
}
#[cfg(windows)]
pub fn record(
    owner: String,
    url: String,
    title: String,
    failed: impl FnOnce(String) + Send + 'static,
) -> Result<(), String> {
    if url == "about:blank" {
        return Ok(());
    }
    let at = chrono::Utc::now().to_rfc3339();
    submit(Box::new(move |store| {
        if let Err(error) = store.and_then(|s| s.record_visit(&owner, &url, &title, &at)) {
            failed(error);
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_clear_follows_previous_writes_but_preserves_newer_visits() {
        let root =
            std::env::temp_dir().join(format!("browser-history-queue-{}", uuid::Uuid::new_v4()));
        let queue = start(root).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        queue
            .send(Box::new(|s| {
                s.unwrap()
                    .record_visit(
                        "a",
                        "https://example.org/old",
                        "old",
                        "2026-11-05T00:00:00Z",
                    )
                    .unwrap()
            }))
            .unwrap();
        queue
            .send(Box::new(|s| {
                s.unwrap()
                    .history("a", Request::Clear { through_id: 1 })
                    .unwrap();
            }))
            .unwrap();
        queue
            .send(Box::new(|s| {
                s.unwrap()
                    .record_visit(
                        "a",
                        "https://example.org/new",
                        "new",
                        "2026-11-05T00:00:01Z",
                    )
                    .unwrap()
            }))
            .unwrap();
        queue
            .send(Box::new(move |s| {
                tx.send(
                    s.unwrap()
                        .history(
                            "a",
                            Request::List {
                                query: String::new(),
                                before: None,
                            },
                        )
                        .unwrap(),
                )
                .unwrap()
            }))
            .unwrap();
        flush_queue(&queue).unwrap();
        let page = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].title, "new");
    }
}
