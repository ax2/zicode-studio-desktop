use super::*;
use lettre::{
    message::Mailbox as Address,
    transport::smtp::{
        authentication::Credentials,
        client::{Certificate, Tls, TlsParameters},
    },
    Message, SmtpTransport, Transport,
};

/// Before this call the service has durably claimed the exact saved draft revision.
/// No retry, pooling or reconnection after DATA.
pub fn draft_attachments(db: &rusqlite::Connection, scope: &str, account: &str, draft: &str) -> Result<Vec<(String, Vec<u8>)>> {
    db.execute_batch(DRAFT_ATTACHMENT_SCHEMA).map_err(|_| "mail_storage")?;
    let mut q = db.prepare("SELECT name,content FROM draft_attachments WHERE scope=? AND account=? AND draft=? ORDER BY rowid").map_err(|_| "mail_storage")?;
    let rows = q.query_map([scope,account,draft], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|_| "mail_storage")?;
    rows.collect::<rusqlite::Result<_>>().map_err(|_| "mail_storage")
}

pub fn compose_attached(sender: &str, draft: &StoredDraft, parent: Option<&str>, files: Vec<(String, Vec<u8>)>) -> Result<Message> {
    use lettre::message::{Attachment, MultiPart, SinglePart, header::ContentType};
    let mut builder = Message::builder()
        .from(sender.parse().map_err(|_| "mail_invalid_address")?)
        .to(draft.recipient.parse().map_err(|_| "mail_invalid_recipient")?)
        .subject(&draft.subject);
    if let Some(id) = parent {
        if !inbox::valid_id(id) { return Err("mail_invalid_reply"); }
        builder = builder.in_reply_to(format!("<{id}>")).references(format!("<{id}>"));
    }
    let mut mixed = MultiPart::mixed().singlepart(SinglePart::plain(draft.body.clone()));
    for (name, bytes) in files {
        if name.is_empty() || name.chars().any(char::is_control) { return Err("mail_invalid_draft"); }
        mixed = mixed.singlepart(Attachment::new(name).body(bytes, ContentType::parse("application/octet-stream").map_err(|_| "mail_invalid_draft")?));
    }
    builder.multipart(mixed).map_err(|_| "mail_invalid_draft")
}

impl Alibaba {
    pub(crate) fn compose(
        &self,
        address: &str,
        d: &StoredDraft,
        parent: Option<&str>,
        files: Vec<(String, Vec<u8>)>,
    ) -> Result<Message> {
        if d.subject.len() > 998
            || d.subject.contains(['\r', '\n', '\0'])
            || d.body.len() > MAX_MESSAGE
            || d.recipient.contains(['\r', '\n', '\0'])
        {
            return Err("mail_invalid_draft");
        }
        if !files.is_empty() { return compose_attached(address, d, parent, files); }
        let sender: Address = address.parse().map_err(|_| "mail_invalid_address")?;
        let recipient: Address = d.recipient.parse().map_err(|_| "mail_invalid_recipient")?;
        let mut m = Message::builder()
            .from(sender)
            .to(recipient)
            .subject(&d.subject)
            .header(lettre::message::header::ContentType::TEXT_PLAIN);
        if let Some(id) = parent {
            if !inbox::valid_id(id) {
                return Err("mail_invalid_reply");
            }
            m = m
                .in_reply_to(format!("<{id}>"))
                .references(format!("<{id}>"));
        }
        m.body(d.body.clone()).map_err(|_| "mail_invalid_draft")
    }
    pub(crate) fn transmit(
        &self,
        address: &str,
        password: &str,
        msg: Message,
    ) -> Result<&'static str> {
        let mut builder = TlsParameters::builder(self.smtp_host.clone());
        if let Some(root) = &self.extra_root {
            builder = builder
                .add_root_certificate(Certificate::from_der(root.clone()).map_err(|_| "mail_tls")?);
        }
        let tls = builder.build().map_err(|_| "mail_tls")?;
        let client = SmtpTransport::builder_dangerous(&self.smtp_host)
            .port(self.smtp_port)
            .tls(Tls::Wrapper(tls))
            .credentials(Credentials::new(address.to_string(), password.to_string()))
            .timeout(Some(TIMEOUT))
            .build();
        Ok(match client.send(&msg) {
            Ok(_) => "accepted",
            Err(error) if error.is_permanent() || error.is_transient() => "rejected",
            Err(_) => "unknown",
        })
    }
}
