use super::*;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    id: String,
    old_deleted: Option<bool>,
    new_deleted: Option<bool>,
    old_parts: [Option<String>; 4],
    new_parts: [Option<String>; 4],
    new_full: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    transaction: String,
    plans: Vec<Plan>,
}

pub(super) struct Run {
    #[cfg(test)]
    pub(super) fail_at: Option<usize>,
    pub(super) step: usize,
}

impl Run {
    fn tick(&mut self) -> Result<(), NotesError> {
        self.step += 1;
        #[cfg(test)]
        if self.fail_at == Some(self.step) {
            return Err(NotesError::new(
                "test_interruption",
                "Simulated process interruption",
            ));
        }
        Ok(())
    }
}

impl NotesVault {
    pub fn apply_sync(
        &self,
        expected_revision: &str,
        desired: &RecordMap,
    ) -> Result<SyncCapture, NotesError> {
        self.apply_sync_inner(
            expected_revision,
            desired,
            Run {
                #[cfg(test)]
                fail_at: None,
                step: 0,
            },
        )
    }

    pub(super) fn apply_sync_inner(
        &self,
        expected_revision: &str,
        desired: &RecordMap,
        mut run: Run,
    ) -> Result<SyncCapture, NotesError> {
        let current = self.capture_sync()?;
        if current.revision != expected_revision {
            return Err(NotesError::new("sync_local_changed", "Saved Notes changed during synchronization. Read the latest local version before applying."));
        }
        if current.records == *desired {
            return Ok(current);
        }
        let store = Storage::open(&self.vaults_dir())?;
        recover(&store)?;
        let transaction = Uuid::new_v4().to_string();
        let stage = Path::new(JOURNALS).join(&transaction);
        store.write_new(&stage.join("owner"), transaction.as_bytes())?;
        let prepared = prepare(&store, &stage, &transaction, desired, &current.records);
        let journal = match prepared {
            Ok(journal) => journal,
            Err(error) => {
                recover(&store)?;
                return Err(error);
            }
        };
        if snapshot::capture(&store)?.revision != current.revision {
            recover(&store)?;
            return Err(NotesError::new(
                "sync_local_changed",
                "Saved Notes changed while synchronization was being prepared",
            ));
        }
        let manifest = encode(&journal)?;
        if manifest.len() > crate::notes_sync::MAX_OBJECT_BYTES {
            recover(&store)?;
            return Err(invalid());
        }
        store.write_new(&stage.join("manifest.json"), &manifest)?;
        run.tick()?;
        for plan in &journal.plans {
            install(&store, &stage, &transaction, plan, &mut run)?;
        }
        verify_backups(&store, &stage, &journal)?;
        // Verify the actual saved projection before making the commit durable.
        if snapshot::capture(&store)?.records != *desired {
            return Err(recovery_error());
        }
        store.write_new(&stage.join("committed"), hash(&manifest).as_bytes())?;
        run.tick()?;
        finish(&store, &stage, &journal)?;
        snapshot::capture(&store)
    }
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn prepare(
    store: &Storage,
    stage: &Path,
    transaction: &str,
    desired: &RecordMap,
    current: &RecordMap,
) -> Result<Journal, NotesError> {
    let old_books = records::books(current)?;
    let new_books = records::prepare(store, &stage.join("incoming"), desired, current)?;
    let ids: BTreeSet<String> = old_books.keys().chain(new_books.keys()).cloned().collect();
    if ids.len() > crate::notes_sync::MAX_RECORDS {
        return Err(invalid());
    }
    let mut plans = Vec::new();
    for id in ids {
        let old = old_books.get(&id);
        let new = new_books.get(&id);
        let mut plan = Plan {
            id: id.clone(),
            old_deleted: old.map(|b| b.deleted),
            new_deleted: new.map(|b| b.deleted),
            old_parts: Default::default(),
            new_parts: Default::default(),
            new_full: None,
        };
        if let Some(old) = old {
            let source = records::location(&id, old.deleted);
            if store.exists(&source.join(OWNER))? {
                return Err(recovery_error());
            }
            for (index, part) in PARTS.iter().enumerate() {
                let path = source.join(part);
                if store.exists(&path)? {
                    plan.old_parts[index] = Some(store.tree_hash(&path)?);
                }
            }
        }
        if let Some(new) = new {
            let incoming = stage.join("incoming").join(&id);
            for (index, part) in PARTS.iter().enumerate() {
                plan.new_parts[index] = Some(store.tree_hash(&incoming.join(part))?);
            }
            if old.is_none() {
                let full = stage.join("new").join(&id);
                store.mkdir(full.parent().ok_or_else(invalid)?)?;
                let descriptor = NotebookDescriptor {
                    id: id.clone(),
                    workspace_id: String::new(),
                    title: new.title.clone(),
                    icon: new.icon.clone(),
                    parent_id: new.parent_id.clone(),
                    created_at: new.created_at.clone(),
                    updated_at: new.created_at.clone(),
                    note_count: 0,
                };
                create_astro_vault(&store.root.join(&full), &descriptor)?;
                // Replace scaffold's empty managed parts with validated saved data.
                for part in PARTS {
                    let target = full.join(part);
                    if store.exists(&target)? {
                        remove_entry(store, &target)?;
                    }
                    store.rename(&incoming.join(part), &target)?;
                }
                store.write_new(&full.join(OWNER), transaction.as_bytes())?;
                plan.new_full = Some(store.tree_hash(&full)?);
            }
        }
        // Unchanged notebooks keep their directories and all local side data untouched.
        if plan.old_deleted != plan.new_deleted || plan.old_parts != plan.new_parts {
            plans.push(plan);
        }
    }
    Ok(Journal {
        version: 1,
        transaction: transaction.to_string(),
        plans,
    })
}

fn install(
    store: &Storage,
    stage: &Path,
    transaction: &str,
    plan: &Plan,
    run: &mut Run,
) -> Result<(), NotesError> {
    let work = stage.join("work").join(&plan.id);
    if let Some(deleted) = plan.old_deleted {
        let source = records::location(&plan.id, deleted);
        store.write_new(&source.join(OWNER), transaction.as_bytes())?;
        run.tick()?;
        store.rename(&source, &work)?;
        // The move freezes the original namespace. Detect path-based external
        // edits before replacing any of this notebook's managed parts.
        for (index, part) in PARTS.iter().enumerate() {
            let path = work.join(part);
            let actual = if store.exists(&path)? {
                Some(store.tree_hash(&path)?)
            } else {
                None
            };
            if actual != plan.old_parts[index] {
                store.rename(&work, &source)?;
                store.remove_file(&source.join(OWNER))?;
                return Err(NotesError::new(
                    "sync_local_changed",
                    "Saved Notes changed before synchronization could apply",
                ));
            }
        }
        run.tick()?;
        if plan.new_deleted.is_some() {
            for (index, part) in PARTS.iter().enumerate() {
                let target = work.join(part);
                if plan.old_parts[index].is_some() {
                    store.rename(
                        &target,
                        &stage.join("old").join(&plan.id).join(index.to_string()),
                    )?;
                    run.tick()?;
                }
                store.rename(&stage.join("incoming").join(&plan.id).join(part), &target)?;
                run.tick()?;
            }
        }
    } else {
        store.rename(&stage.join("new").join(&plan.id), &work)?;
        run.tick()?;
    }
    if let Some(deleted) = plan.new_deleted {
        store.rename(&work, &records::location(&plan.id, deleted))?;
        run.tick()?;
    }
    Ok(())
}

fn owned(store: &Storage, path: &Path, transaction: &str) -> Result<bool, NotesError> {
    if !store.exists(path)? {
        return Ok(false);
    }
    store.directory(path)?;
    let marker = path.join(OWNER);
    if !store.exists(&marker)? {
        return Ok(false);
    }
    if store.read(&marker, 36)? != transaction.as_bytes() {
        return Err(recovery_error());
    }
    Ok(true)
}

fn remove_entry(store: &Storage, path: &Path) -> Result<(), NotesError> {
    if store.directory(path).is_ok() {
        store.remove_tree(path)
    } else {
        store.remove_file(path)
    }
}

fn rollback(store: &Storage, stage: &Path, journal: &Journal) -> Result<(), NotesError> {
    for plan in journal.plans.iter().rev() {
        let work = stage.join("work").join(&plan.id);
        if !owned(store, &work, &journal.transaction)? {
            let mut found = None;
            for deleted in [plan.new_deleted, plan.old_deleted].into_iter().flatten() {
                let candidate = records::location(&plan.id, deleted);
                if owned(store, &candidate, &journal.transaction)? {
                    found = Some(candidate);
                    break;
                }
            }
            if let Some(source) = found {
                store.rename(&source, &work)?;
            } else {
                if store.exists(&work)? || store.exists(&stage.join("old").join(&plan.id))? {
                    return Err(recovery_error());
                }
                continue;
            }
        }
        if plan.old_deleted.is_none() {
            if store.tree_hash(&work)? != *plan.new_full.as_ref().ok_or_else(recovery_error)? {
                return Err(recovery_error());
            }
            store.remove_tree(&work)?;
            continue;
        }
        if plan.new_deleted.is_some() {
            for (index, part) in PARTS.iter().enumerate().rev() {
                let target = work.join(part);
                let backup = stage.join("old").join(&plan.id).join(index.to_string());
                if store.exists(&backup)? {
                    if Some(store.tree_hash(&backup)?) != plan.old_parts[index] {
                        return Err(recovery_error());
                    }
                    if store.exists(&target)? {
                        if Some(store.tree_hash(&target)?) != plan.new_parts[index] {
                            return Err(recovery_error());
                        }
                        remove_entry(store, &target)?;
                    }
                    store.rename(&backup, &target)?;
                } else if let Some(old_hash) = &plan.old_parts[index] {
                    if !store.exists(&target)? || store.tree_hash(&target)? != *old_hash {
                        return Err(recovery_error());
                    }
                } else if store.exists(&target)? {
                    if Some(store.tree_hash(&target)?) != plan.new_parts[index] {
                        return Err(recovery_error());
                    }
                    remove_entry(store, &target)?;
                }
            }
        }
        let destination = records::location(&plan.id, plan.old_deleted.ok_or_else(recovery_error)?);
        store.rename(&work, &destination)?;
        store.remove_file(&destination.join(OWNER))?;
    }
    Ok(())
}

fn finish(store: &Storage, stage: &Path, journal: &Journal) -> Result<(), NotesError> {
    for plan in &journal.plans {
        let destination = if let Some(deleted) = plan.new_deleted {
            records::location(&plan.id, deleted)
        } else {
            let archive = Path::new(ARCHIVES).join(&journal.transaction);
            if !store.exists(&archive.join("owner"))? {
                store.write_new(&archive.join("owner"), journal.transaction.as_bytes())?;
            }
            if store.read(&archive.join("owner"), 36)? != journal.transaction.as_bytes() {
                return Err(recovery_error());
            }
            let destination = archive.join(&plan.id);
            let work = stage.join("work").join(&plan.id);
            if store.exists(&work)? {
                if !owned(store, &work, &journal.transaction)? {
                    return Err(recovery_error());
                }
                store.rename(&work, &destination)?;
            }
            destination
        };
        if !store.exists(&destination)? {
            return Err(recovery_error());
        }
        let marker = destination.join(OWNER);
        if store.exists(&marker)? {
            if !owned(store, &destination, &journal.transaction)? {
                return Err(recovery_error());
            }
            store.remove_file(&marker)?;
        }
    }
    // No notebook directory (including unmanaged files/links) may remain in the journal.
    let work = stage.join("work");
    if store.exists(&work)? && !store.list(&work)?.is_empty() {
        return Err(recovery_error());
    }
    retire(store, stage, &journal.transaction)
}

pub(super) fn recover(store: &Storage) -> Result<(), NotesError> {
    let root = Path::new(JOURNALS);
    if !store.exists(root)? {
        return Ok(());
    }
    let stages = store.list(root)?;
    if stages.len() > MAX_NOTEBOOKS {
        return Err(recovery_error());
    }
    for transaction in stages {
        records::canonical_id(&transaction)?;
        let stage = root.join(&transaction);
        if store.read(&stage.join("owner"), 36).ok().as_deref() != Some(transaction.as_bytes()) {
            // Preparation cannot touch live notebooks until the owner and
            // manifest are durable. Preserve an interrupted preparation.
            if !store.exists(&stage.join("manifest.json"))?
                && !store.exists(&stage.join("work"))?
                && !store.exists(&stage.join("old"))?
            {
                store.rename(
                    &stage,
                    &Path::new(ARCHIVES).join(format!("prepared-{transaction}")),
                )?;
                continue;
            }
            return Err(recovery_error());
        }
        if !store.exists(&stage.join("manifest.json"))? {
            if store.exists(&stage.join("work"))? && !store.list(&stage.join("work"))?.is_empty() {
                return Err(recovery_error());
            }
            if store.exists(&stage.join("old"))? {
                return Err(recovery_error());
            }
            retire(store, &stage, &transaction)?;
            continue;
        }
        let bytes = store.read(
            &stage.join("manifest.json"),
            crate::notes_sync::MAX_OBJECT_BYTES,
        )?;
        let journal: Journal = decode(&bytes)?;
        if journal.version != 1
            || journal.transaction != transaction
            || journal.plans.len() > crate::notes_sync::MAX_RECORDS
        {
            return Err(recovery_error());
        }
        let mut ids = BTreeSet::new();
        for plan in &journal.plans {
            records::canonical_id(&plan.id)?;
            if !ids.insert(&plan.id) || (plan.old_deleted.is_none() && plan.new_deleted.is_none()) {
                return Err(recovery_error());
            }
            for digest in plan
                .old_parts
                .iter()
                .chain(&plan.new_parts)
                .chain(std::iter::once(&plan.new_full))
                .flatten()
            {
                if digest.len() != 64
                    || !digest
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                {
                    return Err(recovery_error());
                }
            }
            if plan.new_deleted.is_some() && plan.new_parts.iter().any(Option::is_none)
                || (plan.old_deleted.is_none() && plan.new_full.is_none())
            {
                return Err(recovery_error());
            }
        }
        if store.exists(&stage.join("committed"))? {
            if store.read(&stage.join("committed"), 64)? != hash(&bytes).as_bytes() {
                return Err(recovery_error());
            }
            finish(store, &stage, &journal)?;
        } else {
            rollback(store, &stage, &journal)?;
            retire(store, &stage, &transaction)?;
        }
    }
    Ok(())
}

fn retire(store: &Storage, stage: &Path, transaction: &str) -> Result<(), NotesError> {
    let discarded = Path::new(".sync-discarded").join(transaction);
    store.rename(stage, &discarded)?;
    store.remove_tree(&discarded).map_err(|_| {
        NotesError::new(
            "sync_cleanup_pending",
            "Saved Notes are consistent; cleanup of temporary synchronization files is pending",
        )
    })
}

fn verify_backups(store: &Storage, stage: &Path, journal: &Journal) -> Result<(), NotesError> {
    for plan in &journal.plans {
        if plan.old_deleted.is_none() {
            continue;
        }
        for (index, old) in plan.old_parts.iter().enumerate() {
            if let Some(expected) = old {
                let path = if plan.new_deleted.is_some() {
                    stage.join("old").join(&plan.id).join(index.to_string())
                } else {
                    stage.join("work").join(&plan.id).join(PARTS[index])
                };
                if store.tree_hash(&path)? != *expected {
                    return Err(recovery_error());
                }
            }
        }
    }
    Ok(())
}
