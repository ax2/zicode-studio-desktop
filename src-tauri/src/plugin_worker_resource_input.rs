//! Internal resource-input candidate. Host authorization must happen before framing.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;
#[path = "plugin_worker_resource_header.rs"]
mod resource_header;

pub(super) fn encode_header(value: &impl Serialize, limit: usize) -> Result<Vec<u8>, String> {
    resource_header::encode(value, limit)
}

pub(super) const MAGIC: &[u8; 8] = b"ZIRW\0\0\0\x01";
const MAX_JSON: usize = 256 * 1024;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_RESOURCES: usize = 4;
const PROFILE: &str = "resource.wasi.input.draft1";
const SNAPSHOT_MAGIC: &[u8; 8] = b"ZIRW\0\0\0\x02";
const SNAPSHOT_PROFILE: &str = "resource.wasi.input.draft2";
const MAX_MODULE: usize = 2 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ModuleDescriptor {
    byte_length: usize,
    sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Descriptor {
    pub resource_id: String,
    pub content_version: String,
    pub mime_type: String,
    pub byte_length: usize,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    profile: String,
    request: Value,
    resources: Vec<Descriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    module: Option<ModuleDescriptor>,
}

pub(crate) struct Resource {
    pub descriptor: Descriptor,
    pub bytes: Vec<u8>,
}

pub(super) struct Input {
    pub request: Value,
    pub resources: Vec<Resource>,
    pub module: Option<Vec<u8>>,
}

fn invalid() -> String {
    "Invalid resource Worker frame".into()
}

// Reserved for the forthcoming trusted Host snapshot path; not a plugin-facing API.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn encode(request: Value, resources: &[Resource]) -> Result<Vec<u8>, String> {
    encode_frame(request, resources, None)
}

pub(crate) fn encode_module_snapshot(
    request: Value,
    resources: &[Resource],
    module: &[u8],
) -> Result<Vec<u8>, String> {
    encode_frame(request, resources, Some(module))
}

