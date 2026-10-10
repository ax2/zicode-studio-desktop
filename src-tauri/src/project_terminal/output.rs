use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::collections::VecDeque;

const LIMIT: usize = 256 * 1024;
const FRAME_LIMIT: usize = 32 * 1024;

#[derive(Default)]
pub(super) struct Output {
    bytes: VecDeque<u8>,
    end: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub data: String,
    pub next_offset: u64,
    pub truncated: bool,
}

impl Output {
    pub fn push(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        self.bytes.extend(bytes);
        if self.bytes.len() > LIMIT {
            self.bytes.drain(..self.bytes.len() - LIMIT);
        }
    }
    pub fn read(&self, offset: u64) -> Result<Chunk, String> {
        if offset > self.end {
            return Err("terminal_cursor_invalid".into());
        }
        let base = self.end - self.bytes.len() as u64;
        let start = offset.max(base);
        let bytes: Vec<_> = self
            .bytes
            .iter()
            .skip((start - base) as usize)
            .take(FRAME_LIMIT)
            .copied()
            .collect();
        Ok(Chunk {
            data: STANDARD.encode(&bytes),
            next_offset: start + bytes.len() as u64,
            truncated: offset < base,
        })
    }
    pub fn end(&self) -> u64 {
        self.end
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_chunks_preserve_raw_bytes_and_offsets() {
        let mut output = Output::default();
        output.push(&[0x1b, b'[', 0xff, 0]);
        let chunk = output.read(0).unwrap();
        assert_eq!(STANDARD.decode(chunk.data).unwrap(), [0x1b, b'[', 0xff, 0]);
        assert_eq!(chunk.next_offset, 4);
        assert!(output.read(5).is_err());
        output.push(&vec![b'x'; LIMIT + 10]);
        let chunk = output.read(0).unwrap();
        assert!(chunk.truncated);
        assert_eq!(STANDARD.decode(chunk.data).unwrap().len(), FRAME_LIMIT);
        assert_eq!(chunk.next_offset, 14 + FRAME_LIMIT as u64);
        assert!(output.read(output.end()).unwrap().data.is_empty());
    }
}
