//! Explicit profile selection; test credentials require both directory and name.
use std::{ffi::OsString, path::PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Selection {
    pub root: PathBuf,
    pub test_name: Option<String>,
}

pub(super) fn parse(
    arguments: impl IntoIterator<Item = OsString>,
) -> Result<Option<Selection>, String> {
    let mut arguments = arguments.into_iter();
    let mut profile = None;
    let mut test_name = None;
    while let Some(argument) = arguments.next() {
        match argument.to_str() {
            Some("--isolated-profile") => {
                if profile.is_some() {
                    return Err("Only one --isolated-profile is allowed".into());
                }
                let path = PathBuf::from(
                    arguments
                        .next()
                        .ok_or("--isolated-profile requires an absolute directory")?,
                );
                if !path.is_absolute() || path.parent().is_none() {
                    return Err("--isolated-profile requires an absolute non-root directory".into());
                }
                profile = Some(path);
            }
            Some("--test-profile") => {
                if test_name.is_some() {
                    return Err("Only one --test-profile is allowed".into());
                }
                let name = arguments
                    .next()
                    .and_then(|value| value.into_string().ok())
                    .ok_or("--test-profile requires a name")?;
                let valid = !name.is_empty()
                    && name.len() <= 48
                    && name.bytes().all(|byte| {
                        byte.is_ascii_lowercase()
                            || byte.is_ascii_digit()
                            || matches!(byte, b'_' | b'-')
                    })
                    && name.as_bytes()[0].is_ascii_alphanumeric();
                if !valid {
                    return Err("Test profile name must be 1–48 lowercase ASCII letters, digits, _ or -, starting with a letter or digit".into());
                }
                test_name = Some(name);
            }
            _ => {
                let text = argument.to_string_lossy();
                if text.starts_with("--isolated-profile=") || text.starts_with("--test-profile=") {
                    return Err("Profile arguments require separate values".into());
                }
            }
        }
    }
    match profile {
        Some(root) => Ok(Some(Selection { root, test_name })),
        None if test_name.is_some() => Err("--test-profile requires --isolated-profile".into()),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_credentials_require_an_explicit_valid_name_and_directory() {
        let root = std::env::temp_dir()
            .join("named-test-profile")
            .into_os_string();
        for name in [
            "",
            "../personal",
            "/daily",
            "_test",
            "Test",
            "a.b",
            "a b",
            &"a".repeat(49),
        ] {
            assert!(parse([
                "--isolated-profile".into(),
                root.clone(),
                "--test-profile".into(),
                name.into()
            ])
            .is_err());
        }
        for args in [
            vec!["--test-profile"],
            vec!["--test-profile", "test"],
            vec!["--test-profile=test"],
        ] {
            assert!(parse(args.into_iter().map(OsString::from)).is_err());
        }
        assert!(parse([
            "--isolated-profile".into(),
            root.clone(),
            "--test-profile".into(),
            "a".into(),
            "--test-profile".into(),
            "a".into()
        ])
        .is_err());
        assert_eq!(
            parse([
                "--test-profile".into(),
                "long-lived_1".into(),
                "--isolated-profile".into(),
                root.clone()
            ])
            .unwrap(),
            Some(Selection {
                root: root.into(),
                test_name: Some("long-lived_1".into())
            })
        );
    }
}
