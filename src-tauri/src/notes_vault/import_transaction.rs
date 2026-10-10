use super::*;
use fs2::FileExt;
use std::fs::File;
use std::sync::Arc;

const IMPORTS: &str = ".imports";
const OWNER: &str = ".zicode/import-owner";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    notebook_ids: Vec<String>,
}

fn unavailable(message: &str) -> NotesError {
    NotesError::new("storage_unavailable", message)
}

fn recovery_error() -> NotesError {
    NotesError::new("import_recovery_required", "Notes import recovery could not finish. Keep the .imports directory and retry after resolving storage access.")
}

fn regular_directory(path: &Path) -> Result<(), NotesError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| recovery_error())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(recovery_error());
    }
    Ok(())
}

pub(super) fn lock_storage(root: &Path) -> Result<Arc<File>, NotesError> {
    let lock = root.join(".notes.lock");
    if fs::symlink_metadata(&lock)
        .is_ok_and(|metadata| !metadata.is_file() || metadata.file_type().is_symlink())
    {
        return Err(unavailable("Notes lock file is invalid"));
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock)
        .map_err(|_| unavailable("Cannot open Notes storage lock"))?;
    FileExt::try_lock_exclusive(&file).map_err(|error| {
        if error.kind() == std::io::ErrorKind::WouldBlock {
            NotesError::new(
                "notes_storage_busy",
                "Another process is using this Notes workspace. Try again shortly.",
            )
        } else {
            unavailable("Cannot lock Notes storage")
        }
    })?;
    // Keep the inode; removing a lock file would let another process lock a replacement.
    Ok(Arc::new(file))
}

fn sync_directory(path: &Path) -> Result<(), NotesError> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|_| unavailable("Cannot sync Notes directory"))?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn durable_file(path: &Path, bytes: &[u8]) -> Result<(), NotesError> {
    let temporary = path.with_extension("pending");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| unavailable("Cannot prepare Notes import record"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| unavailable("Cannot persist Notes import record"))?;
    drop(file);
    fs::rename(&temporary, path).map_err(|_| unavailable("Cannot publish Notes import record"))?;
    sync_directory(path.parent().ok_or_else(recovery_error)?)
}

fn sync_tree(path: &Path) -> Result<(), NotesError> {
    regular_directory(path)?;
    for entry in fs::read_dir(path).map_err(|_| recovery_error())? {
        let entry = entry.map_err(|_| recovery_error())?;
        let kind = entry.file_type().map_err(|_| recovery_error())?;
        if kind.is_symlink() {
            return Err(recovery_error());
        }
        if kind.is_dir() {
            sync_tree(&entry.path())?;
        } else if kind.is_file() {
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(entry.path())
                .and_then(|file| file.sync_all())
                .map_err(|_| unavailable("Cannot sync imported Notes content"))?;
        } else {
            return Err(recovery_error());
        }
    }
    sync_directory(path)
}

fn remove_stage(stage: &Path, imports: &Path) -> Result<(), NotesError> {
    regular_directory(imports)?;
    regular_directory(stage)?;
    let canonical = fs::canonicalize(stage).map_err(|_| recovery_error())?;
    let parent = fs::canonicalize(imports).map_err(|_| recovery_error())?;
    if canonical.parent() != Some(parent.as_path()) {
        return Err(recovery_error());
    }
    fs::remove_dir_all(canonical).map_err(|_| recovery_error())?;
    sync_directory(imports)
}

