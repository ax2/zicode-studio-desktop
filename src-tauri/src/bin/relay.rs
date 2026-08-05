//! ZiCode rendezvous relay server (M1 prototype).
//!
//! Run with: `cargo run --bin zicode-relay -- [listen-addr]`
//! Default listen address: `127.0.0.1:9900`. In production, front this with
//! nginx TLS for `relay.zicode.com` (see docs/remote-access-server-architecture.md).
//!
//! M4 registration auth: set `ZICODE_RELAY_REGISTRATION_TOKEN` to require
//! desktop registrations to present the same token. Without it the relay runs
//! in the pre-M4 open mode (development only).

#[path = "../relay_protocol.rs"]
mod relay_protocol;
#[path = "../relay_server.rs"]
mod relay_server;

use std::sync::{Arc, Mutex};

fn main() {
    let listen = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:9900".to_string());
    let registration_token = std::env::var("ZICODE_RELAY_REGISTRATION_TOKEN").ok();
    let runtime = tokio::runtime::Runtime::new().expect("cannot start tokio runtime");
    runtime.block_on(async move {
        let mut relay_state = relay_server::RelayState::default();
        relay_state.registration_token = registration_token.clone();
        let state = Arc::new(Mutex::new(relay_state));
        let app = relay_server::relay_router(state);
        let listener = tokio::net::TcpListener::bind(&listen)
            .await
            .unwrap_or_else(|error| panic!("cannot bind relay on {listen}: {error}"));
        println!(
            "zicode-relay listening on http://{listen} (registration auth: {})",
            if registration_token.is_some() {
                "on"
            } else {
                "off"
            }
        );
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .expect("relay server failed");
    });
}
