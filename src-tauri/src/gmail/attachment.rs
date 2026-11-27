use super::{oauth::Result, store};
use std::{future::Future, path::Path};

pub(super) fn check_generation(
    path: &Path,
    scope: &str,
    account: &str,
    expected: i64,
) -> Result<()> {
    if store::cache_generation(path, scope, account)? != expected {
        return Err("mail_attachment_changed");
    }
    Ok(())
}

/// Confirm the selected message remains in scope before reading or publishing.
pub(super) async fn save_confirmed<Authority>(
    target: &Path,
    check: impl Fn() -> std::result::Result<Authority, String>,
    load: impl Future<Output = Result<Vec<u8>>>,
) -> std::result::Result<(), String> {
    drop(check()?);
    let bytes = load.await?;
    let _authority = check()?;
    crate::mail_attachment::save(target, &bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::api;
    use axum::{extract::Path as RoutePath, routing::get, Json, Router};
    use serde_json::json;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };
    use tokio::sync::Notify;

    #[tokio::test]
    async fn confirmed_attachment_checks_cache_before_network_and_again_before_save() {
        let reads = Arc::new(AtomicUsize::new(0));
        let fetches = Arc::new(AtomicUsize::new(0));
        let pending = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let read_message = {
            let reads = reads.clone();
            move |RoutePath(id): RoutePath<String>| {
                let reads = reads.clone();
                async move {
                    reads.fetch_add(1, Ordering::Relaxed);
                    Json(
                        json!({"id":id,"payload":{"mimeType":"application/octet-stream",
                        "filename":"fixture.bin","body":{"attachmentId":"fixture_key","size":4}}}),
                    )
                }
            }
        };
        let read_attachment = {
            let fetches = fetches.clone();
            let pending = pending.clone();
            let release = release.clone();
            move |RoutePath(id): RoutePath<String>| {
                let fetches = fetches.clone();
                let pending = pending.clone();
                let release = release.clone();
                async move {
                    fetches.fetch_add(1, Ordering::Relaxed);
                    if id == "hold" {
                        pending.notify_one();
                        release.notified().await;
                    }
                    Json(json!({"size":4,"data":"AP8BAg"}))
                }
            }
        };
        let app = Router::new()
            .route("/me/messages/{id}", get(read_message))
            .route(
                "/me/messages/{id}/attachments/fixture_key",
                get(read_attachment),
            );
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let base = format!("http://{}/me", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("mail.sqlite3");
        drop(rusqlite::Connection::open(&database).unwrap());
        let (workspace, account) = ("fixture-workspace", "fixture-mail");
        let body = json!({"attachments":[{"id":0,"name":"fixture.bin","size":4}]});
        store::cache(&database, workspace, account, 0, "body", "same", &body).unwrap();
        let reviewed = store::cached(&database, workspace, account, "body", "same").unwrap();
        let item = &reviewed["attachments"][0];
        let check =
            |epoch| check_generation(&database, workspace, account, epoch).map_err(String::from);
        let counts = || {
            (
                reads.load(Ordering::Relaxed),
                fetches.load(Ordering::Relaxed),
            )
        };
        let fetch =
            |id: &'static str| api::attachment(&client, &base, "loopback-only", id, 0, item);

        store::clear_cache(&database, workspace, account).unwrap();
        let stale = directory.path().join("stale.bin");
        assert_eq!(
            save_confirmed(&stale, || check(0), fetch("same")).await,
            Err("mail_attachment_changed".into())
        );
        assert_eq!(counts(), (0, 0));
        assert!(!stale.exists());

        // The same loopback response is valid, so an unguarded read would succeed.
        assert_eq!(fetch("same").await.unwrap(), [0, 255, 1, 2]);
        assert_eq!(counts(), (1, 1));

        store::cache(&database, workspace, account, 1, "body", "same", &body).unwrap();
        store::clear_cache(&database, "other-workspace", account).unwrap();
        let saved = directory.path().join("saved.bin");
        save_confirmed(&saved, || check(1), fetch("same"))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&saved).unwrap(), [0, 255, 1, 2]);
        assert_eq!(counts(), (2, 2));

        let late = directory.path().join("late.bin");
        let operation = save_confirmed(&late, || check(1), fetch("hold"));
        let expire = async {
            tokio::time::timeout(Duration::from_secs(4), pending.notified())
                .await
                .unwrap();
            store::clear_cache(&database, workspace, account).unwrap();
            release.notify_one();
        };
        let (result, ()) = tokio::join!(operation, expire);
        assert_eq!(result, Err("mail_attachment_changed".into()));
        assert_eq!(counts(), (3, 3));
        assert!(!late.exists());
        assert_eq!(std::fs::read(saved).unwrap(), [0, 255, 1, 2]);
        server.abort();
    }
}
