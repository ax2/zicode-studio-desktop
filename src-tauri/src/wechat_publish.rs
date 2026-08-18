//! WeChat Official Account publishing client: access token, image upload,
//! draft create/update, and free publish. Mirrors the reference Python script
//! `scripts/sync_wechat_article.py`.

use crate::articles_config::WechatConfig;
use serde_json::{json, Value};
use std::time::Duration;

const API_BASE: &str = "https://api.weixin.qq.com/cgi-bin";

#[derive(Debug, Clone)]
pub struct WechatDraftArticle {
    pub title: String,
    pub author: String,
    pub digest: String,
    pub content: String,
    pub content_source_url: String,
    pub thumb_media_id: String,
    pub need_open_comment: bool,
    pub only_fans_can_comment: bool,
}

impl WechatDraftArticle {
    fn payload(&self) -> Value {
        let mut article = json!({
            "title": self.title,
            "author": self.author,
            "digest": self.digest,
            "content": self.content,
            "content_source_url": self.content_source_url,
            "need_open_comment": i32::from(self.need_open_comment),
            "only_fans_can_comment": i32::from(self.only_fans_can_comment),
        });
        if !self.thumb_media_id.is_empty() {
            article["thumb_media_id"] = json!(self.thumb_media_id);
        }
        article
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("ZiCode-Article-Publish/1.0")
        .build()
        .map_err(|error| format!("Cannot build WeChat client: {error}"))
}

fn get_json(url: &str) -> Result<Value, String> {
    let response = client()?
        .get(url)
        .send()
        .map_err(|error| format!("WeChat request failed: {error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| format!("WeChat returned invalid JSON: {error}"))?;
    if !status.is_success() {
        return Err(format!("WeChat HTTP {status}: {body}"));
    }
    if let Some(code) = body.get("errcode").and_then(Value::as_i64) {
        if code != 0 {
            let message = body
                .get("errmsg")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            return Err(format!("WeChat error {code}: {message}"));
        }
    }
    Ok(body)
}

fn post_json(url: &str, payload: &Value) -> Result<Value, String> {
    let response = client()?
        .post(url)
        .json(payload)
        .send()
        .map_err(|error| format!("WeChat request failed: {error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| format!("WeChat returned invalid JSON: {error}"))?;
    if !status.is_success() {
        return Err(format!("WeChat HTTP {status}: {body}"));
    }
    if let Some(code) = body.get("errcode").and_then(Value::as_i64) {
        if code != 0 {
            let message = body
                .get("errmsg")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            return Err(format!("WeChat error {code}: {message}"));
        }
    }
    Ok(body)
}

pub fn get_access_token(config: &WechatConfig) -> Result<String, String> {
    if config.app_id.is_empty() || config.app_secret.is_empty() {
        return Err("WeChat AppID or AppSecret is not configured".to_string());
    }
    let url = format!(
        "{API_BASE}/token?grant_type=client_credential&appid={}&secret={}",
        config.app_id, config.app_secret
    );
    let data = get_json(&url)?;
    data.get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("WeChat did not return access_token: {data}"))
}

pub fn create_draft(token: &str, article: &WechatDraftArticle) -> Result<String, String> {
    let url = format!("{API_BASE}/draft/add?access_token={token}");
    let payload = json!({ "articles": [article.payload()] });
    let data = post_json(&url, &payload)?;
    data.get("media_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("WeChat draft/add returned no media_id: {data}"))
}

pub fn update_draft(
    token: &str,
    media_id: &str,
    index: usize,
    article: &WechatDraftArticle,
) -> Result<(), String> {
    let url = format!("{API_BASE}/draft/update?access_token={token}");
    let payload = json!({
        "media_id": media_id,
        "index": index,
        "articles": article.payload(),
    });
    post_json(&url, &payload)?;
    Ok(())
}

pub fn publish(token: &str, media_id: &str) -> Result<String, String> {
    let url = format!("{API_BASE}/freepublish/submit?access_token={token}");
    let payload = json!({ "media_id": media_id });
    let data = post_json(&url, &payload)?;
    Ok(data
        .get("publish_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_default())
}

/// Upload a cover image to WeChat permanent material; returns `thumb_media_id`.
pub fn upload_thumb_image(
    token: &str,
    bytes: &[u8],
    filename: &str,
    mime_type: &str,
) -> Result<String, String> {
    let url = format!("{API_BASE}/material/add_material?access_token={token}&type=image");
    let part = reqwest::blocking::multipart::Part::bytes(bytes.to_vec())
        .file_name(filename.to_string())
        .mime_str(mime_type)
        .map_err(|error| format!("Invalid image MIME type: {error}"))?;
    let form = reqwest::blocking::multipart::Form::new().part("media", part);
    let response = client()?
        .post(&url)
        .multipart(form)
        .send()
        .map_err(|error| format!("WeChat image upload failed: {error}"))?;
    let body: Value = response
        .json()
        .map_err(|error| format!("WeChat image upload returned invalid JSON: {error}"))?;
    body.get("media_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("WeChat add_material returned no media_id: {body}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_payload_shape_is_correct() {
        let article = WechatDraftArticle {
            title: "标题".to_string(),
            author: "Alex".to_string(),
            digest: "摘要".to_string(),
            content: "<p>正文</p>".to_string(),
            content_source_url: "https://zicode.com/blog/x/".to_string(),
            thumb_media_id: "thumb-id".to_string(),
            need_open_comment: false,
            only_fans_can_comment: false,
        };
        let payload = article.payload();
        assert_eq!(payload["title"], "标题");
        assert_eq!(payload["thumb_media_id"], "thumb-id");
        assert_eq!(payload["need_open_comment"], 0);
    }

    #[test]
    fn access_token_requires_credentials() {
        let config = WechatConfig::default();
        assert!(get_access_token(&config).is_err());
    }
}
