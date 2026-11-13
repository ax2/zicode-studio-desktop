use super::super::move_tests::Fixture;
use super::*;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

type Hook = Box<dyn FnMut(&str)>;
thread_local! { static HOOK: RefCell<Option<Hook>> = RefCell::new(None); }
pub(super) fn checkpoint(name: &str) {
    HOOK.with(|hook| {
        if let Some(action) = hook.borrow_mut().as_mut() {
            action(name);
        }
    });
}
fn hook(action: impl FnMut(&str) + 'static) {
    HOOK.with(|h| *h.borrow_mut() = Some(Box::new(action)));
}
fn reset() {
    HOOK.with(|h| *h.borrow_mut() = None);
}

fn seeded(f: &Fixture, source: &str, target: &str) -> (NoteDocument, Vec<(String, Vec<u8>)>) {
    let result = f.seeded(source);
    for book in [source, target] {
        let path = f.vault.vault_root(book).unwrap().join(".zicode/vault.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["updatedAt"] = json!("2001-01-01T00:00:00Z");
        fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    }
    result
}

fn reopen(f: &mut Fixture) -> Result<(), NotesError> {
    let workspace = f.vault.workspace_id.clone().unwrap();
    f.vault.storage_guard = None;
    f.vault = NotesVault::new(f.root.join("plugins"))
        .unwrap()
        .scoped(&workspace)?;
    Ok(())
}
fn saved(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn collect(root: &Path, path: &Path, result: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in fs::read_dir(path).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name();
            if name == JOURNALS || name == ".notes.lock" {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                collect(root, &entry.path(), result);
            } else {
                result.insert(
                    entry.path().strip_prefix(root).unwrap().to_path_buf(),
                    fs::read(entry.path()).unwrap(),
                );
            }
        }
    }
    let mut result = BTreeMap::new();
    collect(root, root, &mut result);
    result
}
fn interrupt(f: &Fixture, source: &str, target: &str, note: &NoteDocument, at: usize) {
    let mut count = 0;
    hook(move |_| {
        count += 1;
        if count == at {
            panic!("interrupted move at step {at}");
        }
    });
    let result = catch_unwind(AssertUnwindSafe(|| {
        f.vault
            .move_note(source, &note.summary.id, target, &note.summary.version)
    }));
    reset();
    assert!(result.is_err(), "checkpoint {at} must execute");
}

#[test]
fn every_move_checkpoint_recovers_original_or_committed_data_on_reopen() {
    let f = Fixture::new();
    let (a, b) = f.books();
    let (note, _) = seeded(&f, &a.id, &b.id);
    let names = std::rc::Rc::new(RefCell::new(Vec::new()));
    let record = names.clone();
    hook(move |name| record.borrow_mut().push(name.to_string()));
    f.vault
        .move_note(&a.id, &note.summary.id, &b.id, &note.summary.version)
        .unwrap();
    reset();
    assert!(names.borrow().len() >= 14);
    let mut committed = false;
    for (index, name) in names.borrow().iter().enumerate() {
        let mut f = Fixture::new();
        let (a, b) = f.books();
        let (note, files) = seeded(&f, &a.id, &b.id);
        let before = saved(&f.vault.vaults_dir());
        interrupt(&f, &a.id, &b.id, &note, index + 1);
        committed |= name == "committed";
        reopen(&mut f).unwrap();
        if !committed {
            assert_eq!(saved(&f.vault.vaults_dir()), before, "step {index}: {name}");
        }
        let book = if committed { &b.id } else { &a.id };
        let restored = f.vault.get_note(book, &note.summary.id).unwrap();
        assert_eq!(restored.content, note.content);
        for (id, bytes) in &files {
            assert_eq!(
                &f.vault
                    .read_attachment(book, &note.summary.id, id)
                    .unwrap()
                    .0,
                bytes
            );
        }
        assert!(fs::read_dir(f.vault.vaults_dir().join(JOURNALS))
            .unwrap()
            .next()
            .is_none());
        let once = saved(&f.vault.vaults_dir());
        reopen(&mut f).unwrap();
        assert_eq!(saved(&f.vault.vaults_dir()), once);
    }
}

