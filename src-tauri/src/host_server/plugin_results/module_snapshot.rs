//! Bounded reads from an opened regular file, independent of a prior path-size check.
use std::io::{self, Read};
use std::path::Path;

pub(in crate::host_server) const MAX_BYTES: usize = 2 * 1024 * 1024;

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Plugin module snapshot is invalid",
    )
}

pub(in crate::host_server) fn validate(bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(invalid());
    }
    Ok(())
}

fn bounded(mut reader: impl Read, expected: usize) -> io::Result<Vec<u8>> {
    if expected == 0 || expected > MAX_BYTES {
        return Err(invalid());
    }
    // Fixed buffer: even growth or a reader that never returns EOF cannot grow allocation.
    let mut bytes = vec![0; expected + 1];
    let mut count = 0;
    while count < bytes.len() {
        match reader.read(&mut bytes[count..]) {
            Ok(0) => break,
            Ok(length) => count += length,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    if count != expected || count > MAX_BYTES {
        return Err(invalid());
    }
    bytes.truncate(count);
    Ok(bytes)
}

pub(in crate::host_server) fn read(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    let before = file.metadata()?;
    if !before.is_file() || before.len() > MAX_BYTES as u64 {
        return Err(invalid());
    }
    let bytes = bounded(&mut file, before.len() as usize)?;
    if file.metadata()?.len() != bytes.len() as u64 {
        return Err(invalid());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn bounds_empty_exact_limit_oversize_and_borrowed_snapshots() {
        for length in [1, MAX_BYTES] {
            let bytes = vec![7; length];
            assert_eq!(bounded(Cursor::new(&bytes), length).unwrap(), bytes);
            validate(&bytes).unwrap();
        }
        for bytes in [vec![], vec![0; MAX_BYTES + 1]] {
            assert!(validate(&bytes).is_err());
        }
        assert!(bounded(Cursor::new(vec![1; 8]), 0).is_err());
        assert!(bounded(Cursor::new(vec![1; MAX_BYTES + 1]), MAX_BYTES + 1).is_err());
        assert!(bounded(Cursor::new(vec![1; 7]), 8).is_err());
        assert!(bounded(Cursor::new(vec![1; 9]), 8).is_err());
    }

    #[test]
    fn growth_after_size_check_and_endless_reader_are_capped() {
        struct Growing {
            delivered: usize,
        }
        impl Read for Growing {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                buffer.fill(1);
                self.delivered += buffer.len();
                Ok(buffer.len())
            }
        }
        let mut reader = Growing { delivered: 0 };
        assert!(bounded(&mut reader, 8).is_err());
        assert_eq!(reader.delivered, 9);
    }

    #[test]
    fn opened_file_growth_and_replacement_do_not_switch_the_read_handle() {
        use std::io::Write;
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("bounded-module-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("module.wasm");
        std::fs::write(&path, b"original").unwrap();
        assert_eq!(read(&path).unwrap(), b"original");
        let mut opened = std::fs::File::open(&path).unwrap();
        let expected = opened.metadata().unwrap().len() as usize;
        let mut writer = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writer.write_all(&vec![1; MAX_BYTES]).unwrap();
        drop(writer);
        assert!(bounded(&mut opened, expected).is_err());
        drop(opened);
        assert!(read(&path).is_err());
        std::fs::write(&path, b"original").unwrap();
        let mut opened = std::fs::File::open(&path).unwrap();
        std::fs::rename(&path, root.join("retained.wasm")).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        assert_eq!(bounded(&mut opened, 8).unwrap(), b"original");
        drop(opened);
        assert_eq!(read(&path).unwrap(), b"replacement");
        assert!(read(&root).is_err());
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
