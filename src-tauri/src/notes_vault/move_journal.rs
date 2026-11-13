//! Durable, workspace-locked transaction for one note and its attachments.
//! Pending transactions roll back; committed transactions only discard backups.
//! The journal stores identities and hashes, never arbitrary destination paths.
mod storage;
#[cfg(test)]
mod tests;
use super::*;
use storage::Storage;

const JOURNALS: &str = ".note-moves";
const COUNT: usize = 7;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Book {
    id: String,
    deleted: bool,
}
impl Book {
    fn path(&self) -> PathBuf {
        if self.deleted {
            Path::new(".deleted").join(&self.id)
        } else {
            PathBuf::from(&self.id)
        }
    }
    fn capture(vault: &NotesVault, id: &str) -> Result<Self, NotesError> {
        let root = vault.vault_root(id)?;
        Ok(Self {
            id: validate_opaque_id(id)?,
            deleted: root.parent() == Some(vault.deleted_vaults_dir().as_path()),
        })
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    source: Book,
    target: Book,
    note: String,
    before: [Option<String>; COUNT],
    after: [Option<String>; COUNT],
}
impl Journal {
    fn validate(&self) -> Result<(), NotesError> {
        self.paths()?;
        for value in self.before.iter().chain(&self.after).flatten() {
            if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(recovery_error());
            }
        }
        if self.before[0].is_some()
            || self.before[1].is_some()
            || self.before[2].is_none()
            || self.after[1].is_none()
            || self.after[2].is_some()
            || self.after[6].is_some()
            || self.before[6] != self.after[0]
            || self.after[5].is_none()
            || [3, 4]
                .iter()
                .any(|&i| self.before[i].is_none() || self.after[i].is_none())
        {
            return Err(recovery_error());
        }
        Ok(())
    }
    fn paths(&self) -> Result<[PathBuf; COUNT], NotesError> {
        for id in [&self.source.id, &self.target.id, &self.note] {
            if !validate_opaque_id(id).is_ok_and(|value| value == *id) {
                return Err(recovery_error());
            }
        }
        if self.version != 1 || self.source.id == self.target.id {
            return Err(recovery_error());
        }
        let source = self.source.path();
        let target = self.target.path();
        let note = format!("{}.md", self.note);
        Ok([
            target.join("public/attachments").join(&self.note),
            target.join("src/content/notes").join(&note),
            source.join("src/content/notes").join(&note),
            target.join(".zicode/vault.json"),
            source.join(".zicode/vault.json"),
            PathBuf::from("changes.jsonl"),
            source.join("public/attachments").join(&self.note),
        ])
    }
}

fn recovery_error() -> NotesError {
    NotesError::new("move_recovery_required", "The note move could not recover safely. Keep the .note-moves directory, resolve storage access or external edits, then reopen Notes to retry.")
}

fn stage_path(id: &str, phase: &str) -> PathBuf {
    Path::new(JOURNALS).join(format!("{id}.{phase}"))
}

/// No Drop-based rollback: abrupt process termination and normal failures use
/// the same on-disk recovery path under the workspace's existing exclusive lock.
pub(super) fn apply(
    vault: &NotesVault,
    source: &str,
    target: &str,
    note: &str,
    changes: &[super::move_update::Change; 5],
) -> Result<(), NotesError> {
    let store = Storage::open(&vault.vaults_dir())?;
    let id = Uuid::new_v4().to_string();
    let preparing = stage_path(&id, "preparing");
    let result: Result<(), NotesError> = (|| {
        let journal = prepare(&store, vault, source, target, note, changes, &preparing)?;
        let pending = stage_path(&id, "pending");
        store.rename(&preparing, &pending)?;
        checkpoint("pending");
        install(&store, &pending, &journal)?;
        let committed = stage_path(&id, "committed");
        store.rename(&pending, &committed)?;
        checkpoint("committed");
        // The durable commit already succeeded. Cleanup can be retried on open;
        // do not report a failed move merely because backup cleanup is locked.
        let _ = finish(&store, &committed, &id);
        Ok(())
    })();
    if let Err(error) = result {
        recover(&vault.vaults_dir())?;
        return Err(if error.code == "move_recovery_required" {
            NotesError::new(
                "storage_unavailable",
                "The note move did not finish; its original data was restored",
            )
        } else {
            error
        });
    }
    Ok(())
}

