//! Bounded serialization: reject before retaining bytes beyond the header limit.
use std::io::{self, Write};

struct HeaderWriter {
    bytes: Vec<u8>,
    limit: usize,
}

impl Write for HeaderWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("Resource header budget exceeded"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn encode(value: &impl serde::Serialize, limit: usize) -> Result<Vec<u8>, String> {
    let mut writer = HeaderWriter {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| "Invalid resource Worker frame".to_string())?;
    Ok(writer.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaping_and_failed_writes_cannot_exceed_retained_budget() {
        assert_eq!(encode(&"abc", 5).unwrap(), br#""abc""#);
        assert!(encode(&"abc", 4).is_err());
        assert!(encode(&"\0".repeat(30000), 256 * 1024).is_ok());
        assert!(encode(&"\0".repeat(50000), 256 * 1024).is_err());
        let mut writer = HeaderWriter {
            bytes: Vec::new(),
            limit: 4,
        };
        writer.write_all(b"123").unwrap();
        assert!(writer.write_all(b"45").is_err());
        assert_eq!(writer.bytes, b"123");
    }
}
