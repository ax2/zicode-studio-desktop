use super::api;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS gmail_reply(
    workspace TEXT NOT NULL, account TEXT NOT NULL, draft TEXT NOT NULL, metadata TEXT NOT NULL,
    PRIMARY KEY(workspace,account,draft),
    FOREIGN KEY(workspace,account,draft) REFERENCES drafts(scope,account,id) ON DELETE CASCADE
);";

#[derive(Deserialize, Serialize)]
pub(super) struct Metadata {
    pub recipient: String,
    pub subject: String,
    pub thread: String,
    parent: String,
    references: Vec<String>,
}

fn message_id(value: &str) -> Option<&str> {
    let id = value.strip_prefix('<')?.strip_suffix('>')?;
    let (left, right) = id.split_once('@')?;
    (id.len() <= 240
        && !left.is_empty()
        && !right.is_empty()
        && !right.contains('@')
        && id
            .bytes()
            .all(|b| b.is_ascii_graphic() && !b"<>():;,\\\"".contains(&b)))
    .then_some(value)
}

fn recipient_header(message: &Value) -> Option<&str> {
    let headers = message["payload"]["headers"].as_array()?;
    let named = |header: &Value, name: &str| {
        header["name"]
            .as_str()
            .is_some_and(|field| field.eq_ignore_ascii_case(name))
    };
    // From is a fallback only when Reply-To is absent.
    let name = if headers.iter().any(|header| named(header, "Reply-To")) {
        "Reply-To"
    } else {
        "From"
    };
    let mut matches = headers.iter().filter(|header| named(header, name));
    let value = matches.next()?["value"].as_str()?;
    matches.next().is_none().then_some(value)
}

pub(super) fn metadata<'a>(
    message: &Value,
    header: impl Fn(&str) -> Option<&'a str>,
) -> Option<Metadata> {
    let (recipient, subject) = studio_alibaba_mail::parse_reply_headers(
        recipient_header(message)?,
        header("Subject").unwrap_or_default(),
    )?;
    let thread = message["threadId"]
        .as_str()
        .filter(|value| api::valid_id(value))?;
    let parent = message_id(header("Message-ID")?.trim())?;
    if !api::valid_address(&recipient)
        || subject.len() > 4096
        || subject.chars().any(char::is_control)
    {
        return None;
    }

    // Keep the most recent references so a reply cannot create an unbounded header.
    let mut references: Vec<_> = header("References")
        .or_else(|| header("In-Reply-To"))
        .unwrap_or_default()
        .split_ascii_whitespace()
        .rev()
        .filter_map(message_id)
        .filter(|value| *value != parent)
        .take(12)
        .map(str::to_owned)
        .collect();
    references.reverse();
    Some(Metadata {
        recipient,
        subject,
        thread: thread.into(),
        parent: parent.into(),
        references,
    })
}

impl Metadata {
    pub fn write_headers(&self, mime: Vec<u8>) -> Option<Vec<u8>> {
        if !api::valid_id(&self.thread)
            || message_id(&self.parent).is_none()
            || self.references.len() > 12
        {
            return None;
        }
        let mut head = format!("In-Reply-To: {}\r\nReferences:", self.parent).into_bytes();
        for (index, id) in self
            .references
            .iter()
            .chain(std::iter::once(&self.parent))
            .enumerate()
        {
            head.extend_from_slice(if index == 0 { b" " } else { b"\r\n " });
            head.extend_from_slice(message_id(id)?.as_bytes());
        }
        head.extend_from_slice(b"\r\n");
        head.extend(mime);
        Some(head)
    }
}
