use super::*;

struct Fixture {
    root: PathBuf,
    vault: NotesVault,
}
impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".cache/task-scratch/note-move")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(root.join("plugins")).unwrap();
        fs::write(root.join("test-owner"), b"note-move-test").unwrap();
        let workspace = Uuid::new_v4().to_string();
        let vault = NotesVault::new(root.join("plugins"))
            .unwrap()
            .scoped(&workspace)
            .unwrap();
        Self {
            root,
            vault,
        }
    }
    fn books(&self) -> (NotebookDescriptor, NotebookDescriptor) {
        (
            self.vault.create_notebook("Source", None, None).unwrap(),
            self.vault.create_notebook("Target", None, None).unwrap(),
        )
    }
    fn seeded(&self, book: &str) -> (NoteDocument, Vec<(String, Vec<u8>)>) {
        let note = self
            .vault
            .create_note(
                book,
                "带附件的笔记",
                "\n  保留缩进\n\n",
                vec!["keep".into()],
                None,
                None,
            )
            .unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let image = png.into_inner();
        let text = b"attachment\0\xff".to_vec();
        let a = self
            .vault
            .store_attachment(book, &note.summary.id, "image.png", "image/png", &image)
            .unwrap();
        let b = self
            .vault
            .store_attachment(book, &note.summary.id, "data.txt", "text/plain", &text)
            .unwrap();
        let content = format!("{}{}\n{}\n\n", note.content, a.markdown, b.markdown);
        let note = self
            .vault
            .save_note(
                book,
                &note.summary.id,
                &note.summary.title,
                &content,
                note.summary.tags,
                None,
                &note.summary.version,
            )
            .unwrap();
        (note, vec![(a.id, image), (b.id, text)])
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.vault.storage_guard = None;
        let boundary = fs::canonicalize(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join(".cache/task-scratch/note-move"),
        )
        .ok();
        let resolved = fs::canonicalize(&self.root).ok();
        if resolved
            .as_ref()
            .zip(boundary.as_ref())
            .is_some_and(|(root, parent)| root.parent() == Some(parent.as_path()))
            && fs::read(self.root.join("test-owner")).ok().as_deref() == Some(b"note-move-test")
        {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

#[test]
fn moving_a_note_keeps_original_image_and_text_attachments_accessible() {
    let fixture = Fixture::new();
    let (source, target) = fixture.books();
    let (note, files) = fixture.seeded(&source.id);
    let moved = fixture
        .vault
        .move_note(
            &source.id,
            &note.summary.id,
            &target.id,
            &note.summary.version,
        )
        .unwrap();
    assert_eq!(moved.summary.id, note.summary.id);
    assert_eq!(moved.content, note.content);
    assert!(fixture
        .vault
        .get_note(&source.id, &note.summary.id)
        .is_err());
    for (id, bytes) in files {
        assert_eq!(
            fixture
                .vault
                .read_attachment(&target.id, &note.summary.id, &id)
                .expect("The moved note must retain accessible attachments")
                .0,
            bytes
        );
    }
    assert!(!fixture
        .vault
        .vault_root(&source.id)
        .unwrap()
        .join("public/attachments")
        .join(&note.summary.id)
        .exists());
}

#[test]
fn target_attachment_collision_keeps_both_notebooks_unchanged() {
    let fixture = Fixture::new();
    let (source, target) = fixture.books();
    let (note, files) = fixture.seeded(&source.id);
    let directory = fixture
        .vault
        .vault_root(&target.id)
        .unwrap()
        .join("public/attachments")
        .join(&note.summary.id);
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("keep.txt"), b"existing target data").unwrap();
    assert!(fixture
        .vault
        .move_note(
            &source.id,
            &note.summary.id,
            &target.id,
            &note.summary.version
        )
        .is_err());
    assert_eq!(
        fixture
            .vault
            .get_note(&source.id, &note.summary.id)
            .unwrap()
            .summary
            .version,
        note.summary.version
    );
    assert!(fixture
        .vault
        .get_note(&target.id, &note.summary.id)
        .is_err());
    assert_eq!(
        fs::read(directory.join("keep.txt")).unwrap(),
        b"existing target data"
    );
    for (id, bytes) in files {
        assert_eq!(
            fixture
                .vault
                .read_attachment(&source.id, &note.summary.id, &id)
                .unwrap()
                .0,
            bytes
        );
    }
}

#[test]
fn stale_note_version_never_moves_text_or_attachments() {
    let fixture = Fixture::new();
    let (source, target) = fixture.books();
    let (note, files) = fixture.seeded(&source.id);
    assert_eq!(
        fixture
            .vault
            .move_note(&source.id, &note.summary.id, &target.id, "stale-version")
            .err()
            .unwrap()
            .code,
        "version_conflict"
    );
    assert_eq!(
        fixture
            .vault
            .get_note(&source.id, &note.summary.id)
            .unwrap()
            .summary
            .version,
        note.summary.version
    );
    for (id, bytes) in files {
        assert_eq!(
            fixture
                .vault
                .read_attachment(&source.id, &note.summary.id, &id)
                .unwrap()
                .0,
            bytes
        );
    }
}
