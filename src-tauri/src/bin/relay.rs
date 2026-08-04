//! ZiCode rendezvous relay server (M1 prototype).
//!
//! Run with: `cargo run --bin zicode-relay -- [listen-addr]`
//! Default listen address: `127.0.0.1:9900`. In production, front this with
//! nginx TLS for `relay.zicode.com` (see docs/remote-access-server-architecture.md).

#[path = "../relay_protocol.rs"]
mod relay_protocol;
#[path = "../relay_server.rs"]
mod relay_server;

use std::sync::{Arc, Mutex};

fn main() {
    let listen = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:9900".to_string());
    let runtime = tokio::runtime::Runtime::new().expect("cannot start tokio runtime");
    runtime.block_on(async move {
        let state = Arc::new(Mutex::new(relay_server::RelayState::default()));
        let app = relay_server::relay_router(state);
        let listener = tokio::net::TcpListener::bind(&listen)
            .await
            .unwrap_or_else(|error| panic!("cannot bind relay on {listen}: {error}"));
        println!("zicode-relay listening on http://{listen}");
        axum::serve(listener, app)
            .await
            .expect("relay server failed");
    });
}