#[test]
fn external_edit_blocks_recovery_without_overwriting_it_then_retry_succeeds() {
    let mut f = Fixture::new();
    let (a, b) = f.books();
    let (note, _) = seeded(&f, &a.id, &b.id);
    let before = saved(&f.vault.vaults_dir());
    hook(|name| {
        if name == "committed" {
            panic!("committed move");
        }
    });
    let _ = catch_unwind(AssertUnwindSafe(|| {
        f.vault
            .move_note(&a.id, &note.summary.id, &b.id, &note.summary.version)
    }));
    reset();
    let root = f.vault.vaults_dir();
    let entry = fs::read_dir(root.join(JOURNALS))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(entry.extension().unwrap(), "committed");
    // An externally modified destination must not discard the retained originals.
    let path = f.vault.note_path(&b.id, &note.summary.id).unwrap();
    let published = fs::read(&path).unwrap();
    fs::write(&path, b"external edit").unwrap();
    assert_eq!(reopen(&mut f).unwrap_err().code, "move_recovery_required");
    assert_eq!(fs::read(&path).unwrap(), b"external edit");
    assert!(entry.join("old/2").exists());
    fs::write(&path, published).unwrap();
    reopen(&mut f).unwrap();
    assert_eq!(
        f.vault.get_note(&b.id, &note.summary.id).unwrap().content,
        note.content
    );
    assert_ne!(saved(&root), before);
}

#[test]
fn pending_rollback_can_itself_be_interrupted_and_retried() {
    let mut f = Fixture::new();
    let (a, b) = f.books();
    let (note, _) = seeded(&f, &a.id, &b.id);
    let before = saved(&f.vault.vaults_dir());
    let mut backups = 0;
    hook(move |name| {
        if name == "backup" {
            backups += 1;
            if backups == 4 {
                panic!("late move");
            }
        }
    });
    let _ = catch_unwind(AssertUnwindSafe(|| {
        f.vault
            .move_note(&a.id, &note.summary.id, &b.id, &note.summary.version)
    }));
    reset();
    hook(|name| {
        if name == "rollback-remove" {
            panic!("rollback interrupted");
        }
    });
    assert!(catch_unwind(AssertUnwindSafe(|| reopen(&mut f))).is_err());
    reset();
    reopen(&mut f).unwrap();
    assert_eq!(saved(&f.vault.vaults_dir()), before);
}

#[test]
fn unknown_or_traversing_journal_is_retained_and_rejected() {
    let mut f = Fixture::new();
    let (a, b) = f.books();
    let (note, _) = seeded(&f, &a.id, &b.id);
    let before = saved(&f.vault.vaults_dir());
    hook(|name| {
        if name == "pending" {
            panic!("journal published");
        }
    });
    let _ = catch_unwind(AssertUnwindSafe(|| {
        f.vault
            .move_note(&a.id, &note.summary.id, &b.id, &note.summary.version)
    }));
    reset();
    let root = f.vault.vaults_dir();
    let stage = fs::read_dir(root.join(JOURNALS))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let manifest = stage.join("manifest.json");
    let original = fs::read(&manifest).unwrap();
    let mut value: Value = serde_json::from_slice(&original).unwrap();
    value["source"]["id"] = json!("../outside");
    fs::write(&manifest, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(reopen(&mut f).unwrap_err().code, "move_recovery_required");
    assert_eq!(saved(&root), before);
    assert!(stage.exists());
    fs::write(manifest, original).unwrap();
    reopen(&mut f).unwrap();
    assert_eq!(saved(&root), before);
}

#[test]
fn owned_move_child() {
    let Ok(root) = std::env::var("ZICODE_MOVE_TEST_CHILD") else {
        return;
    };
    let root = PathBuf::from(root);
    let boundary = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".cache/task-scratch/note-move")
        .canonicalize()
        .unwrap();
    assert_eq!(
        root.canonicalize().unwrap().parent(),
        Some(boundary.as_path())
    );
    assert_eq!(
        fs::read(root.join("test-owner")).unwrap(),
        b"note-move-test"
    );
    let request: Value =
        serde_json::from_slice(&fs::read(root.join("child-request.json")).unwrap()).unwrap();
    let vault = NotesVault::new(root.join("plugins"))
        .unwrap()
        .scoped(request["workspace"].as_str().unwrap())
        .unwrap();
    let ready = root.join("child-ready");
    let phase = request["phase"].as_str().unwrap().to_string();
    let occurrence = request["occurrence"].as_u64().unwrap();
    let mut seen = 0;
    hook(move |name| {
        if name == phase {
            seen += 1;
            if seen == occurrence {
                let mut file = fs::File::create(&ready).unwrap();
                file.write_all(b"ready").unwrap();
                file.sync_all().unwrap();
                loop {
                    std::thread::park_timeout(Duration::from_secs(1));
                }
            }
        }
    });
    vault
        .move_note(
            request["source"].as_str().unwrap(),
            request["note"].as_str().unwrap(),
            request["target"].as_str().unwrap(),
            request["version"].as_str().unwrap(),
        )
        .unwrap();
    panic!("child did not reach its interruption checkpoint");
}

