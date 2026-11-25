use super::*;
use mail_parser::MessageParser;
use native_tls::{TlsConnector, TlsStream};
use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Instant,
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cursor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    pub uid_validity: u32,
    pub before: u32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub uid: u32,
    pub subject: String,
    pub sender: String,
    pub reply_to: String,
    pub message_id: Option<String>,
    pub size: u32,
    #[serde(default)]
    pub header_limited: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: usize,
    pub name: String,
    pub size: usize,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Letter {
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub body_limited: bool,
    pub summary: Summary,
    pub text: String,
    pub html: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(default)]
    pub pending: bool,
    pub uid_validity: u32,
    pub messages: Vec<Summary>,
    pub next: Option<Cursor>,
}
#[derive(Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
}

// IMAP modified UTF-7 uses UTF-16BE runs after '&', with ',' in place of '/'.
fn folder_name(mut wire: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
    let mut name = String::new();
    while let Some((plain, tail)) = wire.split_once('&') {
        name.push_str(plain);
        let (encoded, rest) = tail.split_once('-')?;
        if encoded.is_empty() {
            name.push('&');
        } else {
            let bytes = STANDARD_NO_PAD.decode(encoded.replace(',', "/")).ok()?;
            if bytes.len() % 2 != 0 { return None; }
            let units = bytes.chunks_exact(2).map(|b| u16::from_be_bytes([b[0], b[1]]));
            for letter in char::decode_utf16(units) { name.push(letter.ok()?); }
        }
        wire = rest;
    }
    name.push_str(wire);
    Some(name)
}
struct Bounded {
    stream: TlsStream<TcpStream>,
    left: usize,
    deadline: Instant,
}
impl Read for Bounded {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if self.left == 0 || Instant::now() >= self.deadline {
            return Err(io::Error::other("mail_read_limit"));
        }
        let len = out.len().min(self.left);
        let n = self.stream.read(&mut out[..len])?;
        self.left -= n;
        Ok(n)
    }
}
impl Write for Bounded {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.stream.write(b)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}
impl Alibaba {
    fn inbox(&self, address: &str, password: &str, folder: &str) -> Result<(imap::Session<Bounded>, u32, u32)> {
        self.inbox_with_limit(address, password, folder, 8 * 1024 * 1024)
    }
    fn inbox_with_limit(&self, address: &str, password: &str, folder: &str, limit: usize) -> Result<(imap::Session<Bounded>, u32, u32)> {
        let mut session = self.login(address, password, limit)?;
        let book = session.examine(folder).map_err(|_| "mail_inbox_unavailable")?;
        let validity = book.uid_validity.filter(|n| *n > 0).ok_or("mail_uid_validity")?;
        Ok((session, validity, book.exists))
    }
    fn login(&self, address: &str, password: &str, limit: usize) -> Result<imap::Session<Bounded>> {
        let mut tls = TlsConnector::builder();
        tls.min_protocol_version(Some(native_tls::Protocol::Tlsv12));
        if let Some(der) = &self.extra_root {
            tls.add_root_certificate(
                native_tls::Certificate::from_der(der).map_err(|_| "mail_tls")?,
            );
        }
        let deadline = Instant::now() + TIMEOUT;
        let tcp = (self.imap_host.as_str(), self.imap_port)
            .to_socket_addrs()
            .map_err(|_| "mail_connect")?
            .find_map(|ip| {
                TcpStream::connect_timeout(&ip, deadline.saturating_duration_since(Instant::now()))
                    .ok()
            })
            .ok_or("mail_connect")?;
        tcp.set_read_timeout(Some(TIMEOUT))
            .and_then(|_| tcp.set_write_timeout(Some(TIMEOUT)))
            .map_err(|_| "mail_connect")?;
        let stream = tls
            .build()
            .map_err(|_| "mail_tls")?
            .connect(&self.imap_host, tcp)
            .map_err(|_| "mail_tls")?;
        let mut client = imap::Client::new(Bounded {
            stream,
            left: limit,
            deadline: Instant::now() + TIMEOUT * 2,
        });
        client.read_greeting().map_err(|_| "mail_protocol")?;
        client
            .login(address, password)
            .map_err(|(error, _)| match error {
                imap::error::Error::No(_) => "mail_client_password_or_admin_policy",
                _ => "mail_connect",
            })
    }
    pub(crate) fn folders(&self, address: &str, password: &str) -> Result<Vec<Folder>> {
        use imap::types::NameAttribute;
        let mut session = self.login(address, password, 2 * 1024 * 1024)?;
        let names = session.list(Some(""), Some("*")).map_err(|_| "mail_protocol")?;
        let mut folders = std::collections::BTreeMap::new();
        for entry in names.iter() {
            if entry.attributes().iter().any(|attr| match attr {
                NameAttribute::NoSelect => true,
                NameAttribute::Custom(s) => s.eq_ignore_ascii_case("\\noselect") || s.eq_ignore_ascii_case("\\nonexistent"),
                _ => false,
            }) { continue; }
            let name = entry.name();
            if name.is_empty() || name.chars().any(char::is_control) { continue; }
            let id = if name.eq_ignore_ascii_case("INBOX") { "INBOX" } else { name };
            folders.entry(id.to_owned()).or_insert_with(|| folder_name(id).unwrap_or_else(|| id.to_owned()));
        }
        let _ = session.logout();
        Ok(folders.into_iter().map(|(id,name)| Folder { id, name }).collect())
    }
    pub(crate) fn list(
        &self,
        address: &str,
        password: &str,
        folder: &str,
        cursor: Option<Cursor>,
        limit: u8,
        cached: &[u32],
    ) -> Result<(Page, Vec<u32>)> {
        if !(1..=40).contains(&limit) || cursor.as_ref().is_some_and(|c| c.before == 0) {
            return Err("mail_invalid_page");
        }
        let (mut session, validity, exists) = self.inbox(address, password, folder)?;
        if cursor.as_ref().is_some_and(|c| c.uid_validity != validity) {
            return Err("mail_inbox_changed");
        }
        // Sequence positions are contiguous even when UIDs span billions. The exact UID cursor
        // normally costs one small lookup; if it was expunged, find its predecessor in <=32 probes.
        let end = match cursor.as_ref() {
            None => exists,
            Some(c) => older_end(&mut session, exists, c.before)?,
        };
        let start = end.saturating_sub(u32::from(limit) - 1).max(1);
        let mut messages = Vec::new();
        if end > 0 {
            let rows = session
                .fetch(
                    format!("{start}:{end}"),
                    format!("(UID RFC822.SIZE BODY.PEEK[HEADER]<0.{MAX_HEADER}>)"),
                )
                .map_err(|_| "mail_list_failed")?;
            for r in rows.iter() {
                // Servers can deliver unsolicited flag-only FETCH responses.
                let Some(header) = r.header() else { continue };
                let uid = r.uid.filter(|u| *u > 0).ok_or("mail_protocol")?;
                if !(start..=end).contains(&r.message) || cursor.as_ref().is_some_and(|c| uid >= c.before) {
                    return Err("mail_inbox_changed");
                }
                messages.push(summary(header, uid, r.size.ok_or("mail_protocol")?)?);
            }
            messages.sort_unstable_by_key(|m| std::cmp::Reverse(m.uid));
            if messages.len() != (end - start + 1) as usize
                || messages.windows(2).any(|pair| pair[0].uid == pair[1].uid)
            {
                return Err("mail_inbox_changed");
            }
        }
        let next = if start > 1 {
            messages.last().map(|m| Cursor {
                folder: (folder != "INBOX").then(|| folder.to_owned()),
                before: m.uid,
                uid_validity: validity,
            })
        } else {
            None
        };
        let mut removed = Vec::new();
        if cursor.is_none() && !cached.is_empty() {
            let page_ids: std::collections::HashSet<_> = messages.iter().map(|m| m.uid).collect();
            let mut older = Vec::new();
            for &uid in cached {
                if next.as_ref().is_some_and(|c| uid < c.before) {
                    older.push(uid);
                } else if !page_ids.contains(&uid) {
                    removed.push(uid);
                }
            }
            // Probe only previously downloaded UIDs outside the refreshed window.
            // UID SEARCH returns identifiers without downloading old message headers.
            for batch in older.chunks(128) {
                let ids = batch.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
                let present = session.uid_search(format!("UID {ids}")).map_err(|_| "mail_list_failed")?;
                removed.extend(batch.iter().copied().filter(|uid| !present.contains(uid)));
            }
        }
        Ok((Page {
            pending: false,
            uid_validity: validity,
            messages,
            next,
        }, removed))
    }
}
#[path = "inbox_parts.rs"]
mod parts;
fn older_end(session: &mut imap::Session<Bounded>, exists: u32, before: u32) -> Result<u32> {
    if before <= 1 || exists == 0 {
        return Ok(0);
    }
    let exact = session
        .uid_fetch(before.to_string(), "(UID)")
        .map_err(|_| "mail_list_failed")?;
    if let Some(seq) = exact
        .iter()
        .find(|row| row.uid == Some(before))
        .map(|r| r.message)
    {
        return if seq > 0 && seq <= exists {
            Ok(seq - 1)
        } else {
            Err("mail_inbox_changed")
        };
    }
    let (mut lo, mut hi) = (1u64, u64::from(exists) + 1);
    while lo < hi {
        let mid = (lo + hi) / 2;
        let rows = session
            .fetch(mid.to_string(), "(UID)")
            .map_err(|_| "mail_list_failed")?;
        let uid = rows
            .iter()
            .find(|r| u64::from(r.message) == mid)
            .and_then(|r| r.uid)
            .filter(|u| *u > 0)
            .ok_or("mail_inbox_changed")?;
        if uid < before {
            lo = mid + 1
        } else {
            hi = mid
        }
    }
    Ok((lo - 1) as u32)
}
fn summary(bytes: &[u8], uid: u32, size: u32) -> Result<Summary> {
    let bounded = &bytes[..bytes.len().min(MAX_HEADER)];
    let clipped = bytes.len() >= MAX_HEADER
        && !bounded.ends_with(b"\r\n\r\n")
        && !bounded.ends_with(b"\n\n");
    let header = if clipped {
        complete_header_fields(bounded)
    } else {
        bounded
    };
    match MessageParser::new().parse_headers(header) {
        Some(message) => Ok(metadata(&message, uid, size, clipped)),
        None if clipped => Ok(Summary {
            uid,
            size,
            subject: String::new(),
            sender: String::new(),
            reply_to: String::new(),
            message_id: None,
            header_limited: true,
        }),
        None => Err("mail_mime_invalid"),
    }
}

