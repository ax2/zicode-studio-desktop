//! Desktop-side M2 P2P peer (WebRTC DataChannel answerer).
//!
//! The phone is the offerer; it dials out after pairing and exchanges
//! `p2p_offer` / `p2p_answer` / `p2p_ice` / `p2p_close` frames over the
//! authenticated runtime WebSocket. The desktop answers with `webrtc-rs`
//! and, once the DataChannel is open, carries the same runtime JSON frames
//! the phone would otherwise send over the relay. DTLS encrypts the channel
//! in transit; the desktop itself is the peer, so no extra app-layer
//! encryption is needed on this path.
//!
//! The gateway `/v2/ws` routing hook that feeds these signals and drains the
//! data channel is the next integration step; until then the module is only
//! exercised by its in-process loopback test.
#![allow(dead_code)]

use bytes::Bytes;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::data_channel_state::RTCDataChannelState;
use webrtc::data_channel::RTCDataChannel;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

/// Frames the desktop peer emits back toward the phone (`p2p_answer`,
/// `p2p_ice`, ...) and raw DataChannel messages from the phone. The host
/// drains these: signals go back over the phone's WebSocket, messages enter
/// the runtime request pipeline.
pub struct P2pAnswererHandle {
    pub signals: mpsc::UnboundedReceiver<Value>,
    pub messages: mpsc::UnboundedReceiver<Vec<u8>>,
}

pub struct P2pAnswerer {
    api: Arc<webrtc::api::API>,
    pc: Mutex<Option<Arc<RTCPeerConnection>>>,
    dc: Arc<Mutex<Option<Arc<RTCDataChannel>>>>,
    pending_ice: Mutex<Vec<Value>>,
    signal_tx: mpsc::UnboundedSender<Value>,
    message_tx: mpsc::UnboundedSender<Vec<u8>>,
}

/// Build a WebRTC API with the default media engine and interceptors.
pub fn build_api() -> Result<Arc<webrtc::api::API>, String> {
    // webrtc's DTLS uses rustls 0.23; with both aws-lc-rs and ring features
    // enabled the process must pick a provider explicitly or the handshake
    // panics on a worker thread.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    }
    let mut media_engine = MediaEngine::default();
    let registry = Registry::new();
    let registry = register_default_interceptors(registry, &mut media_engine)
        .map_err(|error| format!("cannot register interceptors: {error}"))?;
    Ok(Arc::new(
        APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build(),
    ))
}

impl P2pAnswerer {
    pub fn new() -> Result<(Self, P2pAnswererHandle), String> {
        let api = build_api()?;
        let (signal_tx, signals) = mpsc::unbounded_channel();
        let (message_tx, messages) = mpsc::unbounded_channel();
        let peer = Self {
            api,
            pc: Mutex::new(None),
            dc: Arc::new(Mutex::new(None)),
            pending_ice: Mutex::new(Vec::new()),
            signal_tx,
            message_tx,
        };
        Ok((peer, P2pAnswererHandle { signals, messages }))
    }

