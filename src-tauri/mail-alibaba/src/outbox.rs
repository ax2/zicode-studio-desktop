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
impl Alibaba {
    pub(crate) fn compose(
        &self,
        address: &str,
        d: &StoredDraft,
        parent: Option<&str>,
    ) -> Result<Message> {
        if d.subject.len() > 998
            || d.subject.contains(['\r', '\n', '\0'])
            || d.body.len() > MAX_MESSAGE
            || d.recipient.contains(['\r', '\n', '\0'])
        {
            return Err("mail_invalid_draft");
        }
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
