//! Fixed output types shared by the Worker, Host resource store and saved files.
//! Append only: WASI guests select these MIME types by numeric index.

pub(crate) const MIMES: &[&str] = &[
    "application/octet-stream",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "application/x-zicode-archive-zip",
    "application/x-zicode-archive-sevenzip",
    "application/x-zicode-archive-tar",
    "application/x-zicode-archive-targzip",
    "application/x-zicode-archive-tarzstd",
    "application/x-zicode-archive-tarxz",
    "application/x-zicode-archive-tarlzma",
    "application/x-zicode-archive-tarbzip2",
    "application/x-zicode-archive-tarlz4",
    "application/x-zicode-archive-gzip",
    "application/x-zicode-archive-zstandard",
    "application/x-zicode-archive-xz",
    "application/x-zicode-archive-lzma",
    "application/x-zicode-archive-bzip2",
    "application/x-zicode-archive-lz4",
    "application/x-zicode-archive-brotli",
    "application/x-zicode-archive-rar",
    "application/x-zicode-archive-cab",
    "text/csv",
    "text/markdown",
    "text/html",
    "application/x-zicode-sqlite",
];

// The first five MIME indices predate manifest negotiation. New types require
// the explicit resource.output.types.v1 profile before Host publication.
pub(crate) fn requires_profile(mime: &str) -> bool {
    MIMES[5..].contains(&mime)
}

pub(crate) fn extension(mime: &str) -> Option<&'static str> {
    match mime {
        "application/octet-stream" => Some("bin"),
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "text/plain" => Some("txt"),
        "application/x-zicode-archive-zip" => Some("zip"),
        "application/x-zicode-archive-sevenzip" => Some("7z"),
        "application/x-zicode-archive-tar" => Some("tar"),
        "application/x-zicode-archive-targzip" => Some("tar.gz"),
        "application/x-zicode-archive-tarzstd" => Some("tar.zst"),
        "application/x-zicode-archive-tarxz" => Some("tar.xz"),
        "application/x-zicode-archive-tarlzma" => Some("tar.lzma"),
        "application/x-zicode-archive-tarbzip2" => Some("tar.bz2"),
        "application/x-zicode-archive-tarlz4" => Some("tar.lz4"),
        "application/x-zicode-archive-gzip" => Some("gz"),
        "application/x-zicode-archive-zstandard" => Some("zst"),
        "application/x-zicode-archive-xz" => Some("xz"),
        "application/x-zicode-archive-lzma" => Some("lzma"),
        "application/x-zicode-archive-bzip2" => Some("bz2"),
        "application/x-zicode-archive-lz4" => Some("lz4"),
        "application/x-zicode-archive-brotli" => Some("br"),
        "application/x-zicode-archive-rar" => Some("rar"),
        "application/x-zicode-archive-cab" => Some("cab"),
        "text/csv" => Some("csv"),
        "text/markdown" => Some("md"),
        "text/html" => Some("html"),
        "application/x-zicode-sqlite" => Some("sqlite"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guest_indices_stay_stable_and_every_type_has_one_safe_suffix() {
        assert_eq!(
            &MIMES[..5],
            [
                "application/octet-stream",
                "image/png",
                "image/jpeg",
                "image/webp",
                "text/plain"
            ]
        );
        assert_eq!(MIMES.len(), 27);
        let mut suffixes = std::collections::HashSet::new();
        for mime in MIMES {
            let suffix = extension(mime).unwrap();
            assert!(suffix
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.'));
            assert!(suffixes.insert(suffix));
        }
        assert_eq!(extension("text/html"), Some("html"));
        assert_eq!(extension("application/x-zicode-sqlite"), Some("sqlite"));
        assert_eq!(extension("application/javascript"), None);
        assert!(!requires_profile("image/png"));
        assert!(requires_profile("application/x-zicode-archive-zip"));
        assert!(requires_profile("text/html"));
    }
}
