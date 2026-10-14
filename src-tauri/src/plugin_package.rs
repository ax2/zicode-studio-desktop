use crate::plugin_registry::PluginManifest;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::ZipArchive;

mod installed;
pub(crate) use installed::verify_installed_package;

const PACKAGE_SCHEMA_VERSION: u32 = 1;
const MAX_ARCHIVE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILES: usize = 2_048;
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_PACKAGE_MANIFEST_BYTES: u64 = 512 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedPackageManifest {
    schema_version: u32,
    publisher: PackagePublisher,
    files: Vec<PackageFile>,
    signature: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePublisher {
    pub name: String,
    pub key_id: String,
    pub public_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackageFile {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignaturePayload<'a> {
    schema_version: u32,
    publisher: &'a PackagePublisher,
    files: &'a [PackageFile],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedPluginPreview {
    pub package_path: String,
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub publisher_key_id: String,
    pub trusted: bool,
    pub permissions: Vec<String>,
}

#[derive(Debug)]
pub struct VerifiedPackage {
    pub(crate) integrity: serde_json::Value,
    pub package_path: PathBuf,
    pub manifest: PluginManifest,
    pub publisher: PackagePublisher,
    pub trusted: bool,
    files: Vec<PackageFile>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublisherTrustStore {
    #[serde(default = "trust_store_version")]
    version: u32,
    #[serde(default)]
    publishers: BTreeMap<String, TrustedPublisher>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedPublisher {
    name: String,
    public_key: String,
    #[serde(default)]
    revoked: bool,
}

fn trust_store_version() -> u32 {
    1
}

pub fn verify_package(package_path: &Path, plugin_root: &Path) -> Result<VerifiedPackage, String> {
    let package_path = package_path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve signed plugin package: {error}"))?;
    let metadata = fs::metadata(&package_path)
        .map_err(|error| format!("Cannot inspect signed plugin package: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err("Signed plugin package must be a file no larger than 50 MiB".into());
    }
    if package_path.extension().and_then(|value| value.to_str()) != Some("zicode-plugin") {
        return Err("Signed plugin package must use the .zicode-plugin extension".into());
    }
    let file = File::open(&package_path)
        .map_err(|error| format!("Cannot open signed plugin package: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("Signed plugin package is not a valid ZIP archive: {error}"))?;
    if archive.is_empty() || archive.len() > MAX_FILES + 1 {
        return Err("Signed plugin package has an invalid file count".into());
    }
    let package_manifest_bytes =
        read_archive_entry(&mut archive, "package.json", MAX_PACKAGE_MANIFEST_BYTES)?;
    let signed: SignedPackageManifest = serde_json::from_slice(&package_manifest_bytes)
        .map_err(|error| format!("Signed package manifest is invalid: {error}"))?;
    if signed.schema_version != PACKAGE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported signed package schema version {}",
            signed.schema_version
        ));
    }
    validate_publisher(&signed.publisher)?;
    if signed.files.is_empty() || signed.files.len() > MAX_FILES {
        return Err("Signed package file manifest has an invalid size".into());
    }
    let mut declared = HashSet::new();
    let mut expanded = 0u64;
    for entry in &signed.files {
        validate_package_path(&entry.path)?;
        let normalized_path = entry.path.to_ascii_lowercase();
        if entry.path.eq_ignore_ascii_case("package.json") || !declared.insert(normalized_path) {
            return Err(format!("Duplicate or reserved package path {}", entry.path));
        }
        if entry.size > MAX_FILE_BYTES {
            return Err(format!("Package file {} exceeds 10 MiB", entry.path));
        }
        expanded = expanded
            .checked_add(entry.size)
            .ok_or_else(|| "Signed package expanded size overflow".to_string())?;
        if expanded > MAX_EXPANDED_BYTES {
            return Err("Signed package expands beyond 50 MiB".into());
        }
        if !is_hex_sha256(&entry.sha256) {
            return Err(format!("Invalid SHA-256 for package file {}", entry.path));
        }
    }
    let mut archive_paths = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Cannot inspect package archive entry: {error}"))?;
        let name = entry.name().to_string();
        validate_package_path(&name)?;
        if !archive_paths.insert(name.to_ascii_lowercase()) {
            return Err(format!("Duplicate ZIP entry {name}"));
        }
        if entry.is_dir() || is_zip_symlink(entry.unix_mode()) {
            return Err(format!(
                "Directories and links are not allowed in signed packages: {name}"
            ));
        }
        if name != "package.json" && !declared.contains(&name.to_ascii_lowercase()) {
            return Err(format!("Unsigned archive entry {name}"));
        }
    }
    if archive_paths.len() != signed.files.len() + 1 {
        return Err("Signed package is missing one or more declared files".into());
    }
    for entry in &signed.files {
        let bytes = read_archive_entry(&mut archive, &entry.path, entry.size)?;
        if bytes.len() as u64 != entry.size || hex_sha256(&bytes) != entry.sha256 {
            return Err(format!("Package file hash mismatch: {}", entry.path));
        }
    }
    verify_signature(&signed)?;
    let plugin_bytes = read_archive_entry(&mut archive, "plugin.json", MAX_FILE_BYTES)?;
    let manifest: PluginManifest = serde_json::from_slice(&plugin_bytes)
        .map_err(|error| format!("Plugin manifest is invalid: {error}"))?;
    // Reject unsupported engines before preview, extraction or publisher trust.
    crate::plugin_registry::runtime_contract::validate(&manifest.runtime)?;
    crate::plugin_registry::file_input::validate_manifest(&manifest)?;
    if manifest.publisher.trim() != signed.publisher.name.trim() {
        return Err("Plugin publisher does not match the signed publisher".into());
    }
    let store = load_trust_store(plugin_root);
    let trust = store.publishers.get(&signed.publisher.key_id);
    if trust.is_some_and(|publisher| publisher.revoked) {
        return Err(format!(
            "Publisher {} has been revoked",
            signed.publisher.key_id
        ));
    }
    let trusted = trust.is_some_and(|publisher| {
        publisher.public_key == signed.publisher.public_key && !publisher.revoked
    });
    Ok(VerifiedPackage {
        integrity: serde_json::to_value(&signed)
            .map_err(|error| format!("Cannot preserve package signature proof: {error}"))?,
        package_path,
        manifest,
        publisher: signed.publisher,
        trusted,
        files: signed.files,
    })
}

pub fn preview_package(
    package_path: &Path,
    plugin_root: &Path,
) -> Result<SignedPluginPreview, String> {
    let verified = verify_package(package_path, plugin_root)?;
    let permissions = verified
        .manifest
        .permissions
        .required
        .iter()
        .chain(&verified.manifest.permissions.optional)
        .map(|permission| permission.name.clone())
        .collect();
    Ok(SignedPluginPreview {
        package_path: verified.package_path.to_string_lossy().into_owned(),
        plugin_id: verified.manifest.id,
        name: verified.manifest.name,
        version: verified.manifest.version,
        publisher: verified.publisher.name,
        publisher_key_id: verified.publisher.key_id,
        trusted: verified.trusted,
        permissions,
    })
}

pub fn trust_publisher(plugin_root: &Path, publisher: &PackagePublisher) -> Result<(), String> {
    validate_publisher(publisher)?;
    let mut store = load_trust_store(plugin_root);
    if store
        .publishers
        .get(&publisher.key_id)
        .is_some_and(|candidate| candidate.revoked)
    {
        return Err(
            "A revoked publisher cannot be trusted again without an explicit revocation reset"
                .into(),
        );
    }
    store.publishers.insert(
        publisher.key_id.clone(),
        TrustedPublisher {
            name: publisher.name.clone(),
            public_key: publisher.public_key.clone(),
            revoked: false,
        },
    );
    save_trust_store(plugin_root, &store)
}

pub fn revoke_publisher(plugin_root: &Path, key_id: &str) -> Result<(), String> {
    let mut store = load_trust_store(plugin_root);
    let publisher = store
        .publishers
        .get_mut(key_id)
        .ok_or_else(|| format!("Unknown publisher key: {key_id}"))?;
    publisher.revoked = true;
    save_trust_store(plugin_root, &store)
}

pub fn publisher_is_trusted(plugin_root: &Path, key_id: &str, public_key: &str) -> bool {
    load_trust_store(plugin_root)
        .publishers
        .get(key_id)
        .is_some_and(|publisher| publisher.public_key == public_key && !publisher.revoked)
}

pub fn extract_verified_package(
    package: &VerifiedPackage,
    destination: &Path,
) -> Result<(), String> {
    if destination.exists() {
        return Err("Signed package staging destination already exists".into());
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("Cannot create signed package staging directory: {error}"))?;
    let outcome = (|| {
        let file = File::open(&package.package_path)
            .map_err(|error| format!("Cannot reopen signed plugin package: {error}"))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|error| format!("Cannot reopen signed package archive: {error}"))?;
        for declared in &package.files {
            let bytes = read_archive_entry(&mut archive, &declared.path, declared.size)?;
            let target = destination.join(&declared.path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Cannot create package directory: {error}"))?;
            }
            let mut output = File::create(&target)
                .map_err(|error| format!("Cannot create extracted package file: {error}"))?;
            output
                .write_all(&bytes)
                .map_err(|error| format!("Cannot write extracted package file: {error}"))?;
        }
        Ok(())
    })();
    if outcome.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    outcome
}

fn read_archive_entry<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    path: &str,
    maximum: u64,
) -> Result<Vec<u8>, String> {
    let entry = archive
        .by_name(path)
        .map_err(|_| format!("Signed package is missing {path}"))?;
    if entry.size() > maximum || entry.size() > MAX_FILE_BYTES.max(MAX_PACKAGE_MANIFEST_BYTES) {
        return Err(format!("Package entry {path} exceeds its size limit"));
    }
    if entry.compressed_size() > 0 && entry.size() / entry.compressed_size().max(1) > 200 {
        return Err(format!(
            "Package entry {path} exceeds the compression ratio limit"
        ));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read package entry {path}: {error}"))?;
    if bytes.len() as u64 > maximum {
        return Err(format!("Package entry {path} exceeds its size limit"));
    }
    Ok(bytes)
}

fn verify_signature(signed: &SignedPackageManifest) -> Result<(), String> {
    let public_key = BASE64
        .decode(&signed.publisher.public_key)
        .map_err(|_| "Publisher public key is not valid base64".to_string())?;
    let public_key: [u8; 32] = public_key
        .try_into()
        .map_err(|_| "Publisher public key must be 32 bytes".to_string())?;
    let key = VerifyingKey::from_bytes(&public_key)
        .map_err(|_| "Publisher public key is invalid".to_string())?;
    let signature = BASE64
        .decode(&signed.signature)
        .map_err(|_| "Package signature is not valid base64".to_string())?;
    let signature = Signature::from_slice(&signature)
        .map_err(|_| "Package signature must be 64 bytes".to_string())?;
    let payload = serde_json::to_vec(&SignaturePayload {
        schema_version: signed.schema_version,
        publisher: &signed.publisher,
        files: &signed.files,
    })
    .map_err(|error| format!("Cannot serialize package signature payload: {error}"))?;
    key.verify(&payload, &signature)
        .map_err(|_| "Package publisher signature is invalid".to_string())
}

fn validate_publisher(publisher: &PackagePublisher) -> Result<(), String> {
    if publisher.name.trim().is_empty() || publisher.name.len() > 200 {
        return Err("Signed package publisher name is invalid".into());
    }
    let public_key = BASE64
        .decode(&publisher.public_key)
        .map_err(|_| "Publisher public key is not valid base64".to_string())?;
    if public_key.len() != 32 || publisher.key_id != hex_sha256(&public_key) {
        return Err("Publisher key ID does not match the public key fingerprint".into());
    }
    Ok(())
}

fn validate_package_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 512 || path.contains('\\') || path.contains(':') {
        return Err(format!("Invalid signed package path {path}"));
    }
    let parsed = Path::new(path);
    if parsed.is_absolute()
        || parsed
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("Signed package path escapes its root: {path}"));
    }
    for component in path.split('/') {
        if component.is_empty()
            || component.len() > 255
            || crate::portable_path::reserved_windows_device_name(component)
            || component.ends_with(' ')
            || component.ends_with('.')
            || component
                .chars()
                .any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
        {
            return Err(format!(
                "Signed package uses a reserved Windows path: {path}"
            ));
        }
    }
    Ok(())
}

