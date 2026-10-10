use super::*;

fn rewrite_content(
    content: &str,
    mapping: &HashMap<String, String>,
    known: &BTreeSet<(String, String)>,
) -> String {
    let mut output = String::new();
    let mut copied = 0;
    super::references::scan(content, |reference| {
        if let super::references::Reference::Resource {
            book,
            note,
            book_range,
        } = reference
        {
            if let Some(new) = mapping
                .get(&book)
                .filter(|_| known.contains(&(book.clone(), note)))
            {
                output.push_str(&content[copied..book_range.start]);
                output.push_str(new);
                copied = book_range.end;
            }
        }
    });
    output.push_str(&content[copied..]);
    output
}

pub(super) fn rewrite_staged(
    vault: &NotesVault,
    mapping: &HashMap<String, String>,
    known: &BTreeSet<(String, String)>,
) -> Result<(), NotesError> {
    for new in mapping.values() {
        let root = vault.vault_root(new)?;
        for (directory, trash) in [
            (root.join("src/content/notes"), false),
            (root.join(".trash"), true),
        ] {
            let entries = fs::read_dir(directory).map_err(|_| {
                NotesError::new(
                    "storage_unavailable",
                    "Cannot read imported Notes references",
                )
            })?;
            for entry in entries {
                let entry = entry.map_err(|_| {
                    NotesError::new(
                        "storage_unavailable",
                        "Cannot read imported Notes references",
                    )
                })?;
                let kind = entry.file_type().map_err(|_| {
                    NotesError::new(
                        "storage_unavailable",
                        "Cannot read imported Notes references",
                    )
                })?;
                if !kind.is_file()
                    || kind.is_symlink()
                    || entry
                        .path()
                        .extension()
                        .is_none_or(|extension| extension != "md")
                {
                    continue;
                }
                let path = entry.path();
                let mut document = read_note_file(&path, new)?;
                let content = rewrite_content(&document.content, mapping, known);
                if content == document.content {
                    continue;
                }
                let modified = fs::metadata(&path)
                    .and_then(|metadata| metadata.modified())
                    .map_err(|_| {
                        NotesError::new(
                            "storage_unavailable",
                            "Cannot read imported Notes timestamp",
                        )
                    })?;
                document.content = content;
                atomic_write(&path, &serialize_note(&document)?)?;
                if trash {
                    OpenOptions::new()
                        .write(true)
                        .open(&path)
                        .and_then(|file| {
                            file.set_times(std::fs::FileTimes::new().set_modified(modified))
                        })
                        .map_err(|_| {
                            NotesError::new(
                                "storage_unavailable",
                                "Cannot restore Notes trash timestamp",
                            )
                        })?;
                }
            }
        }
    }
    Ok(())
}
