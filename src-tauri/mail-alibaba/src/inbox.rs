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
pub struct Letter {
    pub summary: Summary,
    pub text: String,
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
    fn inbox(&self, address: &str, password: &str) -> Result<(imap::Session<Bounded>, u32)> {
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
            left: 8 * 1024 * 1024,
            deadline: Instant::now() + TIMEOUT * 2,
        });
        client.read_greeting().map_err(|_| "mail_protocol")?;
        let mut session = client
            .login(address, password)
            .map_err(|(error, _)| match error {
                imap::error::Error::No(_) => "mail_client_password_or_admin_policy",
                _ => "mail_connect",
            })?;
        let validity = session
            .examine("INBOX")
            .map_err(|_| "mail_inbox_unavailable")?
            .uid_validity
            .filter(|n| *n > 0)
            .ok_or("mail_uid_validity")?;
        Ok((session, validity))
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
        let (mut session, validity) = self.inbox(address, password)?;
        if cursor.is_some_and(|c| c.uid_validity != validity) {
            return Err("mail_inbox_changed");
        }
        let upper = cursor.map_or(u32::MAX, |c| c.before - 1);
        let mut uids = if upper == 0 {
            Vec::new()
        } else {
            session
                .uid_search(format!("UID 1:{upper}"))
                .map_err(|_| "mail_list_failed")?
                .into_iter()
                .filter(|uid| *uid > 0 && *uid <= upper)
                .collect::<Vec<_>>()
        };
        uids.sort_unstable_by(|a, b| b.cmp(a));
        let more = uids.len() > limit as usize;
        uids.truncate(limit as usize);
        let mut messages = Vec::new();
        if !uids.is_empty() {
            let ids = uids
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let rows = session
                .uid_fetch(ids, "(UID RFC822.SIZE BODY.PEEK[HEADER]<0.65536>)")
                .map_err(|_| "mail_list_failed")?;
            for r in rows.iter() {
                let Some(uid) = r.uid.filter(|uid| uids.contains(uid)) else {
                    continue;
                };
                // Servers can deliver unsolicited flag-only FETCH responses.
                let Some(header) = r.header() else { continue };
                if header.len() >= MAX_HEADER {
                    return Err("mail_header_too_large");
                }
                messages.push(summary(header, uid, r.size.ok_or("mail_protocol")?)?);
            }
            messages.sort_unstable_by_key(|m| std::cmp::Reverse(m.uid));
        }
        let next = if more {
            uids.last().map(|uid| Cursor {
                before: *uid,
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
    pub(crate) fn letter(
        &self,
        address: &str,
        password: &str,
        validity: u32,
        uid: u32,
    ) -> Result<Letter> {
        if uid == 0 || validity == 0 {
            return Err("mail_invalid_uid");
        }
        let (mut session, current) = self.inbox(address, password)?;
        if current != validity {
            return Err("mail_inbox_changed");
        }
        let rows = session
            .uid_fetch(
                uid.to_string(),
                format!("(UID RFC822.SIZE BODY.PEEK[]<0.{}>)", MAX_MESSAGE + 1),
            )
            .map_err(|_| "mail_read_failed")?;
        let r = rows
            .iter()
            .find(|r| r.uid == Some(uid) && r.body().is_some())
            .ok_or("mail_message_missing")?;
        let bytes = r.body().ok_or("mail_protocol")?;
        let size = r.size.ok_or("mail_protocol")?;
        if size as usize > MAX_MESSAGE || bytes.len() > MAX_MESSAGE {
            return Err("mail_message_too_large");
        }
        if bytes.len() != size as usize {
            return Err("mail_partial_message");
        }
        let m = MessageParser::new()
            .parse(bytes)
            .ok_or("mail_mime_invalid")?;
        Ok(Letter {
            summary: metadata(&m, uid, size),
            text: m.body_text(0).unwrap_or_default().into_owned(),
        })
    }
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
