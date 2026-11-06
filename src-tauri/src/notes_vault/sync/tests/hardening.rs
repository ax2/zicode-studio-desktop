use super::*;

#[test]
fn interrupted_owner_write_preserves_preparation_without_blocking_notes() {
    let mut fixture = Fixture::new();
    let book = fixture.book();
    fixture.note(&book.id);
    let before = fixture.vault.capture_sync().unwrap();
    let tx = Uuid::new_v4().to_string();
    let stage = fixture.vault.vaults_dir().join(JOURNALS).join(&tx);
    fs::create_dir_all(&stage).unwrap();
    fs::write(stage.join("owner"), b"partial").unwrap();
    fs::write(
        stage.join("prepared-data"),
        b"keep even incomplete prepared data",
    )
    .unwrap();
    fixture.restart();
    assert_eq!(
        fixture.vault.capture_sync().unwrap().records,
        before.records
    );
    assert_eq!(
        fs::read(
            fixture
                .vault
                .vaults_dir()
                .join(ARCHIVES)
                .join(format!("prepared-{tx}"))
                .join("prepared-data")
        )
        .unwrap(),
        b"keep even incomplete prepared data"
    );
}

#[test]
fn unknown_notebook_metadata_is_rejected_without_discarding_fields() {
    let fixture = Fixture::new();
    let book = fixture.book();
    fixture.note(&book.id);
    fixture.vault.capture_sync().unwrap();
    let path = fixture.vault.vault_root(&book.id).unwrap().join(PARTS[0]);
    let mut metadata: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    metadata["futureData"] = json!({"retain":"this field"});
    let bytes = serde_json::to_vec(&metadata).unwrap();
    fs::write(&path, &bytes).unwrap();
    assert!(fixture.vault.capture_sync().is_err());
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn committed_recovery_preserves_a_new_external_edit() {
    let fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    fs::create_dir_all(fixture.vault.vault_root(&book.id).unwrap().join(".trash")).unwrap();
    let before = fixture.vault.capture_sync().unwrap();
    let mut desired = before.records.clone();
    let key = format!("note/{}/{}", book.id, note.summary.id);
    let mut saved: SavedNote = decode(&desired[&key]).unwrap();
    saved.markdown = saved.markdown.replace("不会改名", "remote change");
    desired.insert(key, encode(&saved).unwrap());
    assert!(fixture
        .vault
        .apply_sync_inner(
            &before.revision,
            &desired,
            transaction::Run {
                fail_at: Some(13),
                step: 0
            }
        )
        .is_err());
    // A committed journal keeps later legitimate edits; cleanup must not roll them back.
    let path = fixture.vault.note_path(&book.id, &note.summary.id).unwrap();
    let edited = fs::read_to_string(&path)
        .unwrap()
        .replace("remote change", "new external edit");
    fs::write(&path, edited.as_bytes()).unwrap();
    let captured = fixture.vault.capture_sync().unwrap();
    assert!(String::from_utf8(
        captured.records[&format!("note/{}/{}", book.id, note.summary.id)].clone()
    )
    .unwrap()
    .contains("new external edit"));
    assert_eq!(fs::read(path).unwrap(), edited.as_bytes());
}

#[test]
fn uncommitted_recovery_preserves_unexpected_edits_and_original_backup() {
    let fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    fs::create_dir_all(fixture.vault.vault_root(&book.id).unwrap().join(".trash")).unwrap();
    let before = fixture.vault.capture_sync().unwrap();
    let mut desired = before.records.clone();
    let key = format!("note/{}/{}", book.id, note.summary.id);
    let mut saved: SavedNote = decode(&desired[&key]).unwrap();
    saved.markdown = saved.markdown.replace("不会改名", "remote version");
    desired.insert(key, encode(&saved).unwrap());
    let error = fixture
        .vault
        .apply_sync_inner(
            &before.revision,
            &desired,
            transaction::Run {
                fail_at: Some(12),
                step: 0,
            },
        )
        .err()
        .unwrap();
    assert_eq!(error.code, "test_interruption");
    let path = fixture.vault.note_path(&book.id, &note.summary.id).unwrap();
    let edited = fs::read_to_string(&path)
        .unwrap()
        .replace("remote version", "keep external edit");
    fs::write(&path, edited.as_bytes()).unwrap();
    assert!(fixture.vault.capture_sync().is_err());
    let stage = fs::read_dir(fixture.vault.vaults_dir().join(JOURNALS))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        fs::read(
            stage
                .join("work")
                .join(&book.id)
                .join("src/content/notes")
                .join(format!("{}.md", note.summary.id))
        )
        .unwrap(),
        edited.as_bytes()
    );
    assert!(stage
        .join("old")
        .join(&book.id)
        .join("1")
        .join(format!("{}.md", note.summary.id))
        .is_file());
}

#[cfg(windows)]
#[test]
fn windows_junction_in_managed_attachments_is_not_followed() {
    use std::os::windows::process::CommandExt;
    let fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    fixture.vault.capture_sync().unwrap();
    // Use the managed root so the command-line junction utility stays below
    // MAX_PATH; Rust itself supports the longer UUID note/attachment paths.
    let link = fixture
        .vault
        .vault_root(&book.id)
        .unwrap()
        .join("public")
        .join("attachments");
    for target in [
        fixture.root.join("outside-vault"),
        fixture.vault.vaults_dir().join(".private-fixture"),
    ] {
        let directory = target.join(&note.summary.id);
        fs::create_dir_all(&directory).unwrap();
        let secret = directory.join(format!("{}.txt", Uuid::new_v4()));
        fs::write(&secret, b"outside data must stay here").unwrap();
        fs::remove_dir(&link).unwrap();
        let output = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(target.to_string_lossy().replace('/', "\\"))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Owned junction setup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(fixture.vault.capture_sync().is_err());
        fs::remove_dir(&link).unwrap();
        assert_eq!(fs::read(secret).unwrap(), b"outside data must stay here");
        fs::create_dir(&link).unwrap();
        fixture.vault.capture_sync().unwrap();
    }
}

#[test]
fn real_child_process_cannot_open_locked_notes_scope() {
    let fixture = Fixture::new();
    fixture.book();
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--ignored",
            "--exact",
            "notes_vault::sync::tests::hardening::locked_scope_probe_child",
            "--test-threads=1",
        ])
        .env("STUDIO_NOTES_SYNC_LOCK_PROBE", &fixture.root)
        .env("STUDIO_NOTES_SYNC_SCOPE_PROBE", &fixture.workspace_id);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "Owned lock probe failed: {}",
        String::from_utf8_lossy(&output.stdout)
    );
}

#[test]
#[ignore = "Only invoked by the owned subprocess lock test with a validated fixture path"]
fn locked_scope_probe_child() {
    let root = fs::canonicalize(
        std::env::var_os("STUDIO_NOTES_SYNC_LOCK_PROBE").expect("Owned fixture path required"),
    )
    .unwrap();
    let scratch = fs::canonicalize(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".cache/task-scratch/notes-vault-sync"),
    )
    .unwrap();
    assert_eq!(root.parent(), Some(scratch.as_path()));
    assert_eq!(
        fs::read(root.join("test-owner")).unwrap(),
        b"notes-vault-sync-test"
    );
    let vault = NotesVault::new(root.join("plugins")).unwrap();
    let scope =
        std::env::var("STUDIO_NOTES_SYNC_SCOPE_PROBE").expect("Owned fixture scope required");
    records::canonical_id(&scope).unwrap();
    assert_eq!(
        vault.scoped(&scope).err().unwrap().code,
        "notes_storage_busy"
    );
}