fn complete_header_fields(prefix: &[u8]) -> &[u8] {
    // A field is complete only if the prefix contains the start of the next
    // field. A folded line at the limit can still change an address.
    let mut last_field = 0;
    let mut offset = 0;
    for line in prefix.split_inclusive(|byte| *byte == b'\n') {
        if !matches!(line.first(), Some(b' ' | b'\t')) {
            last_field = offset;
        }
        offset += line.len();
    }
    &prefix[..last_field]
}

fn metadata(m: &mail_parser::Message<'_>, uid: u32, size: u32, header_limited: bool) -> Summary {
    let sender = m
        .from()
        .and_then(|a| a.first())
        .and_then(|m| m.address())
        .unwrap_or_default();
    // Clipped headers are only useful for display. Reconstruct no recipient.
    let reply = if header_limited {
        ""
    } else {
        m.reply_to()
            .and_then(|a| a.first())
            .and_then(|m| m.address())
            .unwrap_or(sender)
    };
    Summary {
        uid,
        size,
        sender: sender.into(),
        reply_to: reply.into(),
        subject: m.subject().unwrap_or_default().into(),
        message_id: m.message_id().filter(|id| valid_id(id)).map(str::to_owned),
        header_limited,
    }
}
pub(crate) fn valid_id(id: &str) -> bool {
    id.len() <= 512
        && id.contains('@')
        && id
            .bytes()
            .all(|b| b.is_ascii_graphic() && !matches!(b, b'<' | b'>'))
}
