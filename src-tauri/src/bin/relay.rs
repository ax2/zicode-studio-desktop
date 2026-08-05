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
//! Optional per-device daily byte cap: set `ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE`
//! to a byte count; devices relaying more than this per day (both directions)
//! are refused with 429 / closed. Counters reset at the start of each day.
//!
//! Optional usage persistence: set `ZICODE_RELAY_DATA_DIR` to a writable
//! directory; the relay snapshots the current day's usage every few seconds
//! and keeps up to 30 days of history, so restarts never reset a device's
//! daily quota.

#[path = "../relay_protocol.rs"]
mod relay_protocol;
#[path = "../relay_server.rs"]
mod relay_server;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn main() {
    let listen = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:9900".to_string());
    let registration_token = std::env::var("ZICODE_RELAY_REGISTRATION_TOKEN").ok();
    let byte_quota = std::env::var("ZICODE_RELAY_BYTE_QUOTA_PER_DEVICE")
        .ok()
        .and_then(|value| value.parse::<u64>().ok());
    let data_dir = std::env::var("ZICODE_RELAY_DATA_DIR")
        .ok()
        .map(PathBuf::from);
    let runtime = tokio::runtime::Runtime::new().expect("cannot start tokio runtime");
    runtime.block_on(async move {
        let mut relay_state = relay_server::RelayState::default();
        relay_state.registration_token = registration_token.clone();
        relay_state.byte_quota_per_device = byte_quota;
        if let Some(dir) = &data_dir {
            std::fs::create_dir_all(dir).expect("cannot create relay data dir");
            let (today, devices) = relay_server::load_usage(dir);
            relay_server::restore_usage(&mut relay_state, today, devices);
            relay_state.data_dir = Some(dir.clone());
        }
        let state = Arc::new(Mutex::new(relay_state));
        if let Some(dir) = &data_dir {
            let flush_state = state.clone();
            let flush_dir = dir.clone();
            tokio::spawn(async move {
                let mut tick = tokio::time::interval(Duration::from_secs(
                    relay_server::USAGE_SAVE_INTERVAL_SECONDS,
                ));
                loop {
                    tick.tick().await;
                    let (today, devices) = {
                        let state = flush_state.lock().expect("relay state poisoned");
                        relay_server::current_usage_snapshot(&state)
                    };
                    if let Err(error) = relay_server::save_usage(&flush_dir, today, &devices) {
                        eprintln!("zicode-relay: usage save failed: {error}");
                    }
                }
            });
        }
        let app = relay_server::relay_router(state);
        let listener = tokio::net::TcpListener::bind(&listen)
            .await
            .unwrap_or_else(|error| panic!("cannot bind relay on {listen}: {error}"));
        println!(
            "zicode-relay listening on http://{listen} (registration auth: {}, byte quota: {}, usage persistence: {})",
            if registration_token.is_some() {
                "on"
            } else {
                "off"
            },
            byte_quota
                .map(|quota| quota.to_string())
                .unwrap_or_else(|| "off".to_string()),
            data_dir
                .as_ref()
                .map(|dir| format!("on ({})", dir.display()))
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
