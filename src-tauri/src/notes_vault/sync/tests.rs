use super::*;

struct Fixture {
    root: PathBuf,
    vault: NotesVault,
    workspace_id: String,
}
impl Fixture {
    fn new() -> Self {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".cache/task-scratch/notes-vault-sync");
        let root = scratch.join(Uuid::new_v4().to_string());
        fs::create_dir_all(root.join("plugins")).unwrap();
        fs::write(root.join("test-owner"), b"notes-vault-sync-test").unwrap();
        let workspace_id = Uuid::new_v4().to_string();
        let vault = NotesVault::new(root.join("plugins"))
            .unwrap()
            .scoped(&workspace_id)
            .unwrap();
        Self {
            root,
            vault,
            workspace_id,
        }
    }
    fn book(&self) -> NotebookDescriptor {
        self.vault
            .create_notebook("同步笔记本", Some("📒".into()), None)
            .unwrap()
    }
    fn note(&self, book: &str) -> NoteDocument {
        self.vault
            .create_note(
                book,
                "不会改名",
                "\n  保存缩进\n\n末尾空白  \n\n",
                vec!["tag".into()],
                None,
                None,
            )
            .unwrap()
    }
    fn restart(&mut self) {
        let base = NotesVault::new(self.root.join("plugins")).unwrap();
        let temporary = std::mem::replace(&mut self.vault, base.clone());
        drop(temporary);
        self.vault = base.scoped(&self.workspace_id).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.vault.storage_guard = None;
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".cache/task-scratch/notes-vault-sync");
        let resolved = fs::canonicalize(&self.root).ok();
        let boundary = fs::canonicalize(&scratch).ok();
        if resolved
            .as_ref()
            .zip(boundary.as_ref())
            .is_some_and(|(root, parent)| root.parent() == Some(parent.as_path()))
            && fs::read(self.root.join("test-owner")).ok().as_deref()
                == Some(b"notes-vault-sync-test")
        {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

fn transfer(source: &NotesVault, target: &NotesVault) -> SyncCapture {
    let saved = source.capture_sync().unwrap();
    let current = target.capture_sync().unwrap();
    target
        .apply_sync(&current.revision, &saved.records)
        .unwrap()
}

mod domain;
mod guards;
mod recovery;
mod transport;

mod hardening;