#[test]
fn terminating_owned_process_preserves_data_before_and_after_commit() {
    for (phase, occurrence, committed) in [
        ("attachment", 1, false),
        ("backup", 4, false),
        ("committed", 1, true),
    ] {
        let mut f = Fixture::new();
        let (a, b) = f.books();
        let (note, files) = seeded(&f, &a.id, &b.id);
        let before = saved(&f.vault.vaults_dir());
        let request = json!({ "workspace":f.vault.workspace_id, "source":a.id, "target":b.id, "note":note.summary.id, "version":note.summary.version, "phase":phase, "occurrence":occurrence });
        fs::write(
            f.root.join("child-request.json"),
            serde_json::to_vec(&request).unwrap(),
        )
        .unwrap();
        f.vault.storage_guard = None;
        let log = fs::File::create(f.root.join("child.log")).unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "notes_vault::move_journal::tests::owned_move_child",
                "--nocapture",
            ])
            .env("ZICODE_MOVE_TEST_CHILD", &f.root)
            .stdout(log.try_clone().unwrap())
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn().unwrap();
        let start = Instant::now();
        while !f.root.join("child-ready").exists() {
            if let Some(status) = child.try_wait().unwrap() {
                panic!(
                    "owned child exited before checkpoint: {status}; {}",
                    fs::read_to_string(f.root.join("child.log")).unwrap()
                );
            }
            if start.elapsed() > Duration::from_secs(30) {
                child.kill().unwrap();
                child.wait().unwrap();
                panic!("owned child timed out before {phase}");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        // This handle is the child created immediately above, never a user app.
        child.kill().unwrap();
        assert!(!child.wait().unwrap().success());
        let exported = export_interrupted_fixture(&f, phase);
        reopen(&mut f).unwrap();
        if !committed {
            assert_eq!(saved(&f.vault.vaults_dir()), before);
        }
        let book = if committed { &b.id } else { &a.id };
        assert_eq!(
            f.vault.get_note(book, &note.summary.id).unwrap().content,
            note.content
        );
        for (id, bytes) in files {
            assert_eq!(
                f.vault
                    .read_attachment(book, &note.summary.id, &id)
                    .unwrap()
                    .0,
                bytes
            );
        }
        if let Some(directory) = exported {
            let hashes: BTreeMap<String, String> = saved(&f.vault.vaults_dir())
                .into_iter()
                .map(|(path, bytes)| {
                    (
                        path.to_string_lossy().replace('\\', "/"),
                        format!("{:x}", Sha256::digest(bytes)),
                    )
                })
                .collect();
            let expected = json!({"phase":phase,"committed":committed,"source":a.id,"target":b.id,"book":book,"note":note.summary.id,"title":note.summary.title,"content":note.content,"hashes":hashes});
            fs::write(
                directory.join("expected.json"),
                serde_json::to_vec_pretty(&expected).unwrap(),
            )
            .unwrap();
        }
        reopen(&mut f).unwrap();
    }
}

