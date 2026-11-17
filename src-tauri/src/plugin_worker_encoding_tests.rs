use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::process::Stdio;
use std::time::Duration;

#[test]
#[ignore = "requires the frozen 8 MiB encoding candidate and its independent native test adapter"]
fn encoding_8_mib_worker_checks_full_input_and_matches_native() {
    use crate::plugin_resource_execution::encoding as policy;
    let package =
        std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_ENCODING_PACKAGE").unwrap());
    let native =
        std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_ENCODING_FIXTURE").unwrap());
    let module = std::fs::read(package.join("runtime/tools.wasm")).unwrap();
    let manifest: crate::plugin_registry::PluginManifest =
        serde_json::from_slice(&std::fs::read(package.join("plugin.json")).unwrap()).unwrap();
    policy::validate_manifest(&manifest).unwrap();
    let mut unrelated = manifest.clone();
    unrelated.id = "com.zicode.other".into();
    assert!(policy::validate_manifest(&unrelated).is_err());
    unrelated.id.clone_from(&manifest.id);
    unrelated
        .required_profiles
        .as_object_mut()
        .unwrap()
        .remove(policy::PROFILE);
    assert!(policy::validate_manifest(&unrelated).is_err());
    let request: WorkerRequest = serde_json::from_value(json!({"workerKind":"wasi","workerPath":"","sceneId":"programming",
        "pluginId":policy::PLUGIN,"capabilityId":policy::CAPABILITY,"executionProfile":policy::PROFILE,"input":{}})).unwrap();
    let make_input = |bytes: Vec<u8>| resource_input::Resource {
        descriptor: resource_input::Descriptor {
            resource_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            content_version: format!("{:x}", Sha256::digest(&bytes)),
            mime_type: "application/octet-stream".into(),
            byte_length: bytes.len(),
        },
        bytes,
    };
    let mut standard = request.clone();
    standard.execution_profile = None;
    let ascii = vec![b'a'; policy::MAX_BYTES];
    let legacy = execute_wasi_bundle(
        &standard,
        wasmtime::OptLevel::None,
        vec![make_input(ascii.clone())],
        Some(module.clone()),
        true,
    );
    assert!(
        legacy.is_err(),
        "an undeclared capability must not get the new budget"
    );
    let mut utf16 = [0x2d, 0x4e].repeat(policy::MAX_BYTES / 2);
    utf16[..2].copy_from_slice(&[0xff, 0xfe]);
    let mut malformed_tail = ascii.clone();
    malformed_tail[..3].copy_from_slice(&[0xef, 0xbb, 0xbf]);
    *malformed_tail.last_mut().unwrap() = 0xff;
    let mut cjk = [0xb2, 0xe2, 0xca, 0xd4].repeat(policy::MAX_BYTES / 4);
    cjk[0] = b'Z';
    for (case, bytes) in [
        ("ascii", ascii),
        ("utf16le", utf16),
        ("legacy-cjk", cjk),
        (
            "big5",
            [0xa4, 0xa4, 0xa4, 0xe5].repeat(policy::MAX_BYTES / 4),
        ),
        (
            "shift-jis",
            [0x93, 0xfa, 0x96, 0x7b].repeat(policy::MAX_BYTES / 4),
        ),
        ("windows1252", vec![0xe9; policy::MAX_BYTES]),
        ("malformed-utf8-tail", malformed_tail),
    ] {
        eprintln!("encoding inspection case={case}");
        let expected = native_report(&native, &bytes);
        let actual = execute_wasi_bundle(
            &request,
            wasmtime::OptLevel::None,
            vec![make_input(bytes)],
            Some(module.clone()),
            true,
        )
        .unwrap_or_else(|failure| panic!("{case}: {failure}"));
        assert!(actual.resources.is_empty(), "{case}");
        assert_eq!(
            actual.result["sourceByteCount"],
            policy::MAX_BYTES,
            "{case}"
        );
        assert_eq!(actual.result, expected, "{case}");
        policy::validate_output(&actual.result, policy::MAX_BYTES, 0).unwrap();
        if case == "malformed-utf8-tail" {
            assert_eq!(actual.result["strictlyDecodable"], false);
        }
    }
    let oversized = execute_wasi_bundle(
        &request,
        wasmtime::OptLevel::None,
        vec![make_input(vec![b'a'; policy::MAX_BYTES + 1])],
        Some(module),
        true,
    );
    assert_eq!(oversized.err().as_deref(), Some("resource_input_too_large"));
}

fn native_report(executable: &Path, bytes: &[u8]) -> Value {
    let mut command = crate::process_command::new_command(executable);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let request = serde_json::to_vec(&json!({"capabilityId":"devtools.encoding.inspect","input":{},"bytesBase64":STANDARD.encode(bytes)})).unwrap();
    let (status, response) = crate::plugin_capabilities::worker_process::run_cancellable(
        command,
        request,
        Duration::from_secs(15),
        16 * 1024,
        None,
    )
    .unwrap();
    assert!(status.success());
    serde_json::from_slice::<Value>(&response).unwrap()["report"].clone()
}
