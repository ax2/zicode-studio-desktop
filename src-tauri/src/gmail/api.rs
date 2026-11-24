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
            400 => "gmail_bad_request",
            401 => "gmail_reauthorize",
            403 => "gmail_permission_denied",
            404 => "gmail_not_found",
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
    };
    let mut summary = json!({"id":id,"internalDate":m["internalDate"].as_str().and_then(|s|s.parse::<i64>().ok()).unwrap_or(0),"from":header("From").unwrap_or_default(),"subject":header("Subject").unwrap_or_default(),"date":header("Date").unwrap_or_default(),"snippet":m["snippet"].as_str().unwrap_or("")});
    summary["reply"] = json!(super::reply::metadata(m, header));
    Ok(summary)
}
pub async fn labels(client: &Client, base: &str, token: &str) -> Result<Value> {
    let data = get(
        client,
        &format!("{base}/labels"),
        token,
        &[],
        2 * 1024 * 1024,
    )
    .await?;
    let rows = data["labels"].as_array().ok_or("gmail_invalid_response")?;
    let mut labels = Vec::with_capacity(rows.len());
    for row in rows {
        let id = row["id"]
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or("gmail_invalid_response")?;
        let name = row["name"]
            .as_str()
            .filter(|name| !name.is_empty())
            .ok_or("gmail_invalid_response")?;
        labels.push(json!({"id":id,"name":name}));
    }
    Ok(json!(labels))
}
pub async fn list(
    client: &Client,
    base: &str,
    token: &str,
    label: &str,
    cursor: Option<&str>,
    limit: u8,
) -> Result<Value> {
    if !valid_id(label)
        || !(1..=30).contains(&limit)
        || cursor.is_some_and(|p| p.len() > 2048 || p.chars().any(char::is_control))
    {
        return Err("gmail_invalid");
    }
    let max = limit.to_string();
    let mut query = vec![("labelIds", label), ("maxResults", max.as_str())];
    if matches!(label, "SPAM" | "TRASH") {
        query.push(("includeSpamTrash", "true"));
    }
    if let Some(c) = cursor {
        query.push(("pageToken", c))
    }
    let data = get(client, &format!("{base}/messages"), token, &query, 131072)
        .await
        .map_err(|e| {
            if cursor.is_some() && e == "gmail_bad_request" {
                "gmail_page_expired"
            } else {
                e
            }
        })?;
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
            match metadata(client, base, token, &id).await {
                Ok(m) if has_label(&m, label)? => summary(&m).map(Some),
                Ok(_) | Err("gmail_not_found") => Ok(None),
                Err(e) => Err(e),
            }
        })
        .buffered(4)
        .try_collect()
        .await?;
    Ok(
        json!({"items":items.into_iter().flatten().collect::<Vec<_>>(),"nextCursor":data["nextPageToken"].as_str()}),
    )
}
async fn metadata(client: &Client, base: &str, token: &str, id: &str) -> Result<Value> {
    if !valid_id(id) {
        return Err("gmail_invalid");
    }
    let message = get(
        client,
        &format!("{base}/messages/{id}"),
        token,
        &[
            ("format", "metadata"),
            ("metadataHeaders", "From"),
            ("metadataHeaders", "Date"),
            ("metadataHeaders", "Subject"),
            ("metadataHeaders", "Reply-To"),
            ("metadataHeaders", "Message-ID"),
            ("metadataHeaders", "References"),
            ("metadataHeaders", "In-Reply-To"),
        ],
        131072,
    )
    .await?;
    if message["id"] != id {
        return Err("gmail_invalid_response");
    }
    Ok(message)
}

fn has_label(m: &Value, label: &str) -> Result<bool> {
    match m.get("labelIds") {
        None => Ok(false),
        Some(labels) => Ok(labels
            .as_array()
            .ok_or("gmail_invalid_response")?
            .iter()
            .any(|v| v == label)),
    }
}

