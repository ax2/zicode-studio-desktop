//! Internal binary output candidate. Bytes are not Host grants or saved files.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Write;

pub(crate) const PROFILE: &str = "resource.wasi.output.draft1";
pub(crate) const MAX_BYTES: usize = 32 * 1024 * 1024;
pub(crate) const MAX_HEADER: usize = 1024 * 1024 + 4096;
pub(crate) const MAX_FRAME: usize = 12 + MAX_HEADER + MAX_BYTES;
const MAGIC: &[u8; 8] = b"ZIWO\0\0\0\x01";
pub(super) const MIMES: &[&str] = &[
    "application/octet-stream",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
];

pub(crate) struct Blob {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

pub(crate) struct Bundle {
    pub binary: bool,
    pub result: Value,
    pub resources: Vec<Blob>,
}

impl Bundle {
    pub(super) fn json(result: Value) -> Self {
        Self {
            binary: false,
            result,
            resources: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    index: usize,
    mime_type: String,
    byte_length: usize,
    content_version: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    schema_version: u32,
    profile: String,
    result: Value,
    resources: Vec<Descriptor>,
}

fn invalid() -> String {
    "Invalid resource Worker output frame".into()
}

pub(super) fn write(mut writer: impl Write, bundle: &Bundle) -> Result<(), String> {
    let header = Header {
        schema_version: 1,
        profile: PROFILE.into(),
        result: bundle.result.clone(),
        resources: bundle
            .resources
            .iter()
            .enumerate()
            .map(|(index, blob)| Descriptor {
                index,
                mime_type: blob.mime_type.clone(),
                byte_length: blob.bytes.len(),
                content_version: format!("{:x}", Sha256::digest(&blob.bytes)),
            })
            .collect(),
    };
    validate(&header)?;
    // Bounded serialization also covers escaping and a caller-supplied result value.
    let bytes = super::resource_input::encode_header(&header, MAX_HEADER).map_err(|_| invalid())?;
    writer
        .write_all(MAGIC)
        .and_then(|()| writer.write_all(&(bytes.len() as u32).to_le_bytes()))
        .and_then(|()| writer.write_all(&bytes))
        .map_err(|_| invalid())?;
    for blob in &bundle.resources {
        writer.write_all(&blob.bytes).map_err(|_| invalid())?;
    }
    Ok(())
}

fn validate(header: &Header) -> Result<(), String> {
    if header.schema_version != 1 || header.profile != PROFILE || header.resources.len() > 4 {
        return Err(invalid());
    }
    let mut total = 0usize;
    for (index, descriptor) in header.resources.iter().enumerate() {
        if descriptor.index != index
            || !MIMES.contains(&descriptor.mime_type.as_str())
            || descriptor.content_version.len() != 64
            || !descriptor
                .content_version
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid());
        }
        total = total
            .checked_add(descriptor.byte_length)
            .filter(|n| *n <= MAX_BYTES)
            .ok_or_else(invalid)?;
    }
    Ok(())
}

// Reserved for the future trusted Host output-registration path, not plugin-facing.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn decode(frame: &[u8]) -> Result<Bundle, String> {
    if frame.len() < 12 || frame.len() > MAX_FRAME || &frame[..8] != MAGIC {
        return Err(invalid());
    }
    let length = u32::from_le_bytes(frame[8..12].try_into().map_err(|_| invalid())?) as usize;
    if length == 0 || length > MAX_HEADER {
        return Err(invalid());
    }
    let end = 12usize
        .checked_add(length)
        .filter(|n| *n <= frame.len())
        .ok_or_else(invalid)?;
    let header: Header = serde_json::from_slice(&frame[12..end]).map_err(|_| invalid())?;
    validate(&header)?;
    let expected = header
        .resources
        .iter()
        .try_fold(end, |n, d| n.checked_add(d.byte_length))
        .ok_or_else(invalid)?;
    if expected != frame.len() {
        return Err(invalid());
    }
    let mut cursor = end;
    let mut resources = Vec::with_capacity(header.resources.len());
    for descriptor in header.resources {
        let bytes = &frame[cursor..cursor + descriptor.byte_length];
        if format!("{:x}", Sha256::digest(bytes)) != descriptor.content_version {
            return Err(invalid());
        }
        resources.push(Blob {
            mime_type: descriptor.mime_type,
            bytes: bytes.to_vec(),
        });
        cursor += descriptor.byte_length;
    }
    Ok(Bundle {
        binary: true,
        result: header.result,
        resources,
    })
}

#[cfg(test)]
#[path = "plugin_worker_resource_output_tests.rs"]
mod tests;
