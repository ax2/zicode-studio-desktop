//! Fixed default-target entry for projects that use GNU Make.
use super::catalog::{read_manifest, Task};
use sha2::{Digest, Sha256};
use std::path::Path;

pub(super) fn append(root: &Path, tasks: &mut Vec<Task>, hash: &mut Sha256) -> Result<(), String> {
    // GNU Make uses this order when no -f option is supplied.
    for name in ["GNUmakefile", "makefile", "Makefile"] {
        let bytes = match read_manifest(root, name) {
            Ok(Some(bytes)) => Ok(bytes),
            Ok(None) => continue,
            Err(error) => Err(error),
        };
        hash.update(name.as_bytes());
        match &bytes {
            Ok(bytes) => {
                hash.update((bytes.len() as u64).to_le_bytes());
                hash.update(bytes);
            }
            Err(error) => hash.update(error.as_bytes()),
        }
        tasks.push(Task {
            id: "@make/default".into(),
            name: "make".into(),
            command: "make".into(),
            runnable: bytes.is_ok(),
            source: name.into(),
            manager: "make".into(),
            interpreter: None,
            unavailable_reason: bytes.err(),
            arguments: vec![],
        });
        break;
    }
    Ok(())
}
