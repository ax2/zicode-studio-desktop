use super::tests::Fixture;
use crate::{
    host_server::HostServer, metadata_store::MetadataStore, native_pi_manager::NativePiManager,
    remote_auth::RemoteAuth,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_tungstenite::{tungstenite::Message, MaybeTlsStream, WebSocketStream};
type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
async fn request(socket: &mut Socket, frame: Value) -> Value {
    socket.send(Message::Text(frame.to_string())).await.unwrap();
    tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["requestId"] == frame["requestId"] {
                    return value;
                }
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn real_host_scopes_terminal_requests_and_waits_for_active_pty_shutdown() {
    let fixture = Fixture::new();
    let public = fixture.0.join("public");
    std::fs::create_dir(&public).unwrap();
    let metadata = MetadataStore::open(&fixture.0.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_workspaces(
        public,
        NativePiManager::new(8),
        auth,
        std::collections::HashMap::from([("project".into(), fixture.0.clone())]),
    )
    .await
    .unwrap();
    let (mut socket, _) =
        tokio_tungstenite::connect_async(host.origin().replace("http://", "ws://") + "/v2/ws")
            .await
            .unwrap();
    socket.send(Message::Text(json!({"type":"hello", "protocolVersion":2, "clientType":"desktop", "desktopToken":host.desktop_token(), "clientId":"terminal-contract"}).to_string())).await.unwrap();
    socket.next().await.unwrap().unwrap();
    let missing = request(&mut socket, json!({"type":"host_request", "requestId":"missing", "operation":"terminal_open", "workspaceId":"missing", "path":fixture.0, "cols":80,"rows":24})).await;
    assert_eq!(missing["error"]["code"], "workspace_not_found");
    let opened = request(&mut socket, json!({"type":"host_request", "requestId":"open", "operation":"terminal_open", "workspaceId":"project", "path":"invalid override", "command":"must not execute", "cols":80,"rows":24})).await;
    let id = opened["terminal"]["id"].as_str().expect("real terminal id");
    let listed = request(&mut socket, json!({"type":"host_request", "requestId":"list", "operation":"terminal_list", "workspaceId":"project"})).await;
    assert_eq!(listed["terminals"][0]["id"], id);
    let input = request(&mut socket, json!({"type":"host_request", "requestId":"input", "operation":"terminal_input", "workspaceId":"project", "terminalId":id, "data":"!!!"})).await;
    assert_eq!(input["error"]["message"], "terminal_input_invalid");
    let read = request(&mut socket, json!({"type":"host_request", "requestId":"read", "operation":"terminal_read", "workspaceId":"project", "terminalId":id, "offset":0})).await;
    assert_eq!(read["terminal"]["id"], id);
    assert!(read["chunk"]["nextOffset"].is_number());
    socket.close(None).await.unwrap();
    // Closing the socket alone does not stop an interactive session; Host exit does.
    host.stop_and_wait().await.unwrap();
}
