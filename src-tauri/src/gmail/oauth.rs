use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Client, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{timeout, Duration},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use zeroize::Zeroizing;
pub const READ: &str = "https://www.googleapis.com/auth/gmail.readonly";
pub const SEND: &str = "https://www.googleapis.com/auth/gmail.send";
pub type Result<T> = std::result::Result<T, &'static str>;

pub struct Config {
    pub id: String,
    pub secret: Zeroizing<String>,
}
impl Config {
    pub fn load() -> Result<Self> {
        let id =
            std::env::var("STUDIO_GMAIL_CLIENT_ID").map_err(|_| "gmail_client_not_configured")?;
        if !id.ends_with(".apps.googleusercontent.com") || id.len() > 256 {
            return Err("gmail_client_not_configured");
        }
        let secret = Zeroizing::new(
            std::env::var("STUDIO_GMAIL_CLIENT_SECRET")
                .map_err(|_| "gmail_client_not_configured")?,
        );
        if secret.is_empty() {
            return Err("gmail_client_not_configured");
        }
        Ok(Self { id, secret })
    }
}
pub struct Login {
    listener: TcpListener,
    pub redirect: String,
    pub state: String,
    pub verifier: Zeroizing<String>,
}
impl Login {
    pub async fn bind() -> Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|_| "gmail_loopback_unavailable")?;
        let redirect = format!(
            "http://{}/oauth2/callback",
            listener
                .local_addr()
                .map_err(|_| "gmail_loopback_unavailable")?
        );
        Ok(Self {
            listener,
            redirect,
            state: Uuid::new_v4().simple().to_string(),
            verifier: Zeroizing::new(format!(
                "{}{}",
                Uuid::new_v4().simple(),
                Uuid::new_v4().simple()
            )),
        })
    }
    pub fn url(&self, id: &str, address: &str, send: bool) -> Result<Url> {
        let mut url =
            Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|_| "gmail_url")?;
        let scope = if send {
            format!("{READ} {SEND}")
        } else {
            READ.into()
        };
        url.query_pairs_mut().extend_pairs([
            ("client_id", id),
            ("response_type", "code"),
            ("redirect_uri", self.redirect.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("scope", scope.as_str()),
            ("state", self.state.as_str()),
            (
                "code_challenge",
                URL_SAFE_NO_PAD
                    .encode(Sha256::digest(self.verifier.as_bytes()))
                    .as_str(),
            ),
            ("code_challenge_method", "S256"),
            ("login_hint", address),
        ]);
        Ok(url)
    }
    pub async fn wait(&self, stop: &CancellationToken) -> Result<Zeroizing<String>> {
        tokio::select! { _=stop.cancelled()=>Err("gmail_cancelled"), result=timeout(Duration::from_secs(180),async {
            loop{let (mut stream,_) =self.listener.accept().await.map_err(|_|"gmail_loopback_unavailable")?;
                let parsed=timeout(Duration::from_secs(2),self.callback(&mut stream)).await.ok().flatten();
                let line=if parsed.is_some(){"200 OK"}else{"400 Bad Request"};
                let response=format!("HTTP/1.1 {line}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\nReturn to ZiCode Studio.");
                let _=timeout(Duration::from_secs(1),stream.write_all(response.as_bytes())).await;
                if let Some(code)=parsed{return code}
            }
        })=>result.map_err(|_|"gmail_authorization_timeout")?}
    }
    async fn callback(&self, stream: &mut TcpStream) -> Option<Result<Zeroizing<String>>> {
        let mut bytes = Vec::new();
        let mut block = [0u8; 512];
        while !bytes.windows(4).any(|x| x == b"\r\n\r\n") {
            let n = stream.read(&mut block).await.ok()?;
            if n == 0 || bytes.len() + n > 8192 {
                return None;
            }
            bytes.extend_from_slice(&block[..n]);
        }
        let mut lines = std::str::from_utf8(&bytes).ok()?.split("\r\n");
        let parts: Vec<_> = lines.next()?.split(' ').collect();
        if parts.len() != 3
            || parts[0] != "GET"
            || parts[2] != "HTTP/1.1"
            || !parts[1].starts_with("/oauth2/callback?")
        {
            return None;
        }
        let base = Url::parse(&self.redirect).ok()?;
        let host = format!("127.0.0.1:{}", base.port()?);
        let hosts: Vec<_> = lines
            .filter_map(|line| line.split_once(':'))
            .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
            .collect();
        if hosts.len() != 1 || hosts[0].1.trim() != host {
            return None;
        }
        let request = base.join(parts[1]).ok()?;
        let param = |key: &str| {
            let mut values = request
                .query_pairs()
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v.into_owned());
            let v = values.next()?;
            if values.next().is_some() || v.is_empty() {
                None
            } else {
                Some(v)
            }
        };
        if param("state")? != self.state {
            return None;
        }
        if param("error").is_some() {
            return Some(Err("gmail_authorization_denied"));
        }
        Some(Ok(Zeroizing::new(param("code")?)))
    }
}

pub fn client() -> Result<Client> {
    Client::builder()
        .https_only(true)
        .retry(reqwest::retry::never())
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "gmail_network")
}
#[derive(Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}
pub async fn bytes(mut res: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "gmail_network")? {
        if chunk.len() > limit.saturating_sub(out.len()) {
            return Err("gmail_response_too_large");
        }
        out.extend_from_slice(&chunk)
    }
    Ok(out)
}
pub async fn tokens(
    client: &Client,
    url: &str,
    cfg: &Config,
    grant: &[(&str, &str)],
) -> Result<Tokens> {
    let mut fields = vec![
        ("client_id", cfg.id.as_str()),
        ("client_secret", cfg.secret.as_str()),
    ];
    fields.extend_from_slice(grant);
    let res = client
        .post(url)
        .form(&fields)
        .send()
        .await
        .map_err(|_| "gmail_network")?;
    let success = res.status().is_success();
    let body = Zeroizing::new(bytes(res, 24_576).await?);
    if !success {
        let data = serde_json::from_slice::<serde_json::Value>(&body).ok();
        return Err(
            if data.as_ref().and_then(|x| x["error"].as_str()) == Some("invalid_grant") {
                "gmail_reauthorize"
            } else {
                "gmail_token_failed"
            },
        );
    }
    let tok: Tokens = serde_json::from_slice(&body).map_err(|_| "gmail_invalid_response")?;
    if tok.access_token.is_empty() {
        return Err("gmail_invalid_response");
    }
    Ok(tok)
}
