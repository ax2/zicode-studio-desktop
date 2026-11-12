use super::*;

fn fixture() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("visual-assets-reference-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::canonicalize(root).unwrap()
}

#[test]
fn approved_directory_and_revision_are_rechecked_before_reading() {
    let root = fixture();
    let approved = root.join("approved");
    let subdir = approved.join("子目录");
    fs::create_dir_all(&subdir).unwrap();
    let relative = Path::new(r"子目录\原件.png");
    let file = approved.join(relative);
    let old_file = subdir.join("previous.png");
    fs::write(&file, b"initial original").unwrap();
    let source = Root::approve(&approved).unwrap();
    let (bytes, initial) = source.read(relative, None).unwrap();
    assert_eq!(bytes, b"initial original");
    assert_eq!(source.read(relative, Some(&initial)).unwrap().1, initial);
    fs::write(&file, b"edited original").unwrap();
    assert_eq!(
        source.read(relative, Some(&initial)).unwrap_err(),
        Fault::ContentChanged
    );
    fs::rename(&file, &old_file).unwrap();
    assert_eq!(source.read(relative, None).unwrap_err(), Fault::Missing);
    fs::write(&file, b"initial original").unwrap();
    assert_eq!(
        source.read(relative, Some(&initial)).unwrap_err(),
        Fault::Replaced
    );
    let renamed = root.join("retired");
    let guard = DirectoryChain::hold(&approved).unwrap();
    assert!(fs::rename(&approved, &renamed).is_err());
    drop(guard);
    fs::rename(&approved, &renamed).unwrap();
    assert_eq!(source.read(relative, None).unwrap_err(), Fault::Missing);
    fs::create_dir_all(&subdir).unwrap();
    fs::write(&file, b"initial original").unwrap();
    assert_eq!(source.read(relative, None).unwrap_err(), Fault::Replaced);
    fs::remove_file(file).unwrap();
    fs::remove_dir(subdir).unwrap();
    fs::remove_dir(approved).unwrap();
    fs::remove_file(renamed.join(relative)).unwrap();
    fs::remove_file(renamed.join("子目录").join("previous.png")).unwrap();
    fs::remove_dir(renamed.join("子目录")).unwrap();
    fs::remove_dir(renamed).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn rejects_escaping_paths_alternate_streams_and_oversized_inputs() {
    let root = fixture();
    let source = Root::approve(&root).unwrap();
    for candidate in [
        "",
        r"..\outside.png",
        r"\file.png",
        r"D:\file.png",
        "file.png:alternate",
        "bad. ",
    ] {
        assert_eq!(
            source.read(Path::new(candidate), None).unwrap_err(),
            Fault::InvalidPath
        );
    }
    assert!(matches!(
        Root::approve(Path::new(r"\\server\share")),
        Err(Fault::InvalidPath)
    ));
    let file = root.join("large.png");
    fs::File::create(&file)
        .unwrap()
        .set_len(worker::INPUT + 1)
        .unwrap();
    assert_eq!(
        source.read(Path::new("large.png"), None).unwrap_err(),
        Fault::InvalidFile
    );
    fs::remove_file(file).unwrap();
    fs::remove_dir(root).unwrap();
}

#[test]
fn distinguishes_an_unavailable_volume_from_a_missing_file() {
    let source = Root {
        path: PathBuf::from(format!(r"\\?\Volume{{{}}}\approved", uuid::Uuid::new_v4())),
        identity: Identity {
            volume: 0,
            file: [0; 16],
            created: 0,
        },
    };
    assert_eq!(
        source.read(Path::new("original.png"), None).unwrap_err(),
        Fault::Offline
    );
}
