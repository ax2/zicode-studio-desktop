use super::*;

pub(super) const KEY: &str = "layout/notebook-order.v1";
const FILE: &str = ".notebook-order.v1.json";
const LIMIT: usize = 16 * 1024;

fn validate(ids: &[String]) -> Result<(), NotesError> {
    if ids.len() > MAX_NOTEBOOKS || ids.iter().collect::<BTreeSet<_>>().len() != ids.len() {
        return Err(invalid());
    }
    ids.iter().try_for_each(|id| records::canonical_id(id))
}
pub(super) fn parse(bytes: &[u8]) -> Result<Vec<String>, NotesError> {
    let ids: Vec<String> = decode(bytes)?;
    validate(&ids)?;
    if encode(&ids)? != bytes {
        return Err(invalid());
    }
    Ok(ids)
}
pub(super) fn read(store: &Storage) -> Result<Option<Vec<String>>, NotesError> {
    let path = Path::new(FILE);
    if !store.exists(path)? {
        return Ok(None);
    }
    Ok(Some(parse(&store.read(path, LIMIT)?)?))
}
fn replace(store: &Storage, order: Option<&[String]>) -> Result<(), NotesError> {
    let target = Path::new(FILE);
    let Some(ids) = order else {
        return store.remove_bounded_file(target, LIMIT);
    };
    validate(ids)?;
    let tmp = PathBuf::from(format!(".notebook-order-{}.tmp", Uuid::new_v4()));
    store.write_new(&tmp, &encode(&ids)?)?;
    let result = store.replace_bounded_file(&tmp, target, LIMIT);
    if result.is_err() {
        let _ = store.remove_bounded_file(&tmp, LIMIT);
    }
    result
}

// Keep the order in the same commit/rollback boundary as the notebook objects
// and sync baseline. Missing order means a vault created by an earlier client.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Change {
    before: Option<Vec<String>>,
    after: Option<Vec<String>>,
}
impl Change {
    pub(super) fn between(old: &RecordMap, new: &RecordMap) -> Result<Option<Self>, NotesError> {
        let before = old.get(KEY).map(|v| parse(v)).transpose()?;
        let after = new.get(KEY).map(|v| parse(v)).transpose()?;
        Ok((before != after).then_some(Self { before, after }))
    }
    pub(super) fn apply(&self, store: &Storage, forward: bool) -> Result<(), NotesError> {
        for ids in [&self.before, &self.after].into_iter().flatten() {
            validate(ids)?
        }
        let (expected, target) = if forward {
            (&self.before, &self.after)
        } else {
            (&self.after, &self.before)
        };
        let current = read(store)?;
        if &current == target {
            return Ok(());
        }
        if &current != expected {
            return Err(recovery_error());
        }
        replace(store, target.as_deref())
    }
}

impl NotesVault {
    pub(in crate::notes_vault) fn stored_notebook_order(
        &self,
    ) -> Result<Option<Vec<String>>, NotesError> {
        read(&Storage::open(&self.vaults_dir())?)
    }
    pub(crate) fn save_notebook_order(
        &self,
        expected: Option<&[String]>,
        ids: &[String],
    ) -> Result<(), NotesError> {
        validate(ids)?;
        let store = Storage::open(&self.vaults_dir())?;
        let current = read(&store)?;
        let active: BTreeSet<String> = self
            .list_notebooks()?
            .into_iter()
            .map(|book| book.id)
            .collect();
        if current.as_deref() != expected || ids.iter().cloned().collect::<BTreeSet<_>>() != active
        {
            return Err(NotesError::new(
                "notebook_order_changed",
                "Notebook order changed. Reload the notebooks before trying again.",
            ));
        }
        replace(&store, Some(ids))
    }
}