fn is_zip_symlink(mode: Option<u32>) -> bool {
    mode.is_some_and(|value| value & 0o170000 == 0o120000)
}

fn is_hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn trust_store_path(plugin_root: &Path) -> PathBuf {
    plugin_root.join("trust").join("publishers.json")
}

fn load_trust_store(plugin_root: &Path) -> PublisherTrustStore {
    let path = trust_store_path(plugin_root);
    let Ok(bytes) = fs::read(path) else {
        return PublisherTrustStore {
            version: 1,
            publishers: BTreeMap::new(),
        };
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_trust_store(plugin_root: &Path, store: &PublisherTrustStore) -> Result<(), String> {
    let path = trust_store_path(plugin_root);
    let parent = path
        .parent()
        .ok_or_else(|| "Publisher trust store path is invalid".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create publisher trust directory: {error}"))?;
    let temporary = parent.join(format!(".publishers-{}.tmp", uuid::Uuid::new_v4().simple()));
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Cannot serialize publisher trust store: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Cannot write publisher trust store: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Cannot commit publisher trust store: {error}")
    })
}

#[cfg(test)]
pub(crate) fn write_test_signed_package(
    directory: &Path,
    manifest: &serde_json::Value,
    file_name: &str,
) -> PathBuf {
    use ed25519_dalek::{Signer, SigningKey};
    use zip::write::SimpleFileOptions;

    fs::create_dir_all(directory).unwrap();
    let plugin_bytes = serde_json::to_vec(manifest).unwrap();
    let signing_key = SigningKey::from_bytes(&[11u8; 32]);
    let public_key = signing_key.verifying_key().to_bytes();
    let publisher = PackagePublisher {
        name: manifest["publisher"].as_str().unwrap().to_string(),
        key_id: hex_sha256(&public_key),
        public_key: BASE64.encode(public_key),
    };
    let files = vec![PackageFile {
        path: "plugin.json".into(),
        sha256: hex_sha256(&plugin_bytes),
        size: plugin_bytes.len() as u64,
    }];
    let payload = serde_json::to_vec(&SignaturePayload {
        schema_version: 1,
        publisher: &publisher,
        files: &files,
    })
    .unwrap();
    let signed = SignedPackageManifest {
        schema_version: 1,
        publisher,
        files,
        signature: BASE64.encode(signing_key.sign(&payload).to_bytes()),
    };
    let package = directory.join(file_name);
    let output = File::create(&package).unwrap();
    let mut zip = zip::ZipWriter::new(output);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("package.json", options).unwrap();
    zip.write_all(&serde_json::to_vec_pretty(&signed).unwrap())
        .unwrap();
    zip.start_file("plugin.json", options).unwrap();
    zip.write_all(&plugin_bytes).unwrap();
    zip.finish().unwrap();
    package
}

#[cfg(test)]
mod tests {
    use super::{
        extract_verified_package, hex_sha256, preview_package, trust_publisher, verify_package,
        PackageFile, PackagePublisher, SignaturePayload, SignedPackageManifest,
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};
    use std::collections::BTreeMap;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use zip::write::SimpleFileOptions;

    fn root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "zicode-signed-package-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }

    fn build_package(root: &Path, files: BTreeMap<String, Vec<u8>>) -> (PathBuf, PackagePublisher) {
        build_package_with_invalid_signature(root, files, false)
    }

    fn build_package_with_invalid_signature(
        root: &Path,
        files: BTreeMap<String, Vec<u8>>,
        invalidate_signature: bool,
    ) -> (PathBuf, PackagePublisher) {
        fs::create_dir_all(root).unwrap();
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let public_key = signing_key.verifying_key().to_bytes();
        let publisher = PackagePublisher {
            name: "Example Publisher".into(),
            key_id: hex_sha256(&public_key),
            public_key: BASE64.encode(public_key),
        };
        let declared: Vec<PackageFile> = files
            .iter()
            .map(|(path, bytes)| PackageFile {
                path: path.clone(),
                sha256: hex_sha256(bytes),
                size: bytes.len() as u64,
            })
            .collect();
        let payload = serde_json::to_vec(&SignaturePayload {
            schema_version: 1,
            publisher: &publisher,
            files: &declared,
        })
        .unwrap();
        let mut signature = signing_key.sign(&payload).to_bytes();
        if invalidate_signature {
            signature[0] ^= 0xff;
        }
        let manifest = SignedPackageManifest {
            schema_version: 1,
            publisher: publisher.clone(),
            files: declared,
            signature: BASE64.encode(signature),
        };
        let package = root.join("example.zicode-plugin");
        let output = File::create(&package).unwrap();
        let mut zip = zip::ZipWriter::new(output);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("package.json", options).unwrap();
        zip.write_all(&serde_json::to_vec_pretty(&manifest).unwrap())
            .unwrap();
        for (path, bytes) in files {
            zip.start_file(path, options).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
        (package, publisher)
    }

    fn valid_files() -> BTreeMap<String, Vec<u8>> {
        BTreeMap::from([
            (
                "plugin.json".into(),
                serde_json::to_vec(&serde_json::json!({
                    "schemaVersion": 1,
                    "id": "com.example.signed",
                    "name": "Signed Example",
                    "description": "Signed package fixture",
                    "version": "1.0.0",
                    "publisher": "Example Publisher",
                    "engines": { "pluginApi": "^1.0.0" },
                    "contributes": {},
                    "permissions": { "required": [], "optional": [] }
                }))
                .unwrap(),
            ),
            ("assets/readme.txt".into(), b"verified content".to_vec()),
        ])
    }

    #[test]
    fn verifies_trusts_and_extracts_a_signed_package() {
        let root = root("valid");
        let plugin_root = root.join("registry");
        let (package, publisher) = build_package(&root, valid_files());
        let preview = preview_package(&package, &plugin_root).unwrap();
        assert!(!preview.trusted);
        assert_eq!(preview.plugin_id, "com.example.signed");
        trust_publisher(&plugin_root, &publisher).unwrap();
        let verified = verify_package(&package, &plugin_root).unwrap();
        assert!(verified.trusted);
        let destination = root.join("extracted");
        extract_verified_package(&verified, &destination).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("assets/readme.txt")).unwrap(),
            "verified content"
        );
        if root.exists() {
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn rejects_a_signed_zip_slip_path_before_extraction() {
        let root = root("escape");
        let mut files = valid_files();
        files.insert("../outside.txt".into(), b"escape".to_vec());
        let (package, _) = build_package(&root, files);
        let error = verify_package(&package, &root.join("registry")).unwrap_err();
        assert!(error.contains("escapes its root"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_invalid_signatures_case_collisions_and_windows_device_names() {
        let signature_root = root("signature");
        let (bad_signature, _) =
            build_package_with_invalid_signature(&signature_root, valid_files(), true);
        assert!(
            verify_package(&bad_signature, &signature_root.join("registry"))
                .unwrap_err()
                .contains("signature is invalid")
        );

        let collision_root = root("collision");
        let mut collision_files = valid_files();
        collision_files.insert("assets/Readme.txt".into(), b"one".to_vec());
        collision_files.insert("assets/readme.txt".into(), b"two".to_vec());
        let (collision, _) = build_package(&collision_root, collision_files);
        assert!(verify_package(&collision, &collision_root.join("registry"))
            .unwrap_err()
            .contains("Duplicate"));

        let device_root = root("device");
        let mut device_files = valid_files();
        device_files.insert("assets/COM¹.txt".into(), b"device".to_vec());
        let (device, _) = build_package(&device_root, device_files);
        assert!(verify_package(&device, &device_root.join("registry"))
            .unwrap_err()
            .contains("reserved Windows path"));

        fs::remove_dir_all(signature_root).unwrap();
        fs::remove_dir_all(collision_root).unwrap();
        fs::remove_dir_all(device_root).unwrap();
    }

    #[test]
    fn rejects_nonportable_signed_package_components() {
        for path in [
            "assets/CON.txt".to_string(),
            "assets/LPT².log".to_string(),
            "assets/bad?.txt".to_string(),
            "assets/control\u{0001}.txt".to_string(),
            format!("assets/{}", "a".repeat(256)),
            "assets//file.txt".to_string(),
        ] {
            assert!(super::validate_package_path(&path).is_err(), "{path:?}");
        }
        for path in ["assets/COM10.txt", "assets/普通文件.wasm"] {
            assert!(super::validate_package_path(path).is_ok(), "{path:?}");
        }
    }

    #[test]
    fn verifies_an_external_packager_fixture_when_requested() {
        let Ok(package) = std::env::var("ZICODE_SIGNED_FIXTURE") else {
            return;
        };
        let root = root("external-packager");
        let verified = verify_package(Path::new(&package), &root).unwrap();
        assert_eq!(verified.manifest.id, "com.zicode.example-view");
        assert_eq!(verified.publisher.name, "zicode-examples");
        if root.exists() {
            fs::remove_dir_all(root).unwrap();
        }
    }
}