    /// Answerer entry: process one signaling frame from the phone. `p2p_offer`
    /// creates the peer connection and replies with `p2p_answer`; `p2p_ice`
    /// adds candidates (buffered until the offer is accepted); `p2p_close`
    /// tears the connection down.
    pub async fn handle_signal(&self, frame: Value) -> Result<(), String> {
        let frame_type = frame
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match frame_type {
            "p2p_offer" => self.accept_offer(frame).await,
            "p2p_ice" => self.add_candidate(frame).await,
            "p2p_close" => {
                self.close().await;
                Ok(())
            }
            _ => Err(format!("unsupported p2p frame type: {frame_type}")),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.dc
            .lock()
            .ok()
            .and_then(|dc| {
                dc.as_ref()
                    .map(|dc| dc.ready_state() == RTCDataChannelState::Open)
            })
            .unwrap_or(false)
    }

    /// Send one data frame to the phone over the DataChannel.
    pub async fn send(&self, data: Vec<u8>) -> Result<(), String> {
        let dc = self
            .dc
            .lock()
            .map_err(|_| "p2p state poisoned".to_string())?
            .clone()
            .ok_or_else(|| "p2p data channel not open".to_string())?;
        dc.send(&Bytes::from(data))
            .await
            .map_err(|error| format!("p2p send failed: {error}"))
            .map(|_| ())
    }

    pub async fn close(&self) {
        let pc = self.pc.lock().ok().and_then(|pc| pc.clone());
        if let Some(pc) = pc {
            let _ = pc.close().await;
        }
        if let Ok(mut dc) = self.dc.lock() {
            *dc = None;
        }
        if let Ok(mut pc) = self.pc.lock() {
            *pc = None;
        }
    }

    async fn accept_offer(&self, frame: Value) -> Result<(), String> {
        if self
            .pc
            .lock()
            .map_err(|_| "p2p state poisoned".to_string())?
            .is_some()
        {
            return Err("p2p offer while a connection already exists".to_string());
        }
        let offer_sdp = frame
            .get("sdp")
            .and_then(Value::as_str)
            .ok_or_else(|| "p2p_offer missing sdp".to_string())?;

        let config = RTCConfiguration {
            ..Default::default()
        };
        let pc = Arc::new(
            self.api
                .new_peer_connection(config)
                .await
                .map_err(|error| format!("cannot create peer connection: {error}"))?,
        );

        let signal_tx = self.signal_tx.clone();
        pc.on_ice_candidate(Box::new(move |candidate| {
            let signal_tx = signal_tx.clone();
            Box::pin(async move {
                if let Some(candidate) = candidate {
                    if let Ok(init) = candidate.to_json() {
                        let _ = signal_tx.send(json!({
                            "type": "p2p_ice",
                            "candidate": init,
                        }));
                    }
                }
            })
        }));

        let message_tx = self.message_tx.clone();
        let dc_slot = self.dc.clone();
        pc.on_data_channel(Box::new(move |channel| {
            let message_tx = message_tx.clone();
            let dc_slot = dc_slot.clone();
            Box::pin(async move {
                if let Ok(mut slot) = dc_slot.lock() {
                    *slot = Some(channel.clone());
                }
                channel.on_message(Box::new(move |message: DataChannelMessage| {
                    let message_tx = message_tx.clone();
                    Box::pin(async move {
                        let _ = message_tx.send(message.data.to_vec());
                    })
                }));
            })
        }));

        let offer = RTCSessionDescription::offer(offer_sdp.to_string())
            .map_err(|error| format!("cannot parse offer: {error}"))?;
        pc.set_remote_description(offer)
            .await
            .map_err(|error| format!("cannot accept offer: {error}"))?;

        let pending = self
            .pending_ice
            .lock()
            .map_err(|_| "p2p state poisoned".to_string())?
            .drain(..)
            .collect::<Vec<_>>();
        for candidate in pending {
            self.add_candidate_value(&pc, candidate).await?;
        }

        let answer = pc
            .create_answer(None)
            .await
            .map_err(|error| format!("cannot create answer: {error}"))?;
        pc.set_local_description(answer.clone())
            .await
            .map_err(|error| format!("cannot set local answer: {error}"))?;

        if let Ok(mut slot) = self.pc.lock() {
            *slot = Some(pc);
        }
        self.signal_tx
            .send(json!({ "type": "p2p_answer", "sdp": answer.sdp }))
            .map_err(|_| "p2p signal channel closed".to_string())
    }

    async fn add_candidate(&self, frame: Value) -> Result<(), String> {
        let candidate = frame
            .get("candidate")
            .cloned()
            .ok_or_else(|| "p2p_ice missing candidate".to_string())?;
        let pc = self
            .pc
            .lock()
            .map_err(|_| "p2p state poisoned".to_string())?
            .clone();
        match pc {
            Some(pc) => self.add_candidate_value(&pc, candidate).await,
            None => {
                self.pending_ice
                    .lock()
                    .map_err(|_| "p2p state poisoned".to_string())?
                    .push(candidate);
                Ok(())
            }
        }
    }

    async fn add_candidate_value(
        &self,
        pc: &Arc<RTCPeerConnection>,
        candidate: Value,
    ) -> Result<(), String> {
        let init = candidate_to_init(&candidate)?;
        pc.add_ice_candidate(init)
            .await
            .map_err(|error| format!("cannot add ice candidate: {error}"))
    }
}

fn candidate_to_init(
    candidate: &Value,
) -> Result<webrtc::ice_transport::ice_candidate::RTCIceCandidateInit, String> {
    let candidate_str = candidate
        .get("candidate")
        .and_then(Value::as_str)
        .ok_or_else(|| "ice candidate missing candidate string".to_string())?;
    let sdp_mid = candidate
        .get("sdpMid")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let sdp_mline_index = candidate
        .get("sdpMLineIndex")
        .and_then(Value::as_u64)
        .map(|value| value as u16);
    let username_fragment = candidate
        .get("usernameFragment")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(webrtc::ice_transport::ice_candidate::RTCIceCandidateInit {
        candidate: candidate_str.to_string(),
        sdp_mid,
        sdp_mline_index,
        username_fragment,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{timeout, Duration};

    fn sleep(ms: u64) {
        std::thread::sleep(Duration::from_millis(ms));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn desktop_answerer_round_trips_a_data_channel_message() {
        let api = build_api().expect("build api");
        let (answerer, mut answerer_handle) = P2pAnswerer::new().expect("create answerer");
        let answerer = Arc::new(answerer);

        // Offerer side mirrors the phone: raw webrtc-rs peer + data channel.
        let offerer_config = RTCConfiguration {
            ..Default::default()
        };
        let offerer = Arc::new(
            api.new_peer_connection(offerer_config)
                .await
                .expect("offerer peer connection"),
        );
        let dc = offerer
            .create_data_channel("zicode-p2p", None)
            .await
            .expect("offerer data channel");
        let (offerer_msg_tx, mut offerer_msg_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        dc.on_message(Box::new(move |message: DataChannelMessage| {
            let offerer_msg_tx = offerer_msg_tx.clone();
            Box::pin(async move {
                let _ = offerer_msg_tx.send(message.data.to_vec());
            })
        }));

        // Offerer ICE candidates flow into the desktop answerer.
        let answerer_for_ice = answerer.clone();
        offerer.on_ice_candidate(Box::new(move |candidate| {
            let answerer = answerer_for_ice.clone();
            Box::pin(async move {
                if let Some(candidate) = candidate {
                    if let Ok(init) = candidate.to_json() {
                        let _ = answerer
                            .handle_signal(json!({ "type": "p2p_ice", "candidate": init }))
                            .await;
                    }
                }
            })
        }));

        // Desktop answerer signals (answer + ICE) flow back to the offerer.
        let offerer_for_signals = offerer.clone();
        let signal_task = tokio::spawn(async move {
            let mut buffered = Vec::new();
            while let Some(frame) = answerer_handle.signals.recv().await {
                let frame_type = frame
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                match frame_type {
                    "p2p_answer" => {
                        let sdp = frame
                            .get("sdp")
                            .and_then(Value::as_str)
                            .expect("answer sdp");
                        let description =
                            RTCSessionDescription::answer(sdp.to_string()).expect("parse answer");
                        offerer_for_signals
                            .set_remote_description(description)
                            .await
                            .expect("offerer set remote answer");
                        for candidate in buffered.drain(..) {
                            let init = candidate_to_init(&candidate).expect("candidate init");
                            let _ = offerer_for_signals.add_ice_candidate(init).await;
                        }
                    }
                    "p2p_ice" => {
                        let candidate = frame.get("candidate").cloned().expect("ice candidate");
                        if offerer_for_signals.remote_description().await.is_some() {
                            let init = candidate_to_init(&candidate).expect("candidate init");
                            let _ = offerer_for_signals.add_ice_candidate(init).await;
                        } else {
                            buffered.push(candidate);
                        }
                    }
                    _ => {}
                }
            }
        });

        // Kick off negotiation.
        let offer = offerer.create_offer(None).await.expect("create offer");
        offerer
            .set_local_description(offer.clone())
            .await
            .expect("offerer set local offer");
        answerer
            .handle_signal(json!({ "type": "p2p_offer", "sdp": offer.sdp }))
            .await
            .expect("answerer accept offer");

        // Wait for the DataChannel to open (host candidates, no STUN needed).
        let connected = timeout(Duration::from_secs(15), async {
            loop {
                if answerer.is_connected() && dc.ready_state() == RTCDataChannelState::Open {
                    break;
                }
                sleep(50);
            }
        })
        .await;
        assert!(connected.is_ok(), "P2P connection did not open in time");

        // Round-trip a message in both directions.
        dc.send(&Bytes::from_static(b"ping"))
            .await
            .expect("offerer send ping");
        let received = timeout(Duration::from_secs(5), async {
            loop {
                if let Some(message) = answerer_handle.messages.recv().await {
                    break message;
                }
            }
        })
        .await
        .expect("answerer never received ping");
        assert_eq!(received, b"ping");

        answerer
            .send(b"pong".to_vec())
            .await
            .expect("answerer send pong");
        let echoed = timeout(Duration::from_secs(5), async {
            loop {
                if let Some(message) = offerer_msg_rx.recv().await {
                    break message;
                }
            }
        })
        .await
        .expect("offerer never received pong");
        assert_eq!(echoed, b"pong");

        answerer.close().await;
        let _ = offerer.close().await;
        signal_task.abort();
    }
}