fn read_manifest(stage: &Path) -> Result<Option<Manifest>, NotesError> {
    let path = stage.join("manifest.json");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(recovery_error()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 65536 {
        return Err(recovery_error());
    }
    let manifest: Manifest = serde_json::from_slice(&fs::read(path).map_err(|_| recovery_error())?)
        .map_err(|_| recovery_error())?;
    let mut ids = BTreeSet::new();
    if manifest.version != 1
        || manifest.notebook_ids.len() > MAX_NOTEBOOKS
        || manifest
            .notebook_ids
            .iter()
            .any(|id| Uuid::parse_str(id).is_err() || !ids.insert(id))
    {
        return Err(recovery_error());
    }
    Ok(Some(manifest))
}

fn recover_stage(root: &Path, stage: &Path) -> Result<(), NotesError> {
    regular_directory(stage)?;
    let transaction = stage
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(recovery_error)?;
    let manifest = read_manifest(stage)?;
    let committed = stage.join("committed");
    match fs::symlink_metadata(&committed) {
        Ok(metadata) => {
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != 10
                || fs::read(&committed).map_err(|_| recovery_error())? != b"committed\n"
            {
                return Err(recovery_error());
            }
            if manifest.is_none() {
                return Err(recovery_error());
            }
            return remove_stage(stage, &root.join(IMPORTS));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(recovery_error()),
    }
    if let Some(manifest) = manifest {
        regular_directory(&stage.join("data"))?;
        for id in manifest.notebook_ids {
            let published = root.join(&id);
            match fs::symlink_metadata(&published) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err(recovery_error()),
                Ok(_) => regular_directory(&published)?,
            }
            // Recovery can only reclaim directories with this transaction's ownership marker.
            let owner = published.join(OWNER);
            let metadata = fs::symlink_metadata(&owner).map_err(|_| recovery_error())?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != transaction.len() as u64
                || fs::read_to_string(&owner).map_err(|_| recovery_error())? != transaction
            {
                return Err(recovery_error());
            }
            let destination = stage.join("data").join(id);
            if destination.try_exists().map_err(|_| recovery_error())? {
                return Err(recovery_error());
            }
            fs::rename(published, destination).map_err(|_| recovery_error())?;
        }
        sync_directory(root)?;
        sync_directory(&stage.join("data"))?;
    }
    remove_stage(stage, &root.join(IMPORTS))
}

pub(super) fn recover(root: &Path) -> Result<(), NotesError> {
    let imports = root.join(IMPORTS);
    match fs::symlink_metadata(&imports) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(recovery_error()),
        Ok(_) => regular_directory(&imports)?,
    }
    for (index, entry) in fs::read_dir(&imports)
        .map_err(|_| recovery_error())?
        .enumerate()
    {
        let entry = entry.map_err(|_| recovery_error())?;
        if index >= MAX_NOTEBOOKS
            || entry
                .file_name()
                .to_str()
                .is_none_or(|name| Uuid::parse_str(name).is_err())
        {
            return Err(recovery_error());
        }
        recover_stage(root, &entry.path())?;
    }
    Ok(())
}

impl NotesVault {
    pub fn import_export(&self, export: VaultExport) -> Result<NotebookDescriptor, NotesError> {
        self.import_batch(vec![export], false)?
            .pop()
            .ok_or_else(recovery_error)
    }

    pub fn import_all_export(
        &self,
        bundle: VaultExportBundle,
    ) -> Result<Vec<NotebookDescriptor>, NotesError> {
        if bundle.schema_version != 1 {
            return Err(NotesError::new(
                "invalid_parameters",
                "Unsupported Notes workspace backup schema version",
            ));
        }
        self.import_batch(bundle.notebooks, true)
    }