fn prepare(
    store: &Storage,
    vault: &NotesVault,
    source: &str,
    target: &str,
    note: &str,
    changes: &[super::move_update::Change; 5],
    stage: &Path,
) -> Result<Journal, NotesError> {
    let mut journal = Journal {
        version: 1,
        source: Book::capture(vault, source)?,
        target: Book::capture(vault, target)?,
        note: note.to_string(),
        before: Default::default(),
        after: Default::default(),
    };
    let paths = journal.paths()?;
    if store.exists(&paths[0])? || store.exists(&paths[1])? {
        return Err(NotesError::new(
            "conflict",
            "Note or attachments already exist in the target notebook",
        ));
    }
    store.mkdir(stage)?;
    checkpoint("preparing");
    for (index, path) in paths.iter().enumerate() {
        journal.before[index] = store.hash(path)?;
    }
    for (index, change) in changes.iter().enumerate() {
        let slot = index + 1;
        if vault.vaults_dir().join(&paths[slot]) != change.path {
            return Err(recovery_error());
        }
        let actual = if store.exists(&paths[slot])? {
            Some(store.read(&paths[slot])?)
        } else {
            None
        };
        if actual != change.before {
            return Err(NotesError::new(
                "version_conflict",
                "Saved data changed while preparing the note move",
            ));
        }
        if let Some(bytes) = &change.after {
            store.write_new(&stage.join("new").join(slot.to_string()), bytes)?;
        }
    }
    if journal.before[6].is_some() {
        let destination = stage.join("new/0");
        store.mkdir(&destination)?;
        for name in store.list(&paths[6])? {
            validate_attachment_id(&name)?;
            let bytes = store.read(&paths[6].join(&name))?;
            if bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(recovery_error());
            }
            store.write_new(&destination.join(&name), &bytes)?;
            checkpoint("attachment");
        }
        if store.hash(&destination)? != journal.before[6] {
            return Err(recovery_error());
        }
    }
    for index in 0..COUNT {
        journal.after[index] = store.hash(&stage.join("new").join(index.to_string()))?;
    }
    let bytes = serde_json::to_vec(&journal).map_err(|_| recovery_error())?;
    store.write_new(&stage.join("manifest.json"), &bytes)?;
    // Prove cleanup remains bounded before publishing the transaction.
    store.hash(stage)?;
    Ok(journal)
}

fn install(store: &Storage, stage: &Path, journal: &Journal) -> Result<(), NotesError> {
    let paths = journal.paths()?;
    for (index, path) in paths.iter().enumerate() {
        if store.hash(path)? != journal.before[index] {
            return Err(recovery_error());
        }
        if journal.before[index] == journal.after[index] {
            continue;
        }
        if journal.before[index].is_some() {
            store.rename(path, &stage.join("old").join(index.to_string()))?;
            checkpoint("backup");
        }
        if journal.after[index].is_some() {
            store.rename(&stage.join("new").join(index.to_string()), path)?;
            checkpoint("publish");
        }
    }
    for (index, path) in paths.iter().enumerate() {
        if store.hash(path)? != journal.after[index] {
            return Err(recovery_error());
        }
        let backup = store.hash(&stage.join("old").join(index.to_string()))?;
        if journal.before[index] != journal.after[index] && backup != journal.before[index] {
            return Err(recovery_error());
        }
    }
    Ok(())
}

