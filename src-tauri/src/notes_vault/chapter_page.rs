//! Bounded chapter reads for the explicitly selected manuscript notebook.
use super::{read_note_file, validate_opaque_id, NoteSummary, NotesError, NotesVault};
use std::{collections::BTreeSet, fs};

impl NotesVault {
    pub(crate) fn chapter_page(
        &self,
        notebook: &str,
        after: Option<&str>,
    ) -> Result<(Vec<NoteSummary>, Option<String>), NotesError> {
        let notebook = validate_opaque_id(notebook)?;
        let after = after.map(validate_opaque_id).transpose()?;
        // Discovery excludes notebooks in the recoverable trash.
        let directory = self.vaults_dir().join(&notebook).join("src/content/notes");
        let unavailable = || NotesError::new("vault_corrupt", "Cannot read chapter directory");
        let mut candidates = BTreeSet::new();
        // Keep at most one page plus a lookahead, even for a very large directory.
        // An unreadable chapter fails the page instead of silently claiming it is absent.
        for entry in fs::read_dir(&directory).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".md")) else {
                continue;
            };
            if !validate_opaque_id(id).is_ok_and(|canonical| canonical == id)
                || after.as_deref().is_some_and(|cursor| id <= cursor)
            {
                continue;
            }
            candidates.insert(id.to_owned());
            if candidates.len() > 21 {
                candidates.pop_last();
            }
        }
        let more = candidates.len() > 20;
        if more {
            candidates.pop_last();
        }
        let next = more.then(|| candidates.last().unwrap().clone());
        let chapters = candidates
            .into_iter()
            .map(|id| {
                read_note_file(&directory.join(format!("{id}.md")), &notebook)
                    .map(|note| note.summary)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok((chapters, next))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes_vault::{serialize_note, MAX_NOTES};
    use uuid::Uuid;

    #[test]
    fn pages_beyond_the_notes_list_cap_and_rejects_unreadable_or_deleted_sources() {
        let root = std::env::temp_dir().join(format!("zicode-chapter-page-{}", Uuid::new_v4()));
        let notes = NotesVault::new(root.join("plugins")).unwrap();
        let book = notes.create_notebook("长篇", None, None).unwrap();
        let mut note = notes
            .create_note(&book.id, "章节", "原文", vec![], None, None)
            .unwrap();
        let directory = notes.vaults_dir().join(&book.id).join("src/content/notes");
        fs::remove_file(directory.join(format!("{}.md", note.summary.id))).unwrap();
        for index in 1..=MAX_NOTES + 5 {
            note.summary.id = Uuid::from_u128(index as u128).to_string();
            fs::write(
                directory.join(format!("{}.md", note.summary.id)),
                serialize_note(&note).unwrap(),
            )
            .unwrap();
        }
        let (first, next) = notes.chapter_page(&book.id, None).unwrap();
        assert_eq!(first.len(), 20);
        assert_eq!(next, Some(Uuid::from_u128(20).to_string()));
        let (tail, next) = notes
            .chapter_page(
                &book.id,
                Some(&Uuid::from_u128(MAX_NOTES as u128).to_string()),
            )
            .unwrap();
        assert_eq!(tail.len(), 5);
        assert!(next.is_none());
        assert_eq!(
            tail[4].id,
            Uuid::from_u128((MAX_NOTES + 5) as u128).to_string()
        );
        fs::write(directory.join(format!("{}.md", tail[0].id)), b"corrupt").unwrap();
        assert!(notes
            .chapter_page(
                &book.id,
                Some(&Uuid::from_u128(MAX_NOTES as u128).to_string())
            )
            .is_err());
        notes.delete_notebook(&book.id).unwrap();
        assert!(notes.chapter_page(&book.id, None).is_err());
        drop(notes);
        fs::remove_dir_all(root).unwrap();
    }
}