    fn import_batch(
        &self,
        exports: Vec<VaultExport>,
        restore_hierarchy: bool,
    ) -> Result<Vec<NotebookDescriptor>, NotesError> {
        let root = self.vaults_dir();
        fs::create_dir_all(&root).map_err(|_| unavailable("Notes storage is unavailable"))?;
        let _guard = match &self.storage_guard {
            Some(guard) => guard.clone(),
            None => lock_storage(&root)?,
        };
        recover(&root)?;
        if exports.len().saturating_add(self.list_notebooks()?.len()) > MAX_NOTEBOOKS {
            return Err(NotesError::new(
                "quota_exceeded",
                "The maximum number of notebooks has been reached",
            ));
        }
        if exports.is_empty() {
            return Ok(Vec::new());
        }
        let mut parents = HashMap::new();
        for export in &exports {
            validate_opaque_id(&export.notebook.id)?;
            if parents
                .insert(
                    export.notebook.id.clone(),
                    export.notebook.parent_id.clone(),
                )
                .is_some()
            {
                return Err(NotesError::new(
                    "invalid_parameters",
                    "Notes backup contains duplicate notebook IDs",
                ));
            }
        }
        if restore_hierarchy {
            for id in parents.keys() {
                let mut seen = BTreeSet::new();
                let mut cursor = Some(id);
                while let Some(current) = cursor {
                    if !seen.insert(current) {
                        return Err(NotesError::new(
                            "invalid_parameters",
                            "Notes backup notebook hierarchy contains a cycle",
                        ));
                    }
                    cursor = parents
                        .get(current)
                        .ok_or_else(|| {
                            NotesError::new(
                                "invalid_parameters",
                                "Notes backup references a missing parent notebook",
                            )
                        })?
                        .as_ref();
                }
            }
        }
        let known_references = exports
            .iter()
            .flat_map(|export| {
                export
                    .notes
                    .iter()
                    .chain(export.trashed_notes.iter().map(|trash| &trash.note))
                    .map(|note| {
                        (
                            export.notebook.id.to_ascii_lowercase(),
                            note.summary.id.to_ascii_lowercase(),
                        )
                    })
            })
            .collect::<BTreeSet<_>>();
        let imports = root.join(IMPORTS);
        fs::create_dir_all(&imports).map_err(|_| recovery_error())?;
        regular_directory(&imports)?;
        let transaction = Uuid::new_v4().to_string();
        let stage = imports.join(&transaction);
        fs::create_dir(&stage).map_err(|_| recovery_error())?;
        let result = (|| {
            let data = stage.join("data");
            fs::create_dir(&data).map_err(|_| recovery_error())?;
            let staged = NotesVault {
                storage_dir: Some(data.clone()),
                storage_guard: None,
                ..self.clone()
            };
            let mut imported = Vec::new();
            let mut mapping = HashMap::new();
            for export in exports {
                let old_id = export.notebook.id.clone();
                let notebook = staged.import_one_staged(export)?;
                durable_file(&data.join(&notebook.id).join(OWNER), transaction.as_bytes())?;
                mapping.insert(old_id, notebook.id.clone());
                imported.push(notebook);
            }
            if restore_hierarchy {
                for (old_id, parent) in &parents {
                    if let Some(parent) = parent {
                        let updated = staged.update_notebook(
                            &mapping[old_id],
                            None,
                            None,
                            Some(mapping[parent].clone()),
                        )?;
                        if let Some(notebook) = imported
                            .iter_mut()
                            .find(|notebook| notebook.id == updated.id)
                        {
                            notebook.parent_id = updated.parent_id;
                            notebook.updated_at = updated.updated_at;
                        }
                    }
                }
            }
            let reference_mapping = mapping
                .iter()
                .map(|(old, new)| (old.to_ascii_lowercase(), new.clone()))
                .collect();
            super::import_references::rewrite_staged(
                &staged,
                &reference_mapping,
                &known_references,
            )?;
            sync_tree(&data)?;
            let manifest = Manifest {
                version: 1,
                notebook_ids: imported
                    .iter()
                    .map(|notebook| notebook.id.clone())
                    .collect(),
            };
            durable_file(
                &stage.join("manifest.json"),
                &serde_json::to_vec(&manifest).map_err(|_| recovery_error())?,
            )?;
            sync_directory(&imports)?;
            for notebook in &imported {
                let destination = root.join(&notebook.id);
                if fs::symlink_metadata(&destination).is_ok() {
                    return Err(NotesError::new(
                        "conflict",
                        "Notebook directory already exists",
                    ));
                }
                fs::rename(data.join(&notebook.id), destination)
                    .map_err(|_| unavailable("Cannot publish imported notebook"))?;
            }
            sync_directory(&root)?;
            if let Err(error) = durable_file(&stage.join("committed"), b"committed\n") {
                // The rename may have succeeded before directory sync failed. Once the
                // commit marker is visible, report the committed batch instead of
                // returning an error that invites a duplicate retry.
                if fs::read(stage.join("committed")).ok().as_deref() != Some(b"committed\n") {
                    return Err(error);
                }
            }
            Ok(imported)
        })();
        match result {
            Ok(imported) => {
                // A committed transaction is complete even if housekeeping must wait until next access.
                let _ = recover_stage(&root, &stage);
                Ok(imported)
            }
            Err(error) => {
                recover_stage(&root, &stage)?;
                Err(error)
            }
        }
    }
}
