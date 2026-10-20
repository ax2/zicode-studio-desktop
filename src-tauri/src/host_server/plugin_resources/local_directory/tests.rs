use super::*;
use std::fs;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("local-directory-{}", uuid::Uuid::new_v4()));
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(
            root.join("owner.json"),
            json!({
                "purpose":"local directory resource tests",
                "lifetime":"remove on success; retain failure evidence",
                "pid":std::process::id()
            })
            .to_string(),
        )
        .unwrap();
        Self(data.canonicalize().unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if std::thread::panicking() {
            return;
        }
        let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .canonicalize()
            .unwrap();
        let root = self.0.parent().unwrap();
        assert!(root.starts_with(scratch));
        let _ = fs::remove_file(self.0.join("a.txt"));
        let _ = fs::remove_file(self.0.join("b.txt"));
        let _ = fs::remove_dir(self.0.join("link"));
        let _ = fs::remove_dir(self.0.join("folder"));
        let _ = fs::remove_dir(root.join("outside"));
        fs::remove_dir(&self.0).unwrap();
        fs::remove_file(root.join("owner.json")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

fn owner() -> Owner {
    Owner {
        runtime_id: "runtime".into(),
        session_id: "session".into(),
        plugin_id: "plugin".into(),
        capability_id: "list".into(),
    }
}
fn grant(root: &Path) -> Grant {
    Grant {
        owner: owner(),
        root: root.into(),
        relative: ".".into(),
        proof: "proof".into(),
        registry_revision: "revision".into(),
        stamp: "stamp".into(),
        expires: Instant::now() + TTL,
    }
}
fn request(grant_id: String) -> DirectoryGrantRequest {
    DirectoryGrantRequest {
        schema_version: 1,
        owner: owner(),
        grant_id,
        confirmed: true,
    }
}

#[test]
fn directory_path_and_snapshot_are_bounded_and_never_read_file_content() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("a.txt"), b"private content").unwrap();
    fs::create_dir(fixture.0.join("folder")).unwrap();
    let directory = open_directory(&fixture.0, ".").unwrap();
    let before = stamp(&directory).unwrap();
    let control = Control::new(Instant::now() + TTL);
    let (bytes, count) = snapshot(&directory, &before, &control).unwrap();
    let listing: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        listing["entries"],
        json!([
            {"name":"a.txt","kind":"file"}, {"name":"folder","kind":"directory"}
        ])
    );
    assert!(!String::from_utf8(bytes)
        .unwrap()
        .contains("private content"));
    for path in [
        "",
        "..",
        "../outside",
        "C:/outside",
        "folder/../outside",
        "folder\\outside",
    ] {
        assert!(validate_path(path).is_err(), "{path}");
    }
    assert!(open_directory(&fixture.0, "a.txt").is_err());
    fs::write(fixture.0.join("b.txt"), b"more").unwrap();
    // Some file systems retain the same directory timestamp for rapid writes.
    // If the metadata stamp does not change, the committed snapshot must still
    // include the new entry rather than publish an incomplete listing.
    match snapshot(&directory, &before, &control) {
        Err((_, Json(error))) => assert_eq!(error["error"]["code"], "resource_directory_changed"),
        Ok((bytes, count)) => {
            assert_eq!(count, 3);
            let listing: Value = serde_json::from_slice(&bytes).unwrap();
            assert!(listing["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["name"] == "b.txt"));
        }
    }
}

#[test]
fn directory_grants_require_matching_owner_and_are_one_use() {
    let fixture = Fixture::new();
    let mut grants = Grants::default();
    let id = grants.insert(grant(&fixture.0)).unwrap();
    let mut wrong = request(id.clone());
    wrong.owner.plugin_id = "other".into();
    assert!(grants.take(&wrong).is_err());
    assert!(grants.take(&request(id.clone())).is_ok());
    assert!(grants.take(&request(id)).is_err());
    let id = grants.insert(grant(&fixture.0)).unwrap();
    assert_eq!(
        grants.cancel(&request(id.clone())).unwrap()["cancelled"],
        true
    );
    assert!(grants.take(&request(id)).is_err());
}

#[cfg(windows)]
#[test]
fn directory_snapshot_rejects_reparse_entries_and_intermediate_directories() {
    let fixture = Fixture::new();
    let outside = fixture.0.parent().unwrap().join("outside");
    fs::create_dir(&outside).unwrap();
    let link = fixture.0.join("link");
    if let Err(error) = std::os::windows::fs::symlink_dir(&outside, &link) {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            eprintln!("symlink creation unavailable; reparse case not exercised");
            return;
        }
        panic!("symlink fixture failed: {error}");
    }
    let error = open_directory(&fixture.0, "link").err().unwrap();
    assert_eq!(
        error.1 .0["error"]["code"],
        "resource_directory_path_invalid"
    );
    let directory = open_directory(&fixture.0, ".").unwrap();
    let before = stamp(&directory).unwrap();
    let control = Control::new(Instant::now() + TTL);
    let error = snapshot(&directory, &before, &control).err().unwrap();
    assert_eq!(
        error.1 .0["error"]["code"],
        "resource_directory_entry_unsupported"
    );
}

#[cfg(windows)]
#[test]
fn directory_open_rejects_link_replacing_a_checked_child() {
    let fixture = Fixture::new();
    let outside = fixture.0.parent().unwrap().join("outside");
    fs::create_dir(&outside).unwrap();
    let link = fixture.0.join("link");
    fs::create_dir(&link).unwrap();
    let parent = Dir::open_ambient_dir(&fixture.0, ambient_authority()).unwrap();
    assert!(parent.symlink_metadata("link").unwrap().is_dir());
    fs::remove_dir(&link).unwrap();
    if let Err(error) = std::os::windows::fs::symlink_dir(&outside, &link) {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            eprintln!("symlink creation unavailable; replacement case not exercised");
            return;
        }
        panic!("replacement symlink fixture failed: {error}");
    }
    let error = open_checked_child(&parent, "link").err().unwrap();
    let (_, Json(body)) = error;
    assert_eq!(body["error"]["code"], "resource_directory_path_invalid");
}
