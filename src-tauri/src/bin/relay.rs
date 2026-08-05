//! ZiCode rendezvous relay server (M1 prototype).
//!
//! Run with: `cargo run --bin zicode-relay -- [listen-addr]`
//! Default listen address: `127.0.0.1:9900`. In production, front this with
//! nginx TLS for `relay.zicode.com` (see docs/remote-access-server-architecture.md).
//!
//! M4 registration auth: set `ZICODE_RELAY_REGISTRATION_TOKEN` to require
//! desktop registrations to present the same token. Without it the relay runs
//! in the pre-M4 open mode (development only).
//!
//! Optional per-device byte cap: set `ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE` to a
//! byte count; devices relaying more than this (both directions) are refused
//! with 429 / closed.

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
    let byte_quota = std::env::var("ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE")
        .ok()
        .and_then(|value| value.parse::<u64>().ok());
    let runtime = tokio::runtime::Runtime::new().expect("cannot start tokio runtime");
    runtime.block_on(async move {
        let mut relay_state = relay_server::RelayState::default();
        relay_state.registration_token = registration_token.clone();
        relay_state.byte_quota_per_device = byte_quota;
        let state = Arc::new(Mutex::new(relay_state));
        let app = relay_server::relay_router(state);
        let listener = tokio::net::TcpListener::bind(&listen)
            .await
            .unwrap_or_else(|error| panic!("cannot bind relay on {listen}: {error}"));
        println!(
            "zicode-relay listening on http://{listen} (registration auth: {}, byte quota: {})",
            if registration_token.is_some() {
                "on"
            } else {
                "off"
            },
            byte_quota
                .map(|quota| quota.to_string())
                .unwrap_or_else(|| "off".to_string())
        );
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .expect("relay server failed");
    });
}