fn encode_frame(
    request: Value,
    resources: &[Resource],
    module: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let header = Header {
        profile: if module.is_some() {
            SNAPSHOT_PROFILE
        } else {
            PROFILE
        }
        .into(),
        request,
        resources: resources.iter().map(|r| r.descriptor.clone()).collect(),
        module: module.map(|bytes| ModuleDescriptor {
            byte_length: bytes.len(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
        }),
    };
    let total = validate_header(&header)?;
    for resource in resources {
        if resource.bytes.len() != resource.descriptor.byte_length
            || format!("{:x}", Sha256::digest(&resource.bytes))
                != resource.descriptor.content_version
        {
            return Err("Resource Worker content mismatch".into());
        }
    }
    let json = resource_header::encode(&header, MAX_JSON)?;
    let mut frame =
        Vec::with_capacity(MAGIC.len() + 4 + json.len() + total + module.map_or(0, |m| m.len()));
    frame.extend_from_slice(if module.is_some() {
        SNAPSHOT_MAGIC
    } else {
        MAGIC
    });
    frame.extend_from_slice(&(json.len() as u32).to_le_bytes());
    frame.extend_from_slice(&json);
    if let Some(module) = module {
        frame.extend_from_slice(module);
    }
    for resource in resources {
        frame.extend_from_slice(&resource.bytes);
    }
    Ok(frame)
}

pub(super) fn read(mut reader: impl Read) -> Result<Input, String> {
    let mut prefix = Vec::new();
    reader
        .by_ref()
        .take(MAGIC.len() as u64)
        .read_to_end(&mut prefix)
        .map_err(|_| invalid())?;
    let snapshot = prefix == SNAPSHOT_MAGIC;
    if prefix != MAGIC && !snapshot {
        // Keep legacy JSON bounded, including the prefix already consumed.
        let mut bytes = prefix;
        reader
            .take((MAX_JSON + 1 - bytes.len()) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid())?;
        if bytes.len() > MAX_JSON {
            return Err("Worker request exceeds 256 KiB".into());
        }
        return Ok(Input {
            request: serde_json::from_slice(&bytes)
                .map_err(|_| "Invalid Worker JSON request".to_string())?,
            resources: Vec::new(),
            module: None,
        });
    }
    let mut length = [0; 4];
    reader.read_exact(&mut length).map_err(|_| invalid())?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_JSON {
        return Err(invalid());
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(|_| invalid())?;
    let header: Header = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    validate_header(&header)?;
    if snapshot != header.module.is_some() {
        return Err(invalid());
    }
    let module = if let Some(descriptor) = &header.module {
        let mut bytes = vec![0; descriptor.byte_length];
        reader.read_exact(&mut bytes).map_err(|_| invalid())?;
        if format!("{:x}", Sha256::digest(&bytes)) != descriptor.sha256 {
            return Err("Resource Worker module mismatch".into());
        }
        Some(bytes)
    } else {
        None
    };
    let mut resources = Vec::with_capacity(header.resources.len());
    for descriptor in header.resources {
        let mut bytes = vec![0; descriptor.byte_length];
        reader.read_exact(&mut bytes).map_err(|_| invalid())?;
        if format!("{:x}", Sha256::digest(&bytes)) != descriptor.content_version {
            return Err("Resource Worker content mismatch".into());
        }
        resources.push(Resource { descriptor, bytes });
    }
    let mut trailing = [0];
    if reader.read(&mut trailing).map_err(|_| invalid())? != 0 {
        return Err(invalid());
    }
    Ok(Input {
        request: header.request,
        resources,
        module,
    })
}

fn validate_header(header: &Header) -> Result<usize, String> {
    if header.profile
        != if header.module.is_some() {
            SNAPSHOT_PROFILE
        } else {
            PROFILE
        }
        || header.request["workerKind"] != "wasi"
        || header.resources.is_empty()
        || header.resources.len() > MAX_RESOURCES
    {
        return Err(invalid());
    }
    if header.module.as_ref().is_some_and(|m| {
        m.byte_length == 0
            || m.byte_length > MAX_MODULE
            || m.sha256.len() != 64
            || !m
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }) {
        return Err(invalid());
    }
    // Validate every descriptor before allocating any resource payload.
    let mut total = 0usize;
    let mut ids = std::collections::HashSet::new();
    for descriptor in &header.resources {
        total = total
            .checked_add(descriptor.byte_length)
            .ok_or_else(invalid)?;
        if total > MAX_BYTES
            || uuid::Uuid::parse_str(&descriptor.resource_id).is_err()
            || !ids.insert(&descriptor.resource_id)
            || descriptor.content_version.len() != 64
            || !descriptor
                .content_version
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || crate::plugin_output_types::extension(&descriptor.mime_type).is_none()
        {
            return Err(invalid());
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(header: Value, bytes: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(&header).unwrap();
        [
            MAGIC.as_slice(),
            &(json.len() as u32).to_le_bytes(),
            &json,
            bytes,
        ]
        .concat()
    }

    fn header(bytes: &[u8]) -> Value {
        json!({"profile":PROFILE,"request":{"workerKind":"wasi"},"resources":[{
            "resourceId":"a34cce57-e87d-45b3-b2d1-8f456a9e1aa8",
            "contentVersion":format!("{:x}", Sha256::digest(bytes)),
            "mimeType":"application/octet-stream","byteLength":bytes.len()
        }]})
    }

    #[test]
    fn binary_above_json_limit_and_legacy_json_are_distinct() {
        let bytes = vec![173; MAX_JSON + 17];
        let result = read(frame(header(&bytes), &bytes).as_slice()).unwrap();
        assert_eq!(result.resources[0].bytes, bytes);
        assert!(read(br#"{"workerKind":"wasi"}"#.as_slice())
            .unwrap()
            .resources
            .is_empty());
        assert!(read(vec![b' '; MAX_JSON + 1].as_slice()).is_err());
    }

    #[test]
    fn archive_output_can_become_a_bounded_input_without_a_path() {
        let bytes = b"archive";
        let mut h = header(bytes);
        h["resources"][0]["mimeType"] = json!("application/x-zicode-archive-targzip");
        let parsed = read(frame(h.clone(), bytes).as_slice()).unwrap();
        assert_eq!(parsed.resources[0].descriptor.mime_type, "application/x-zicode-archive-targzip");
        assert_eq!(parsed.resources[0].bytes, bytes);
        h["resources"][0]["mimeType"] = json!("text/html");
        assert!(read(frame(h.clone(), bytes).as_slice()).is_ok());
        h["resources"][0]["mimeType"] = json!("application/x-unsupported-output");
        assert!(read(frame(h, bytes).as_slice()).is_err());
    }

    #[test]
    fn trusted_encoder_validates_metadata_actual_content_and_header_budget() {
        let bytes = b"resource";
        let descriptor = serde_json::from_value(header(bytes)["resources"][0].clone()).unwrap();
        let mut resources = vec![Resource {
            descriptor,
            bytes: bytes.to_vec(),
        }];
        let frame = encode(json!({"workerKind":"wasi"}), &resources).unwrap();
        assert_eq!(read(frame.as_slice()).unwrap().resources[0].bytes, bytes);
        resources[0].bytes.push(0);
        assert!(encode(json!({"workerKind":"wasi"}), &resources).is_err());
        resources[0].bytes = bytes.to_vec();
        assert!(encode(json!({"workerKind":"javascript"}), &resources).is_err());
        assert!(encode(
            json!({"workerKind":"wasi","input":"x".repeat(MAX_JSON)}),
            &resources
        )
        .is_err());
    }

    #[test]
    fn module_snapshot_has_separate_budget_hash_and_version() {
        let bytes = b"resource";
        let descriptor = serde_json::from_value(header(bytes)["resources"][0].clone()).unwrap();
        let resources = vec![Resource {
            descriptor,
            bytes: bytes.to_vec(),
        }];
        let mut frame =
            encode_module_snapshot(json!({"workerKind":"wasi"}), &resources, b"module").unwrap();
        let parsed = read(frame.as_slice()).unwrap();
        assert_eq!(parsed.module.unwrap(), b"module");
        assert_eq!(parsed.resources[0].bytes, bytes);
        frame[7] = 1;
        assert!(read(frame.as_slice()).is_err());
        assert!(encode_module_snapshot(
            json!({"workerKind":"wasi"}),
            &resources,
            &vec![0; MAX_MODULE + 1]
        )
        .is_err());
        let mut frame =
            encode_module_snapshot(json!({"workerKind":"wasi"}), &resources, b"module").unwrap();
        let length = u32::from_le_bytes(frame[8..12].try_into().unwrap()) as usize;
        frame[12 + length] ^= 1;
        assert!(read(frame.as_slice()).is_err());
    }

    #[test]
    fn malformed_truncated_excessive_and_changed_inputs_are_rejected() {
        let bytes = b"resource";
        let valid = frame(header(bytes), bytes);
        assert!(read(&valid[..valid.len() - 1]).is_err());
        let mut trailing = valid.clone();
        trailing.push(0);
        assert!(read(trailing.as_slice()).is_err());
        assert!(read(frame(header(bytes), b"RESOURCE").as_slice()).is_err());
        for (field, value) in [
            ("profile", json!("resource.v1")),
            ("token", json!("must-not-enter-frame")),
        ] {
            let mut h = header(bytes);
            h[field] = value;
            assert!(read(frame(h, bytes).as_slice()).is_err());
        }
        let mut h = header(bytes);
        h["resources"][0]["byteLength"] = json!(usize::MAX);
        assert!(read(frame(h, &[]).as_slice()).is_err());
        let mut h = header(bytes);
        h["resources"][0]["path"] = json!("local-path");
        assert!(read(frame(h, bytes).as_slice()).is_err());
        let mut h = header(bytes);
        let duplicate = h["resources"][0].clone();
        h["resources"].as_array_mut().unwrap().push(duplicate);
        assert!(read(frame(h, bytes).as_slice()).is_err());
    }

    #[test]
    fn framed_resource_is_read_by_actual_preview1_worker_without_directories() {
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("resource-worker-frame-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("owner.json"),
            br#"{"purpose":"resource input WASI fixture; keep failure evidence"}"#,
        )
        .unwrap();
        let module = root.join("reader.wasm");
        let mut bytes = vec![173; 300000];
        let offset = bytes.len() - 8;
        bytes[offset..].copy_from_slice(b"resource");
        let wat = r#"(module
            (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
            (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
            (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
            (memory (export "memory") 1)
            (data (i32.const 64) "{\22text\22:\22XXXXXXXX\22}")
            (func (export "_start")
                i32.const 0 call $size i64.const RESOURCE_SIZE i64.ne if unreachable end
                i32.const 0 i64.const RESOURCE_OFFSET i32.const 73 i32.const 8 call $read
                i32.const 8 i32.ne if unreachable end
                i32.const 0 i32.const 64 i32.store
                i32.const 4 i32.const 19 i32.store
                i32.const 1 i32.const 0 i32.const 1 i32.const 24 call $write drop))"#
            .replace("RESOURCE_SIZE", &bytes.len().to_string()).replace("RESOURCE_OFFSET", &offset.to_string());
        std::fs::write(&module, wat).unwrap();
        let mut h = header(&bytes);
        h["request"] = json!({"workerKind":"wasi","workerPath":module.to_string_lossy(),
            "pluginId":"com.zicode.studio.resource-reader","capabilityId":"resource.read",
            "sceneId":"programming","input":{}});
        let parsed = read(frame(h, &bytes).as_slice()).unwrap();
        let request = serde_json::from_value(parsed.request).unwrap();
        let result = super::super::execute_wasi_resource(
            &request,
            wasmtime::OptLevel::None,
            parsed.resources,
        )
        .unwrap();
        assert_eq!(result, json!({"text":"resource"}));
        // The same module cannot obtain these imports through the legacy compute path.
        assert!(
            super::super::execute_wasi_with_optimization(&request, wasmtime::OptLevel::None)
                .is_err()
        );
        let snapshot = std::fs::read(&module).unwrap();
        std::fs::remove_file(&module).unwrap();
        let mut h = header(&bytes);
        h["request"] = json!({"workerKind":"wasi","workerPath":module.to_string_lossy(),"pluginId":"com.zicode.studio.resource-reader","capabilityId":"resource.read","sceneId":"programming","input":{}});
        let descriptor = serde_json::from_value(h["resources"][0].clone()).unwrap();
        let frame = encode_module_snapshot(
            h["request"].clone(),
            &[Resource { descriptor, bytes }],
            &snapshot,
        )
        .unwrap();
        let parsed = read(frame.as_slice()).unwrap();
        let request = serde_json::from_value(parsed.request).unwrap();
        assert_eq!(
            super::super::execute_wasi_snapshot(
                &request,
                wasmtime::OptLevel::None,
                parsed.resources,
                parsed.module
            )
            .unwrap(),
            json!({"text":"resource"})
        );
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
