use super::{SyncError, MAX_OBJECT_BYTES};
use reqwest::{header, Client, Method, Response, StatusCode, Url};
use std::time::Duration;
use zeroize::Zeroizing;

pub(super) struct WebDav {
    client: Client,
    root: Url,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
}

pub(super) struct Resource {
    pub bytes: Vec<u8>,
    pub etag: String,
}

impl WebDav {
    pub async fn connect(
        endpoint: &str,
        username: String,
        password: String,
        vault_id: &str,
    ) -> Result<Self, SyncError> {
        let mut root = Url::parse(endpoint).map_err(|_| SyncError::InvalidConfig)?;
        let test_loopback = cfg!(test)
            && root.scheme() == "http"
            && matches!(root.host_str(), Some("127.0.0.1" | "[::1]"));
        if (root.scheme() != "https" && !test_loopback)
            || root.host_str().is_none()
            || !root.username().is_empty()
            || root.password().is_some()
            || root.query().is_some()
            || root.fragment().is_some()
            || username.is_empty()
            || username.len() > 1024
            || password.is_empty()
            || password.len() > 4096
        {
            return Err(SyncError::InvalidConfig);
        }
        let path = format!("{}/", root.path().trim_end_matches('/'));
        root.set_path(&path);
        let mut builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10));
        if test_loopback {
            builder = builder.no_proxy();
        }
        let client = builder.build().map_err(|_| SyncError::Network)?;
        let mut dav = Self {
            client,
            root,
            username: Zeroizing::new(username),
            password: Zeroizing::new(password),
        };
        dav.mkdir("zicode-notes/").await?;
        dav.root = dav.url("zicode-notes/")?;
        dav.mkdir(&format!("{vault_id}/")).await?;
        dav.root = dav.url(&format!("{vault_id}/"))?;
        dav.mkdir("objects/").await?;
        // Test conditional semantics on an owned disposable resource before any index write.
        dav.probe().await?;
        Ok(dav)
    }

    fn url(&self, path: &str) -> Result<Url, SyncError> {
        if path.is_empty()
            || path.starts_with('/')
            || path.contains("..")
            || !path
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-/._".contains(&b))
        {
            return Err(SyncError::InvalidData);
        }
        self.root.join(path).map_err(|_| SyncError::InvalidData)
    }

    fn request(&self, method: Method, path: &str) -> Result<reqwest::RequestBuilder, SyncError> {
        Ok(self
            .client
            .request(method, self.url(path)?)
            .basic_auth(self.username.as_str(), Some(self.password.as_str())))
    }

    async fn mkdir(&self, path: &str) -> Result<(), SyncError> {
        let response = self
            .request(
                Method::from_bytes(b"MKCOL").map_err(|_| SyncError::InvalidData)?,
                path,
            )?
            .send()
            .await
            .map_err(|_| SyncError::Network)?;
        match response.status() {
            StatusCode::CREATED | StatusCode::METHOD_NOT_ALLOWED => Ok(()),
            _ => Err(response_error(&response)),
        }
    }

    async fn put(
        &self,
        path: &str,
        bytes: Vec<u8>,
        expected: Option<&str>,
    ) -> Result<Response, SyncError> {
        if bytes.len() > MAX_OBJECT_BYTES + 44 {
            return Err(SyncError::TooLarge);
        }
        let mut request = self
            .request(Method::PUT, path)?
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(bytes);
        request = match expected {
            Some(etag) => request.header(header::IF_MATCH, etag),
            None => request.header(header::IF_NONE_MATCH, "*"),
        };
        request.send().await.map_err(|_| SyncError::Network)
    }

    pub async fn get(&self, path: &str, limit: usize) -> Result<Option<Resource>, SyncError> {
        let mut response = self
            .request(Method::GET, path)?
            .send()
            .await
            .map_err(|_| SyncError::Network)?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if response.status() != StatusCode::OK {
            return Err(response_error(&response));
        }
        let etag = strong_etag(&response)?;
        if response.content_length().is_some_and(|n| n > limit as u64) {
            return Err(SyncError::TooLarge);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| SyncError::Network)? {
            if chunk.len() > limit.saturating_sub(bytes.len()) {
                return Err(SyncError::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some(Resource { bytes, etag }))
    }

    pub async fn create_object(&self, path: &str, bytes: Vec<u8>) -> Result<(), SyncError> {
        let response = self.put(path, bytes.clone(), None).await?;
        if response.status() == StatusCode::PRECONDITION_FAILED {
            let existing = self
                .get(path, bytes.len())
                .await?
                .ok_or(SyncError::InvalidData)?;
            return if existing.bytes == bytes {
                Ok(())
            } else {
                Err(SyncError::InvalidData)
            };
        }
        if matches!(
            response.status(),
            StatusCode::CREATED | StatusCode::NO_CONTENT | StatusCode::OK
        ) {
            Ok(())
        } else {
            Err(response_error(&response))
        }
    }

    pub async fn commit(&self, bytes: Vec<u8>, etag: Option<&str>) -> Result<(), SyncError> {
        let response = self.put("index.zns", bytes, etag).await?;
        if matches!(
            response.status(),
            StatusCode::CREATED | StatusCode::NO_CONTENT | StatusCode::OK
        ) {
            Ok(())
        } else {
            Err(response_error(&response))
        }
    }

    async fn probe(&self) -> Result<(), SyncError> {
        let path = format!("probe-{}", uuid::Uuid::new_v4());
        let result = async {
            let first = self.put(&path, b"probe-1".to_vec(), None).await?;
            if first.status() != StatusCode::CREATED {
                return Err(response_error(&first));
            }
            let saved = self
                .get(&path, 64)
                .await?
                .ok_or(SyncError::UnsupportedServer)?;
            if saved.bytes != b"probe-1" {
                return Err(SyncError::UnsupportedServer);
            }
            let wrong_etag = format!("\"wrong-{}\"", uuid::Uuid::new_v4());
            if self
                .put(&path, b"must-not-write".to_vec(), Some(&wrong_etag))
                .await?
                .status()
                != StatusCode::PRECONDITION_FAILED
                || self
                    .put(&path, b"must-not-create".to_vec(), None)
                    .await?
                    .status()
                    != StatusCode::PRECONDITION_FAILED
            {
                return Err(SyncError::UnsupportedServer);
            }
            let written = self
                .put(&path, b"probe-2".to_vec(), Some(&saved.etag))
                .await?;
            if !matches!(written.status(), StatusCode::OK | StatusCode::NO_CONTENT) {
                return Err(response_error(&written));
            }
            let latest = self
                .get(&path, 64)
                .await?
                .ok_or(SyncError::UnsupportedServer)?;
            if latest.bytes != b"probe-2" || latest.etag == saved.etag {
                return Err(SyncError::UnsupportedServer);
            }
            Ok(())
        }
        .await;
        // Only this random probe path is eligible for cleanup; never remove a remote object/index.
        if let Ok(Some(resource)) = self.get(&path, 64).await {
            let _ = self
                .request(Method::DELETE, &path)?
                .header(header::IF_MATCH, resource.etag)
                .send()
                .await;
        }
        result
    }
}

fn strong_etag(response: &Response) -> Result<String, SyncError> {
    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|v| v.to_str().ok())
        .ok_or(SyncError::UnsupportedServer)?;
    if etag.len() < 2
        || etag.len() > 512
        || !etag.starts_with('"')
        || !etag.ends_with('"')
        || etag[1..etag.len() - 1]
            .bytes()
            .any(|b| b == b'"' || b < 0x21 || b == 0x7f)
    {
        return Err(SyncError::UnsupportedServer);
    }
    Ok(etag.to_owned())
}

fn response_error(response: &Response) -> SyncError {
    match response.status().as_u16() {
        401 | 403 => SyncError::Authentication,
        412 => SyncError::RemoteChanged,
        429 | 503 => SyncError::RateLimited {
            retry_after_seconds: response
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| h.parse::<u64>().ok())
                .unwrap_or(60)
                .clamp(1, 3600),
        },
        n => SyncError::Http(n),
    }
}
