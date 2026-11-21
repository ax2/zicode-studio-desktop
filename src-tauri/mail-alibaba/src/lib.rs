//! Alibaba enterprise mail: TLS-only transport and account-scoped local state.
mod inbox;
mod journal;
mod outbox;

pub use inbox::{Attachment, Cursor, Folder, Letter, Page, Summary};
pub use journal::{initialize_cache, Account, Mailbox, StoredDraft};
use std::time::Duration;

pub type Result<T> = std::result::Result<T, &'static str>;
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_MESSAGE: usize = 4 * 1024 * 1024;
const MAX_HEADER: usize = 65536;
pub const IMAP_HOST: &str = "imap.qiye.aliyun.com";
pub const SMTP_HOST: &str = "smtp.qiye.aliyun.com";

/// Production endpoints are fixed. Only private loopback fixtures can override them.
pub struct Alibaba {
    imap_host: String,
    imap_port: u16,
    smtp_host: String,
    smtp_port: u16,
    extra_root: Option<Vec<u8>>,
}
impl Default for Alibaba {
    fn default() -> Self {
        Self {
            imap_host: IMAP_HOST.into(),
            imap_port: 993,
            smtp_host: SMTP_HOST.into(),
            smtp_port: 465,
            extra_root: None,
        }
    }
}
#[cfg(test)]
mod tests;
