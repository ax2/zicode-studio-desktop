//! Internal ordered byte input for the file digest Worker. No paths cross this boundary.
use super::{resource_input::Descriptor, WorkerRequest};
use sha2::{Digest, Sha256};
use std::io::Read;

pub(super) const MAGIC: &[u8; 8] = b"ZIDF\0\0\0\x01";
pub(super) const EXECUTION_PROFILE: &str = "resource.wasi.file-digest-stream.v1";
pub(super) const INPUT_PROFILE: &str = "resource.wasi.input.stream.draft1";
const MAX_FILES: usize = 64;
const CHUNK_BYTES: usize = 64 * 1024;
const MAX_HEADER: usize = 256 * 1024;
const MAX_MODULE: usize = 2 * 1024 * 1024;
const BASE_FUEL: u64 = 10_000_000;
const FUEL_PER_BYTE: u64 = 768;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    request: WorkerRequest,
    resources: Vec<Descriptor>,
    module_bytes: usize,
    module_sha256: String,
}

pub(super) struct Stream {
    descriptors: Vec<Descriptor>,
    input: Box<dyn Read + Send>,
    index: usize,
    offset: usize,
    fuel: u64,
}

fn invalid() -> String {
    "Invalid file digest stream".into()
}

pub(super) fn read(
    mut input: impl Read + Send + 'static,
) -> Result<(WorkerRequest, Vec<u8>, Stream), String> {
    let mut length = [0; 4];
    input.read_exact(&mut length).map_err(|_| invalid())?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_HEADER {
        return Err(invalid());
    }
    let mut encoded = vec![0; length];
    input.read_exact(&mut encoded).map_err(|_| invalid())?;
    let header: Header = serde_json::from_slice(&encoded).map_err(|_| invalid())?;
    let request = header.request;
    let descriptors = header.resources;
    if request.worker_kind != "wasi"
        || !request.worker_path.is_empty()
        || request.execution_profile.as_deref() != Some(EXECUTION_PROFILE)
        || request.plugin_id != crate::plugin_resource_execution::file_digest::PLUGIN
        || request.capability_id.as_deref()
            != Some(crate::plugin_resource_execution::file_digest::CAPABILITY)
        || request.command_id.is_some()
        || request.scene_id.is_empty()
        || descriptors.is_empty()
        || descriptors.len() > MAX_FILES
        || header.module_bytes == 0
        || header.module_bytes > MAX_MODULE
    {
        return Err(invalid());
    }
    let mut ids = std::collections::HashSet::with_capacity(descriptors.len());
    let mut fuel = BASE_FUEL;
    for descriptor in &descriptors {
        if uuid::Uuid::parse_str(&descriptor.resource_id).is_err()
            || !ids.insert(&descriptor.resource_id)
            || descriptor.mime_type != "application/octet-stream"
            || descriptor.content_version.len() != 64
            || !descriptor
                .content_version
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid());
        }
        let row_fuel = u64::try_from(descriptor.byte_length)
            .map_err(|_| invalid())?
            .checked_mul(FUEL_PER_BYTE)
            .ok_or_else(invalid)?;
        fuel = fuel.checked_add(row_fuel).ok_or_else(invalid)?;
    }
    let mut module = vec![0; header.module_bytes];
    input.read_exact(&mut module).map_err(|_| invalid())?;
    if format!("{:x}", Sha256::digest(&module)) != header.module_sha256 {
        return Err(invalid());
    }
    let mut stream = Stream {
        descriptors,
        input: Box::new(input),
        index: 0,
        offset: 0,
        fuel,
    };
    stream.advance();
    Ok((request, module, stream))
}

impl Stream {
    pub(super) fn descriptors(&self) -> &[Descriptor] {
        &self.descriptors
    }

    pub(super) fn fuel(&self) -> u64 {
        self.fuel
    }

    fn advance(&mut self) {
        while self
            .descriptors
            .get(self.index)
            .is_some_and(|item| self.offset == item.byte_length)
        {
            self.index += 1;
            self.offset = 0;
        }
    }

    pub(super) fn chunk(
        &mut self,
        index: usize,
        offset: usize,
        length: usize,
    ) -> Result<Vec<u8>, i32> {
        let item = self.descriptors.get(self.index).ok_or(-1)?;
        let expected = (item.byte_length - self.offset).min(CHUNK_BYTES);
        if index != self.index || offset != self.offset || length != expected {
            return Err(-1);
        }
        let mut bytes = vec![0; length];
        self.input.read_exact(&mut bytes).map_err(|_| -3)?;
        self.offset += length;
        self.advance();
        Ok(bytes)
    }

    pub(super) fn finish(&mut self) -> Result<(), String> {
        if self.index != self.descriptors.len() {
            return Err(invalid());
        }
        let mut extra = [0];
        match self.input.read(&mut extra) {
            Ok(0) => Ok(()),
            _ => Err(invalid()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn stream(lengths: &[usize], input: Vec<u8>) -> Stream {
        let descriptors = lengths
            .iter()
            .map(|&byte_length| Descriptor {
                resource_id: String::new(),
                content_version: String::new(),
                mime_type: "application/octet-stream".into(),
                byte_length,
            })
            .collect();
        let mut stream = Stream {
            descriptors,
            input: Box::new(Cursor::new(input)),
            index: 0,
            offset: 0,
            fuel: BASE_FUEL,
        };
        stream.advance();
        stream
    }

    #[test]
    fn file_digest_stream_keeps_file_and_chunk_order() {
        let mut input = vec![0x7a; CHUNK_BYTES];
        input.extend_from_slice(b"ABC");
        let mut stream = stream(&[0, CHUNK_BYTES + 1, 0, 2], input);
        assert_eq!(stream.chunk(0, 0, 0), Err(-1));
        assert_eq!(stream.chunk(1, 0, 8), Err(-1));
        assert_eq!(stream.chunk(3, 0, 2), Err(-1));
        assert_eq!(stream.chunk(1, 1, CHUNK_BYTES), Err(-1));
        assert_eq!(
            stream.chunk(1, 0, CHUNK_BYTES).unwrap(),
            vec![0x7a; CHUNK_BYTES]
        );
        assert_eq!(stream.chunk(1, 0, CHUNK_BYTES), Err(-1));
        assert_eq!(stream.chunk(1, CHUNK_BYTES, 1).unwrap(), b"A");
        assert_eq!(stream.chunk(3, 0, 2).unwrap(), b"BC");
        assert!(stream.finish().is_ok());
    }

    #[test]
    fn file_digest_stream_rejects_missing_and_excess_bytes() {
        let mut missing = stream(&[2], b"a".to_vec());
        assert_eq!(missing.chunk(0, 0, 2), Err(-3));
        assert!(missing.finish().is_err());
        let mut trailing = stream(&[1], b"ab".to_vec());
        assert_eq!(trailing.chunk(0, 0, 1).unwrap(), b"a");
        assert!(trailing.finish().is_err());
    }
}
