use super::*;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("resource-export-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        Self(p.canonicalize().unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
#[test]
fn resource_export_creates_exact_custom_unicode_file_and_verifies_empty_and_large() {
    let f = Fixture::new();
    for size in [0, 100, 16 * 1024 * 1024] {
        let data = vec![b'x'; size];
        let version = sha256_hex(&data);
        let path = f.0.join(format!("用户文档 {size}.html"));
        let d = Destination::prepare(path.clone()).unwrap();
        let staged = Staged::new(&d, &[data.into()], size, &version).unwrap();
        assert!(!path.exists());
        staged.publish().unwrap();
        d.verify(size, &version).unwrap();
        assert_eq!(fs::metadata(path).unwrap().len(), size as u64);
    }
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 3);
}
#[test]
fn resource_export_preserves_existing_and_racing_destination() {
    let f = Fixture::new();
    let path = f.0.join("existing.html");
    fs::write(&path, b"user content").unwrap();
    assert!(Destination::prepare(path.clone()).is_err());
    fs::remove_file(&path).unwrap();
    let d = Destination::prepare(path.clone()).unwrap();
    let staged = Staged::new(&d, &[Arc::from(&b"new"[..])], 3, &sha256_hex(b"new")).unwrap();
    fs::write(&path, b"user content").unwrap();
    assert!(staged.publish().is_err());
    assert_eq!(fs::read(path).unwrap(), b"user content");
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}
#[test]
fn resource_export_bad_digest_and_cancel_leave_no_partial_file() {
    let f = Fixture::new();
    let d = Destination::prepare(f.0.join("draft.html")).unwrap();
    assert!(Staged::new(&d, &[Arc::from(&b"new"[..])], 3, &sha256_hex(b"old")).is_err());
    let staged = Staged::new(&d, &[Arc::from(&b"new"[..])], 3, &sha256_hex(b"new")).unwrap();
    drop(staged);
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 0);
}
#[test]
fn resource_export_rejects_replaced_parent_and_changed_saved_file() {
    let f = Fixture::new();
    let original = f.0.join("original");
    fs::create_dir(&original).unwrap();
    let d = Destination::prepare(original.join("document.html")).unwrap();
    fs::rename(&original, f.0.join("previous")).unwrap();
    fs::create_dir(&original).unwrap();
    assert!(Staged::new(&d, &[], 0, &sha256_hex(b"")).is_err());
    let d = Destination::prepare(original.join("new.html")).unwrap();
    Staged::new(&d, &[Arc::from(&b"abc"[..])], 3, &sha256_hex(b"abc"))
        .unwrap()
        .publish()
        .unwrap();
    fs::write(&d.path, b"xyz").unwrap();
    assert!(d.verify(3, &sha256_hex(b"abc")).is_err());
    assert_eq!(fs::read(&d.path).unwrap(), b"xyz");
}
#[test]
fn resource_export_rejects_relative_ads_and_ambiguous_names() {
    let f = Fixture::new();
    for p in [
        PathBuf::from("relative.html"),
        f.0.join("name:stream"),
        f.0.join("trailing. "),
    ] {
        assert!(Destination::prepare(p).is_err());
    }
}

#[test]
fn resource_export_exact_names_across_utf16_alignment_boundaries() {
    let f = Fixture::new();
    let bytes = b"exact manifest copy\n";
    let version = sha256_hex(bytes);
    let mut expected = std::collections::BTreeSet::new();
    for suffix in 0..8 {
        let name = format!("manifest-{}-工具😀.txt", "x".repeat(suffix));
        let path = f.0.join(&name);
        let destination = Destination::prepare(path.clone()).unwrap();
        Staged::new(&destination, &[Arc::from(&bytes[..])], bytes.len(), &version)
            .unwrap().publish().unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes, "wrong destination: {name}");
        destination.verify(bytes.len(), &version).unwrap();
        assert!(Destination::prepare(path).is_err());
        expected.insert(name);
    }
    let actual: std::collections::BTreeSet<_> = fs::read_dir(&f.0).unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap()).collect();
    assert_eq!(actual, expected, "no extra suffixes or pending files");
}
