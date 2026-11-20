use super::oauth::{self, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use futures_util::{stream, StreamExt, TryStreamExt};
use reqwest::Client;
use serde_json::{json, Value};
use uuid::Uuid;

pub const BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
async fn get(
    client: &Client,
    url: &str,
    access: &str,
    q: &[(&str, &str)],
    limit: usize,
) -> Result<Value> {
    let res = client
        .get(url)
        .bearer_auth(access)
        .query(q)
        .send()
        .await
        .map_err(|_| "gmail_network")?;
    if !res.status().is_success() {
        return Err(match res.status().as_u16() {
            401 => "gmail_reauthorize",
            403 => "gmail_permission_denied",
            429 => "gmail_rate_limited",
            _ => "gmail_api_failed",
        });
    }
    serde_json::from_slice(&oauth::bytes(res, limit).await?).map_err(|_| "gmail_invalid_response")
}
pub async fn profile(client: &Client, base: &str, token: &str) -> Result<String> {
    get(client, &format!("{base}/profile"), token, &[], 8192).await?["emailAddress"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or("gmail_invalid_response")
}
fn summary(m: &Value) -> Result<Value> {
    let id = m["id"]
        .as_str()
        .filter(|s| valid_id(s))
        .ok_or("gmail_invalid_response")?;
    let header = |name: &str| {
        m["payload"]["headers"]
            .as_array()
            .and_then(|items| {
                items.iter().find(|h| {
                    h["name"]
                        .as_str()
                        .is_some_and(|s| s.eq_ignore_ascii_case(name))
                })
            })
            .and_then(|v| v["value"].as_str())
            .unwrap_or("")
    };
    Ok(
        json!({"id":id,"from":header("From"),"subject":header("Subject"),"date":header("Date"),"snippet":m["snippet"].as_str().unwrap_or("")}),
    )
}
pub async fn list(
    client: &Client,
    base: &str,
    token: &str,
    cursor: Option<&str>,
    limit: u8,
) -> Result<Value> {
    if !(1..=30).contains(&limit)
        || cursor.is_some_and(|p| p.len() > 2048 || p.chars().any(char::is_control))
    {
        return Err("gmail_invalid");
    }
    let max = limit.to_string();
    let mut query = vec![("labelIds", "INBOX"), ("maxResults", max.as_str())];
    if let Some(c) = cursor {
        query.push(("pageToken", c))
    }
    let data = get(client, &format!("{base}/messages"), token, &query, 131072).await?;
    let ids = match data.get("messages") {
        None => vec![],
        Some(v) => v
            .as_array()
            .ok_or("gmail_invalid_response")?
            .iter()
            .map(|m| {
                m["id"]
                    .as_str()
                    .filter(|s| valid_id(s))
                    .map(str::to_owned)
                    .ok_or("gmail_invalid_response")
            })
            .collect::<Result<Vec<_>>>()?,
    };
    if ids.len() > limit as usize {
        return Err("gmail_invalid_response");
    }
    let items: Vec<_> = stream::iter(ids)
        .map(|id: String| async move {
            let m = get(
                client,
                &format!("{base}/messages/{id}"),
                token,
                &[
                    ("format", "metadata"),
                    ("metadataHeaders", "From"),
                    ("metadataHeaders", "Date"),
                    ("metadataHeaders", "Subject"),
                ],
                131072,
            )
            .await?;
            if m["id"] != id {
                return Err("gmail_invalid_response");
            }
            summary(&m)
        })
        .buffered(4)
        .try_collect()
        .await?;
    Ok(json!({"items":items,"nextCursor":data["nextPageToken"].as_str()}))
}
fn body_part(p: &Value, mime: &str, depth: u8) -> Result<Option<String>> {
    if depth > 20 {
        return Err("gmail_message_too_complex");
    }
    if p["headers"].as_array().is_some_and(|headers| {
        headers.iter().any(|header| {
            header["name"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case("Content-Disposition"))
                && header["value"]
                    .as_str()
                    .and_then(|v| v.split(';').next())
                    .is_some_and(|v| v.trim().eq_ignore_ascii_case("attachment"))
        })
    }) || p
        .get("filename")
        .and_then(Value::as_str)
        .is_some_and(|v| !v.is_empty())
    {
        return Ok(None);
    }
    if p["mimeType"]
        .as_str()
        .is_some_and(|kind| kind.eq_ignore_ascii_case(mime))
    {
        if let Some(encoded) = p["body"]["data"].as_str() {
            let body = URL_SAFE_NO_PAD
                .decode(encoded.trim_end_matches('='))
                .map_err(|_| "gmail_invalid_response")?;
            if body.len() > 1024 * 1024 {
                return Err("gmail_response_too_large");
            }
            return Ok(Some(String::from_utf8_lossy(&body).into_owned()));
        }
    }
    if let Some(parts) = p["parts"].as_array().filter(|_| {
        p["mimeType"]
            .as_str()
            .is_some_and(|kind| kind.starts_with("multipart/"))
    }) {
        for part in parts {
            if let Some(v) = body_part(part, mime, depth + 1)? {
                return Ok(Some(v));
            }
        }
    }
    Ok(None)
}
pub async fn read(client: &Client, base: &str, token: &str, id: &str) -> Result<Value> {
    if !valid_id(id) {
        return Err("gmail_invalid");
    }
    let m = get(
        client,
        &format!("{base}/messages/{id}"),
        token,
        &[("format", "full")],
        3 * 1024 * 1024,
    )
    .await?;
    if m["id"] != id {
        return Err("gmail_invalid_response");
    }
    let mut result = summary(&m)?;
    let body = body_part(&m["payload"], "text/plain", 0)?;
    let html = match body_part(&m["payload"], "text/html", 0) {
        Ok(html) => html,
        Err(_) if body.is_some() => None,
        Err(error) => return Err(error),
    };
    result["html"] = json!(html);
    result["plainText"] = json!(body);
    Ok(result)
}
fn addr(v: &str) -> bool {
    v.len() <= 254
        && v.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && !domain.is_empty()
                && !domain.contains('@')
                && local
                    .bytes()
                    .all(|x| x.is_ascii_alphanumeric() || b"._+-".contains(&x))
                && domain
                    .bytes()
                    .all(|x| x.is_ascii_alphanumeric() || b".-".contains(&x))
        })
}
pub fn raw_message(from: &str, to: &str, subject: &str, body: &str) -> Result<String> {
    if !addr(from)
        || !addr(to)
        || subject.len() > 4096
        || subject.chars().any(char::is_control)
        || body.len() > 1_048_576
    {
        return Err("gmail_invalid_draft");
    }
    let mut words = vec![];
    let mut part = String::new();
    for ch in subject.chars() {
        if part.len() + ch.len_utf8() > 42 {
            words.push(format!("=?UTF-8?B?{}?=", STANDARD.encode(part.as_bytes())));
            part.clear()
        }
        part.push(ch)
    }
    if !part.is_empty() {
        words.push(format!("=?UTF-8?B?{}?=", STANDARD.encode(part.as_bytes())))
    }
    let body = STANDARD.encode(
        body.replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\n', "\r\n"),
    );
    let folded = body
        .as_bytes()
        .chunks(76)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\r\n");
    Ok(URL_SAFE_NO_PAD.encode(format!("From: {from}\r\nTo: {to}\r\nSubject: {}\r\nDate: {}\r\nMessage-ID: <{}@zicode.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{folded}\r\n",words.join("\r\n "),chrono::Utc::now().to_rfc2822(),Uuid::new_v4())))
}
pub async fn send(
    client: &Client,
    base: &str,
    token: &str,
    raw: &str,
) -> (&'static str, Option<String>) {
    let Ok(res) = client
        .post(format!("{base}/messages/send"))
        .bearer_auth(token)
        .json(&json!({"raw":raw}))
        .send()
        .await
    else {
        return ("unknown", None);
    };
    if res.status().is_client_error() {
        return ("rejected", None);
    }
    if res.status().is_success() {
        if let Ok(bytes) = oauth::bytes(res, 65536).await {
            if let Ok(m) = serde_json::from_slice::<Value>(&bytes) {
                if let Some(id) = m["id"].as_str().filter(|s| valid_id(s)) {
                    return ("accepted", Some(id.into()));
                }
            }
        }
    }
    ("unknown", None)
}