fn export_interrupted_fixture(f: &Fixture, phase: &str) -> Option<PathBuf> {
    let root = std::env::var("ZICODE_MOVE_NATIVE_FIXTURES")
        .ok()
        .map(PathBuf::from)?;
    let owner = root.parent().unwrap();
    let boundary = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".cache/task-scratch")
        .canonicalize()
        .unwrap();
    assert_eq!(
        owner.canonicalize().unwrap().parent(),
        Some(boundary.as_path())
    );
    assert_eq!(
        fs::read(owner.join("owner.txt")).unwrap(),
        b"Issue22 durable note move native acceptance; synthetic data only"
    );
    let destination = root.join(phase);
    assert!(
        !destination.exists(),
        "Preserve prior native fixture evidence"
    );
    fn copy(source: &Path, target: &Path) {
        fs::create_dir_all(target).unwrap();
        for entry in fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink());
            if kind.is_dir() {
                copy(&entry.path(), &target.join(entry.file_name()));
            } else {
                assert!(kind.is_file());
                fs::copy(entry.path(), target.join(entry.file_name())).unwrap();
            }
        }
    }
    copy(&f.vault.vaults_dir(), &destination.join("vault"));
    Some(destination)
}

#[cfg(windows)]
#[test]
fn locked_destination_retains_journal_until_rollback_can_be_retried() {
    use std::os::windows::fs::OpenOptionsExt;
    let mut f = Fixture::new();
    let (a, b) = f.books();
    let (note, _) = seeded(&f, &a.id, &b.id);
    let before = saved(&f.vault.vaults_dir());
    let mut count = 0;
    hook(move |name| {
        if name == "backup" {
            count += 1;
            if count == 4 {
                panic!("late interruption");
            }
        }
    });
    let _ = catch_unwind(AssertUnwindSafe(|| {
        f.vault
            .move_note(&a.id, &note.summary.id, &b.id, &note.summary.version)
    }));
    reset();
    let destination = f.vault.note_path(&b.id, &note.summary.id).unwrap();
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&destination)
        .unwrap();
    assert_eq!(reopen(&mut f).unwrap_err().code, "move_recovery_required");
    assert!(destination.exists());
    assert!(fs::read_dir(f.vault.vaults_dir().join(JOURNALS))
        .unwrap()
        .next()
        .is_some());
    drop(held);
    reopen(&mut f).unwrap();
    assert_eq!(saved(&f.vault.vaults_dir()), before);
}

#[test]
fn pending_external_edit_is_preserved_and_original_remains_recoverable() {
    let mut f = Fixture::new();
    let (a, b) = f.books();
    let (note, _) = seeded(&f, &a.id, &b.id);
    let before = saved(&f.vault.vaults_dir());
    let mut backups = 0;
    hook(move |name| {
        if name == "backup" {
            backups += 1;
            if backups == 4 {
                panic!("pending transaction");
            }
        }
    });
    let _ = catch_unwind(AssertUnwindSafe(|| {
        f.vault
            .move_note(&a.id, &note.summary.id, &b.id, &note.summary.version)
    }));
    reset();
    let destination = f.vault.note_path(&b.id, &note.summary.id).unwrap();
    let published = fs::read(&destination).unwrap();
    fs::write(&destination, b"external text must survive").unwrap();
    assert_eq!(reopen(&mut f).unwrap_err().code, "move_recovery_required");
    assert_eq!(
        fs::read(&destination).unwrap(),
        b"external text must survive"
    );
    fs::write(&destination, published).unwrap();
    reopen(&mut f).unwrap();
    assert_eq!(saved(&f.vault.vaults_dir()), before);
}