fn rollback(store: &Storage, stage: &Path, journal: &Journal) -> Result<(), NotesError> {
    for (index, path) in journal.paths()?.iter().enumerate().rev() {
        let old = stage.join("old").join(index.to_string());
        let backup = store.hash(&old)?;
        let current = store.hash(path)?;
        if backup.is_some() {
            if backup != journal.before[index]
                || (current.is_some()
                    && current != journal.after[index]
                    && current != journal.before[index])
            {
                return Err(recovery_error());
            }
            if current != journal.before[index] {
                // Move the new value back into its staging slot so rollback
                // itself can be interrupted without partial directory deletion.
                if current.is_some() {
                    store.rename(path, &stage.join("new").join(index.to_string()))?;
                }
                checkpoint("rollback-remove");
                store.rename(&old, path)?;
                checkpoint("rollback-restore");
            }
        } else if current != journal.before[index] {
            if journal.before[index].is_some() || current != journal.after[index] {
                return Err(recovery_error());
            }
            store.rename(path, &stage.join("new").join(index.to_string()))?;
            checkpoint("rollback-remove");
        }
    }
    Ok(())
}

fn finish(store: &Storage, stage: &Path, id: &str) -> Result<(), NotesError> {
    let done = stage_path(id, "done");
    store.rename(stage, &done)?;
    checkpoint("done");
    discard(store, &done, false)
}

fn discard(store: &Storage, stage: &Path, preparing: bool) -> Result<(), NotesError> {
    // These are reserved staging directories, but still preserve unexpected
    // contents rather than recursively deleting an arbitrary user directory.
    for name in store.list(stage)? {
        match name.as_str() {
            "manifest.json" => {
                if store.read(&stage.join(name))?.len() > 64 * 1024 {
                    return Err(recovery_error());
                }
            }
            "new" | "old" => {
                if preparing && name == "old" {
                    return Err(recovery_error());
                }
                let group = stage.join(&name);
                for index in store.list(&group)? {
                    let slot: usize = index.parse().map_err(|_| recovery_error())?;
                    if slot >= COUNT || index != slot.to_string() {
                        return Err(recovery_error());
                    }
                    let path = group.join(index);
                    if slot == 0 || slot == 6 {
                        for attachment in store.list(&path)? {
                            validate_attachment_id(&attachment).map_err(|_| recovery_error())?;
                            if store.read(&path.join(attachment))?.len() > MAX_ATTACHMENT_BYTES {
                                return Err(recovery_error());
                            }
                        }
                    } else {
                        store.read(&path)?;
                    }
                }
            }
            _ => return Err(recovery_error()),
        }
    }
    store.remove(stage)
}

pub(super) fn recover(root: &Path) -> Result<(), NotesError> {
    let store = Storage::open(root)?;
    if !store.exists(Path::new(JOURNALS))? {
        return Ok(());
    }
    let entries = store.list(Path::new(JOURNALS))?;
    // A locked workspace can have only one unfinished move. Never guess an
    // ordering for multiple pending journals or overlapping external edits.
    if entries
        .iter()
        .filter(|name| name.ends_with(".pending") || name.ends_with(".committed"))
        .count()
        > 1
    {
        return Err(recovery_error());
    }
    for entry in entries {
        let (id, phase) = entry.rsplit_once('.').ok_or_else(recovery_error)?;
        if !validate_opaque_id(id).is_ok_and(|value| value == id) {
            return Err(recovery_error());
        }
        let stage = stage_path(id, phase);
        match phase {
            "preparing" | "done" => discard(&store, &stage, phase == "preparing")?,
            "pending" | "committed" => {
                let bytes = store.read(&stage.join("manifest.json"))?;
                if bytes.len() > 64 * 1024 {
                    return Err(recovery_error());
                }
                let journal: Journal =
                    serde_json::from_slice(&bytes).map_err(|_| recovery_error())?;
                journal.validate()?;
                let paths = journal.paths()?;
                if phase == "pending" {
                    rollback(&store, &stage, &journal)?;
                } else {
                    for (index, path) in paths.iter().enumerate() {
                        if store.hash(path)? != journal.after[index] {
                            return Err(recovery_error());
                        }
                    }
                }
                finish(&store, &stage, id)?;
            }
            _ => return Err(recovery_error()),
        }
    }
    Ok(())
}

#[cfg(not(test))]
fn checkpoint(_: &str) {}
#[cfg(test)]
fn checkpoint(name: &str) {
    tests::checkpoint(name);
}
