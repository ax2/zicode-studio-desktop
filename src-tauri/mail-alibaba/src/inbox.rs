use super::*;
use mail_parser::MessageParser;
use native_tls::{TlsConnector, TlsStream};
use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Instant,
};
#[derive(Copy, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cursor {
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
    pub uid_validity: u32,
    pub messages: Vec<Summary>,
    pub next: Option<Cursor>,
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
    fn inbox(&self, address: &str, password: &str) -> Result<(imap::Session<Bounded>, u32, u32)> {
        self.inbox_with_limit(address, password, 8 * 1024 * 1024)
    }
    fn inbox_with_limit(&self, address: &str, password: &str, limit: usize) -> Result<(imap::Session<Bounded>, u32, u32)> {
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
        let mut session = client
            .login(address, password)
            .map_err(|(error, _)| match error {
                imap::error::Error::No(_) => "mail_client_password_or_admin_policy",
                _ => "mail_connect",
            })?;
        let book = session
            .examine("INBOX")
            .map_err(|_| "mail_inbox_unavailable")?;
        let validity = book
            .uid_validity
            .filter(|n| *n > 0)
            .ok_or("mail_uid_validity")?;
        Ok((session, validity, book.exists))
    }
    pub(crate) fn list(
        &self,
        address: &str,
        password: &str,
        cursor: Option<Cursor>,
        limit: u8,
    ) -> Result<Page> {
        if !(1..=40).contains(&limit) || cursor.is_some_and(|c| c.before == 0) {
            return Err("mail_invalid_page");
        }
        let (mut session, validity, exists) = self.inbox(address, password)?;
        if cursor.is_some_and(|c| c.uid_validity != validity) {
            return Err("mail_inbox_changed");
        }
        // Sequence positions are contiguous even when UIDs span billions. The exact UID cursor
        // normally costs one small lookup; if it was expunged, find its predecessor in <=32 probes.
        let end = match cursor {
            None => exists,
            Some(c) => older_end(&mut session, exists, c.before)?,
        };
        let start = end.saturating_sub(u32::from(limit) - 1).max(1);
        let mut messages = Vec::new();
        if end > 0 {
            let rows = session
                .fetch(
                    format!("{start}:{end}"),
                    "(UID RFC822.SIZE BODY.PEEK[HEADER]<0.65536>)",
                )
                .map_err(|_| "mail_list_failed")?;
            for r in rows.iter() {
                // Servers can deliver unsolicited flag-only FETCH responses.
                let Some(header) = r.header() else { continue };
                let uid = r.uid.filter(|u| *u > 0).ok_or("mail_protocol")?;
                if !(start..=end).contains(&r.message) || cursor.is_some_and(|c| uid >= c.before) {
                    return Err("mail_inbox_changed");
                }
                if header.len() >= MAX_HEADER {
                    return Err("mail_header_too_large");
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
                before: m.uid,
                uid_validity: validity,
            })
        } else {
            None
        };
        Ok(Page {
            uid_validity: validity,
            messages,
            next,
        })
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
    let m = MessageParser::new()
        .parse(bytes)
        .ok_or("mail_mime_invalid")?;
    Ok(metadata(&m, uid, size))
}
fn metadata(m: &mail_parser::Message<'_>, uid: u32, size: u32) -> Summary {
    let sender = m
        .from()
        .and_then(|a| a.first())
        .and_then(|m| m.address())
        .unwrap_or_default();
    let reply = m
        .reply_to()
        .and_then(|a| a.first())
        .and_then(|m| m.address())
        .unwrap_or(sender);
    Summary {
        uid,
        size,
        sender: sender.into(),
        reply_to: reply.into(),
        subject: m.subject().unwrap_or_default().into(),
        message_id: m.message_id().filter(|id| valid_id(id)).map(str::to_owned),
    }
}
pub(crate) fn valid_id(id: &str) -> bool {
    id.len() <= 512
        && id.contains('@')
        && id
            .bytes()
            .all(|b| b.is_ascii_graphic() && !matches!(b, b'<' | b'>'))
}
