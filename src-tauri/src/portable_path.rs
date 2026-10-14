//! Portable path component checks shared by file grants and archive previews.

pub(crate) fn reserved_windows_device_name(part: &str) -> bool {
    let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    ["COM", "LPT"].iter().any(|prefix| {
        base.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_portable_device_names_even_with_extensions() {
        for name in [
            "NUL.tar.gz",
            "conin$.txt",
            "COM1",
            "com¹.zip",
            "LPT².log",
            "lpt³",
        ] {
            assert!(reserved_windows_device_name(name), "{name}");
        }
        for name in ["COM10", "LPT4-data", "filename.txt", "中文.zip"] {
            assert!(!reserved_windows_device_name(name), "{name}");
        }
    }
}
