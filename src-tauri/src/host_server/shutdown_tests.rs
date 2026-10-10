use super::*;
use crate::metadata_store::MetadataStore;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as ClientMessage;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shutdown_closes_idle_and_pre_handshake_sockets_and_releases_storage() {
    let root = std::env::temp_dir().join(format!("zicode-host-shutdown-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(8), auth)
        .await
        .unwrap();
    let state_weak = Arc::downgrade(&host.state);
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut idle, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    idle.send(ClientMessage::Text(json!({"type":"hello", "protocolVersion":2, "clientType":"desktop", "clientId":"shutdown-idle"}).to_string())).await.unwrap();
    idle.next().await.unwrap().unwrap();
    let (mut no_hello, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    // Leave both clients open: listener shutdown alone cannot release upgraded sockets.
    host.stop_and_wait().await.unwrap();
    assert!(
        state_weak.upgrade().is_none(),
        "a connection or listener retained HostState"
    );
    for socket in [&mut idle, &mut no_hello] {
        let frame = tokio::time::timeout(Duration::from_secs(1), socket.next())
            .await
            .unwrap();
        assert!(matches!(
            frame,
            None | Some(Err(_)) | Some(Ok(ClientMessage::Close(_)))
        ));
    }
    // No retry/sleep: completion is a resource-release barrier.
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn shared_exit_signal_stops_host_without_consuming_application_state() {
    let root = std::env::temp_dir().join(format!("zicode-host-exit-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(8), auth)
        .await
        .unwrap();
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    socket.send(ClientMessage::Text(json!({"type":"hello", "protocolVersion":2, "clientType":"desktop", "clientId":"exit-shared"}).to_string())).await.unwrap();
    socket.next().await.unwrap().unwrap();
    host.request_shutdown();
    host.wait_for_shutdown().await.unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(1), socket.next())
        .await
        .unwrap();
    assert!(matches!(
        frame,
        None | Some(Err(_)) | Some(Ok(ClientMessage::Close(_)))
    ));
    drop(socket);
    host.request_shutdown();
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
