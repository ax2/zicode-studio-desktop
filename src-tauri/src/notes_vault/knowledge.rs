use super::*;

impl NotesVault {
    pub fn knowledge(&self) -> Result<NotesKnowledgeSnapshot, NotesError> {
        let notebooks = self.list_notebooks()?;
        let mut summaries = Vec::new();
        let mut incomplete = notebooks.len() > MAX_NOTEBOOKS;
        for notebook in notebooks.iter().take(MAX_NOTEBOOKS) {
            let directory = self.vault_root(&notebook.id)?.join("src/content/notes");
            // The legacy reader also caps physical entries, including invalid files.
            if fs::read_dir(directory)
                .map_err(|_| {
                    NotesError::new("vault_corrupt", "Notebook notes directory is missing")
                })?
                .take(MAX_NOTES + 1)
                .count()
                > MAX_NOTES
            {
                incomplete = true;
            }
            summaries.extend(self.scan_notebook_notes(&notebook.id)?);
            if summaries.len() >= MAX_NOTES {
                incomplete = true;
                summaries.truncate(MAX_NOTES);
                break;
            }
        }
        summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        let mut by_title: HashMap<String, Vec<&NoteSummary>> = HashMap::new();
        for note in &summaries {
            by_title
                .entry(note.title.trim().to_lowercase())
                .or_default()
                .push(note);
        }
        let by_ref: HashMap<String, &NoteSummary> = summaries
            .iter()
            .map(|note| (format!("{}/{}", note.notebook_id, note.id), note))
            .collect();
        let mut links = Vec::new();
        let mut seen_links = BTreeSet::new();
        for source in &summaries {
            let document = self.get_note(&source.notebook_id, &source.id)?;
            super::references::scan(&document.content, |reference| {
                let (kind, target) = match reference {
                    super::references::Reference::Title(title) if !incomplete => (
                        "wikilink",
                        unique_title(&title, &source.notebook_id, &by_title),
                    ),
                    super::references::Reference::Resource { book, note, .. } => {
                        ("reference", by_ref.get(&format!("{book}/{note}")).copied())
                    }
                    _ => return,
                };
                let Some(target) = target else {
                    return;
                };
                if target.id == source.id && target.notebook_id == source.notebook_id {
                    return;
                }
                let key = (
                    source.notebook_id.clone(),
                    source.id.clone(),
                    target.notebook_id.clone(),
                    target.id.clone(),
                    kind,
                );
                if !seen_links.insert(key) {
                    return;
                }
                links.push(NoteKnowledgeLink {
                    from_notebook_id: source.notebook_id.clone(),
                    from_note_id: source.id.clone(),
                    from_title: source.title.clone(),
                    to_notebook_id: target.notebook_id.clone(),
                    to_note_id: target.id.clone(),
                    to_title: target.title.clone(),
                    kind: kind.to_string(),
                });
            });
        }
        let mut similar = Vec::new();
        for (index, left) in summaries.iter().enumerate() {
            let left_tags: BTreeSet<String> =
                left.tags.iter().map(|tag| tag.to_lowercase()).collect();
            if left_tags.is_empty() {
                continue;
            }
            for right in summaries.iter().skip(index + 1) {
                let right_tags: BTreeSet<String> =
                    right.tags.iter().map(|tag| tag.to_lowercase()).collect();
                let shared_tags: Vec<String> =
                    left_tags.intersection(&right_tags).cloned().collect();
                if shared_tags.is_empty() {
                    continue;
                }
                let union_size = left_tags.union(&right_tags).count();
                similar.push(SimilarNotePair {
                    left_notebook_id: left.notebook_id.clone(),
                    left_note_id: left.id.clone(),
                    left_title: left.title.clone(),
                    right_notebook_id: right.notebook_id.clone(),
                    right_note_id: right.id.clone(),
                    right_title: right.title.clone(),
                    score: shared_tags.len() as f64 / union_size as f64,
                    shared_tags,
                });
                if similar.len() >= 200 {
                    similar.sort_by(|left, right| {
                        right
                            .score
                            .partial_cmp(&left.score)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    });
                    similar.truncate(100);
                }
            }
        }
        similar.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        similar.truncate(100);
        let mut conflicts = Vec::new();
        'conflicts: for (index, left) in summaries.iter().enumerate() {
            for right in summaries.iter().skip(index + 1) {
                if left.version == right.version {
                    continue;
                }
                let shared_source = left.source.as_ref().and_then(|left_source| {
                    right
                        .source
                        .as_ref()
                        .filter(|right_source| right_source.url == left_source.url)
                        .map(|_| left_source.url.clone())
                });
                let same_title = left.title.trim().eq_ignore_ascii_case(right.title.trim());
                if !same_title && shared_source.is_none() {
                    continue;
                }
                conflicts.push(NoteKnowledgeConflict {
                    left_notebook_id: left.notebook_id.clone(),
                    left_note_id: left.id.clone(),
                    left_title: left.title.clone(),
                    right_notebook_id: right.notebook_id.clone(),
                    right_note_id: right.id.clone(),
                    right_title: right.title.clone(),
                    reason: if shared_source.is_some() {
                        "source_changed".to_string()
                    } else {
                        "duplicate_title".to_string()
                    },
                    source_url: shared_source,
                });
                if conflicts.len() >= 100 {
                    break 'conflicts;
                }
            }
        }
        conflicts.truncate(100);
        Ok(NotesKnowledgeSnapshot {
            incomplete,
            links,
            similar,
            conflicts,
        })
    }
}

fn unique_title<'a>(
    title: &str,
    notebook_id: &str,
    by_title: &HashMap<String, Vec<&'a NoteSummary>>,
) -> Option<&'a NoteSummary> {
    let candidates = by_title.get(&title.trim().to_lowercase())?;
    let mut local = candidates
        .iter()
        .copied()
        .filter(|note| note.notebook_id == notebook_id);
    if let Some(first) = local.next() {
        return local.next().is_none().then_some(first);
    }
    if candidates.len() == 1 {
        candidates.first().copied()
    } else {
        None
    }
}