pub enum Membership {
    Present(Value),
    OutsideLabel,
    Deleted,
}

pub async fn membership(
    client: &Client,
    base: &str,
    token: &str,
    label: &str,
    ids: std::collections::BTreeSet<String>,
) -> Result<Vec<(String, Membership)>> {
    stream::iter(ids)
        .map(|id| async move {
            match metadata(client, base, token, &id).await {
                Err("gmail_not_found") => Ok((id, Membership::Deleted)),
                Err(error) => Err(error),
                Ok(m) => {
                    let belongs = has_label(&m, label)?;
                    Ok((
                        id,
                        if belongs {
                            Membership::Present(summary(&m)?)
                        } else {
                            Membership::OutsideLabel
                        },
                    ))
                }
            }
        })
        .buffered(4)
        .try_collect()
        .await
}

fn history_id(data: &Value) -> Result<String> {
    data["historyId"]
        .as_str()
        .filter(|s| s.parse::<u64>().is_ok())
        .map(str::to_owned)
        .ok_or("gmail_invalid_response")
}
pub async fn latest_history(client: &Client, base: &str, token: &str) -> Result<String> {
    history_id(&get(client, &format!("{base}/profile"), token, &[], 8192).await?)
}

// Read unfiltered history: a label filter can omit removals from that label.
pub async fn changes(
    client: &Client,
    base: &str,
    token: &str,
    start: &str,
    label: &str,
) -> Result<(String, std::collections::BTreeSet<String>)> {
    let mut ids = std::collections::BTreeSet::new();
    let mut seen = std::collections::HashSet::new();
    let mut page = None::<String>;
    loop {
        let mut query = vec![("startHistoryId", start), ("maxResults", "100")];
        if let Some(ref p) = page {
            query.push(("pageToken", p));
        }
        let rows = get(
            client,
            &format!("{base}/history"),
            token,
            &query,
            4 * 1024 * 1024,
        )
        .await?;
        if let Some(history) = rows.get("history") {
            for event in history.as_array().ok_or("gmail_invalid_response")? {
                for kind in [
                    "messagesAdded",
                    "messagesDeleted",
                    "labelsAdded",
                    "labelsRemoved",
                ] {
                    if let Some(values) = event.get(kind) {
                        for v in values.as_array().ok_or("gmail_invalid_response")? {
                            if kind.starts_with("labels")
                                && !v["labelIds"]
                                    .as_array()
                                    .ok_or("gmail_invalid_response")?
                                    .iter()
                                    .any(|l| l == label)
                            {
                                continue;
                            }
                            ids.insert(
                                v["message"]["id"]
                                    .as_str()
                                    .filter(|id| valid_id(id))
                                    .ok_or("gmail_invalid_response")?
                                    .to_owned(),
                            );
                        }
                    }
                }
            }
        }
        match rows.get("nextPageToken") {
            None => return Ok((history_id(&rows)?, ids)),
            Some(v) => {
                let next = v
                    .as_str()
                    .filter(|s| !s.is_empty() && s.len() <= 2048)
                    .ok_or("gmail_invalid_response")?;
                if !seen.insert(next.to_owned()) {
                    return Err("gmail_invalid_response");
                }
                page = Some(next.to_owned());
            }
        }
    }
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
fn attachments<'a>(part: &'a Value, depth: u8, found: &mut Vec<&'a Value>) -> Result<()> {
    if depth > 20 || found.len() >= 1024 {
        return Err("gmail_message_too_complex");
    }
    let named = part["filename"]
        .as_str()
        .is_some_and(|name| !name.is_empty());
    let attached = part["headers"].as_array().is_some_and(|headers| {
        headers.iter().any(|h| {
            h["name"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case("Content-Disposition"))
                && h["value"]
                    .as_str()
                    .and_then(|v| v.split(';').next())
                    .is_some_and(|v| v.trim().eq_ignore_ascii_case("attachment"))
        })
    });
    if named || attached {
        found.push(part);
    } else if part["mimeType"]
        .as_str()
        .is_some_and(|mime| mime.starts_with("multipart/"))
    {
        for child in part["parts"].as_array().into_iter().flatten() {
            attachments(child, depth + 1, found)?;
        }
    }
    Ok(())
}
fn attachment_name(part: &Value) -> &str {
    part["filename"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or("attachment.bin")
}
async fn full_message(client: &Client, base: &str, token: &str, id: &str) -> Result<Value> {
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
    Ok(m)
}
pub async fn read(client: &Client, base: &str, token: &str, id: &str) -> Result<Value> {
    let m = full_message(client, base, token, id).await?;
    let mut parts = Vec::new();
    attachments(&m["payload"], 0, &mut parts)?;
    let mut result = summary(&m)?;
    result["attachments"] = json!(parts
        .iter()
        .enumerate()
        .map(|(id, p)| json!({"id":id,"name":attachment_name(p),"size":p["body"]["size"]}))
        .collect::<Vec<_>>());
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
pub async fn attachment(
    client: &Client,
    base: &str,
    token: &str,
    id: &str,
    index: usize,
    expected: &Value,
) -> Result<Vec<u8>> {
    const LIMIT: u64 = 25 * 1024 * 1024;
    let m = full_message(client, base, token, id).await?;
    let mut parts = Vec::new();
    attachments(&m["payload"], 0, &mut parts)?;
    let part = parts.get(index).ok_or("mail_attachment_missing")?;
    let body = &part["body"];
    let size = body["size"].as_u64().ok_or("gmail_invalid_response")?;
    if expected["name"] != attachment_name(part) || expected["size"].as_u64() != Some(size) {
        return Err("mail_attachment_changed");
    }
    if size > LIMIT {
        return Err("gmail_response_too_large");
    }
    let remote;
    let encoded = if let Some(key) = body["attachmentId"].as_str() {
        if key.is_empty()
            || key.len() > 2048
            || !key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("gmail_invalid_response");
        }
        remote = get(
            client,
            &format!("{base}/messages/{id}/attachments/{key}"),
            token,
            &[],
            (size as usize).div_ceil(3) * 4 + 4096,
        )
        .await?;
        if remote["size"].as_u64() != Some(size) {
            return Err("mail_attachment_changed");
        }
        remote["data"].as_str()
    } else {
        body["data"].as_str()
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(
            encoded
                .ok_or("gmail_invalid_response")?
                .trim_end_matches('='),
        )
        .map_err(|_| "gmail_invalid_response")?;
    if bytes.len() as u64 != size {
        return Err("mail_attachment_changed");
    }
    Ok(bytes)
}
pub(super) fn valid_address(v: &str) -> bool {
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
pub(super) fn validate_message(from: &str, to: &str, subject: &str, body: &str) -> Result<()> {
    if !valid_address(from)
        || !valid_address(to)
        || subject.len() > 4096
        || subject.chars().any(char::is_control)
        || body.len() > 1_048_576
    {
        return Err("gmail_invalid_draft");
    }
    Ok(())
}
pub(super) fn mime_message(from: &str, to: &str, subject: &str, body: &str) -> Result<Vec<u8>> {
    validate_message(from, to, subject, body)?;
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
    Ok(format!("From: {from}\r\nTo: {to}\r\nSubject: {}\r\nDate: {}\r\nMessage-ID: <{}@zicode.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{folded}\r\n",words.join("\r\n "),chrono::Utc::now().to_rfc2822(),Uuid::new_v4()).into_bytes())
}
pub async fn send(
    client: &Client,
    base: &str,
    token: &str,
    raw: &str,
    thread: Option<&str>,
) -> (&'static str, Option<String>) {
    let payload = match thread {
        Some(thread) => json!({"raw":raw,"threadId":thread}),
        None => json!({"raw":raw}),
    };
    let Ok(res) = client
        .post(format!("{base}/messages/send"))
        .bearer_auth(token)
        .json(&payload)
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
