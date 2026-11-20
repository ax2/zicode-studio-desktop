//! Bounded cache for derived reference thumbnails. The caller verifies the source first.
use std::collections::VecDeque;

const MAX_ENTRIES: usize = 128;
const MAX_ENCODED_BYTES: usize = 8 * 1024 * 1024;

struct Entry {
    library: String,
    digest: String,
    encoded: String,
}

#[derive(Default)]
pub(super) struct Thumbnails {
    entries: VecDeque<Entry>,
    bytes: usize,
}

impl Thumbnails {
    pub(super) fn get_or_generate(
        &mut self,
        library: &str,
        digest: &str,
        generate: impl FnOnce() -> Result<String, String>,
    ) -> Result<String, String> {
        if let Some(entry) = self
            .entries
            .iter()
            .position(|entry| entry.library == library && entry.digest == digest)
            .and_then(|position| self.entries.remove(position))
        {
            let encoded = entry.encoded.clone();
            self.entries.push_back(entry);
            return Ok(encoded);
        }
        let encoded = generate()?;
        if encoded.len() > MAX_ENCODED_BYTES {
            return Ok(encoded);
        }
        while self.entries.len() >= MAX_ENTRIES || self.bytes + encoded.len() > MAX_ENCODED_BYTES {
            let Some(oldest) = self.entries.pop_front() else {
                break;
            };
            self.bytes -= oldest.encoded.len();
        }
        self.bytes += encoded.len();
        self.entries.push_back(Entry {
            library: library.to_owned(),
            digest: digest.to_owned(),
            encoded: encoded.clone(),
        });
        Ok(encoded)
    }
}

#[cfg(test)]
#[path = "preview_cache_tests.rs"]
mod tests;
