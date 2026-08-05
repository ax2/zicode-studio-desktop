//! JSON frames exchanged between the desktop relay agent and the rendezvous
//! relay server. The server bridges HTTP requests and WebSocket sessions
//! between a mobile client and the user's desktop without storing content.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RelayFrame {
    /// Desktop agent -> relay: register the desktop as reachable.
    Hello {
        device_id: String,
        kind: String,
        /// Optional shared registration secret (M4). The relay rejects the
        /// registration when it is configured with a token and this does not
        /// match. `None` keeps the pre-M4 open mode for development relays.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        registration_token: Option<String>,
    },
    /// Relay -> desktop agent: registration acknowledged.
    Welcome { device_id: String },
    /// Relay -> desktop agent: registration refused (bad token, malformed
    /// device id, or rate limited). The desktop should stop retrying until
    /// its configuration is fixed.
    RegistrationRejected { reason: String },
    /// Relay -> desktop agent: a mobile wants a WebSocket session.
    SessionOpen { sid: String },
    /// Desktop agent -> relay: local gateway WebSocket is ready.
    SessionReady { sid: String },
    /// Desktop agent -> relay: local gateway WebSocket failed or closed.
    SessionError { sid: String, error: String },
    /// Either side: a session is finished; the peer should tear down.
    SessionClose { sid: String },
    /// WebSocket payload bridged between the mobile and the desktop gateway.
    /// `payload` is the raw text for text frames, base64 for binary frames.
    WsFrame {
        sid: String,
        payload: String,
        binary: bool,
    },
    /// Relay -> desktop agent: execute an HTTP request against the local
    /// strict gateway and respond with `HttpResp`.
    Http {
        rid: u64,
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    },
    /// Desktop agent -> relay: HTTP response for a previous `Http` frame.
    /// `body` is base64.
    HttpResp {
        rid: u64,
        status: u16,
        headers: Vec<(String, String)>,
        body: String,
    },
}

impl RelayFrame {
    pub fn parse(text: &str) -> Result<Self, String> {
        serde_json::from_str(text).map_err(|error| format!("invalid relay frame: {error}"))
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("relay frame serialization cannot fail")
    }
}

#[cfg(test)]
mod tests {
    use super::RelayFrame;

    #[test]
    fn round_trips_all_frame_kinds_with_tagnames() {
        let frames = [
            RelayFrame::Hello {
                device_id: "dev-1".into(),
                kind: "desktop".into(),
                registration_token: None,
            },
            RelayFrame::Welcome {
                device_id: "dev-1".into(),
            },
            RelayFrame::RegistrationRejected {
                reason: "bad token".into(),
            },
            RelayFrame::SessionOpen { sid: "s-1".into() },
            RelayFrame::SessionReady { sid: "s-1".into() },
            RelayFrame::SessionError {
                sid: "s-1".into(),
                error: "boom".into(),
            },
            RelayFrame::SessionClose { sid: "s-1".into() },
            RelayFrame::WsFrame {
                sid: "s-1".into(),
                payload: "hello".into(),
                binary: false,
            },
            RelayFrame::Http {
                rid: 7,
                method: "POST".into(),
                path: "/v2/auth/exchange".into(),
                headers: vec![("content-type".into(), "application/json".into())],
                body: "e30=".into(),
            },
            RelayFrame::HttpResp {
                rid: 7,
                status: 200,
                headers: vec![],
                body: "e30=".into(),
            },
        ];
        for frame in frames {
            let json = frame.to_json();
            assert_eq!(RelayFrame::parse(&json).unwrap(), frame, "json: {json}");
        }
        assert!(RelayFrame::parse("not json").is_err());
    }
}
