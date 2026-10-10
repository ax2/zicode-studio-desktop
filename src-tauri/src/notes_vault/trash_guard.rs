use super::{read_note_file, trash_metadata, NotesError, NotesVault};

impl NotesVault {
    /// Called while the scoped vault guard is held, before a trash mutation.
    pub fn validate_trash_entry(
        &self,
        notebook_id: &str,
        note_id: &str,
        expected_version: Option<&str>,
        expected_deleted_at: Option<&str>,
        expected_trash_token: Option<&str>,
    ) -> Result<(), NotesError> {
        // Keep the legacy request contract; current clients also send the deletion event token.
        if expected_version.is_none()
            && expected_deleted_at.is_none()
            && expected_trash_token.is_none()
        {
            return Ok(());
        }
        let conflict = || {
            NotesError::new(
                "version_conflict",
                "The trash entry changed. Refresh the trash before trying again.",
            )
        };
        let (Some(version), Some(deleted_at)) = (expected_version, expected_deleted_at) else {
            return Err(conflict());
        };
        if version.is_empty() || deleted_at.is_empty() {
            return Err(conflict());
        }
        let path = self.trash_path(notebook_id, note_id)?;
        let note = read_note_file(&path, notebook_id)?;
        let stamp = trash_metadata::read_or_initialize(&path)?;
        if note.summary.version != version
            || stamp.deleted_at != deleted_at
            || expected_trash_token.is_some_and(|token| token != stamp.trash_token)
        {
            return Err(conflict());
        }
        Ok(())
    }
}
