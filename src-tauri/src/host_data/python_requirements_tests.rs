use super::*;

#[test]
fn parses_static_dynamic_and_legacy_python_declarations() {
    let values = parse("[project]\nrequires-python='>=3.10, <3.14'\n[build-system]\nrequires=['not executed']\nbuild-backend='not executed'").unwrap();
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].kind, Some("pep440"));
    assert_eq!(values[0].constraint, ">=3.10, <3.14");
    assert!(parse("[project]\nname='example'").unwrap().is_empty());
    assert_eq!(
        parse("[project]\ndynamic=['requires-python']").unwrap()[0].kind,
        Some("dynamic")
    );
    assert_eq!(
        parse("[tool.poetry.dependencies]\npython='^3.12'").unwrap()[0].kind,
        Some("poetry")
    );
    assert_eq!(
        parse("[project]\nrequires-python='>=3.12'\n[tool.poetry.dependencies]\npython='^3.12'")
            .unwrap()[0]
            .kind,
        Some("pep440")
    );
    for text in [
        "[project]\nrequires-python=3.12",
        "project=3",
        "[project]\ndynamic=3",
        "[project]\ndynamic=[3]",
        "[project]\nrequires-python='>=3.12'\ndynamic=['requires-python']",
        "[project",
    ] {
        assert!(parse(text).is_err(), "{text}");
    }
}

#[test]
fn compares_pep440_against_installed_interpreters() {
    let cases = [
        (">=3.10,<3.14", "3.13.7", "satisfied"),
        (">=3.10,<3.14", "3.14.0", "mismatch"),
        (">=3.10,!=3.12.*", "3.12.7", "mismatch"),
        ("~=3.12", "3.14.7", "satisfied"),
        ("~=3.12.0", "3.13.0", "mismatch"),
        ("~=3.12.0", "3.12.9", "satisfied"),
        ("==3.14.*", "3.14.7", "satisfied"),
        ("==3.14.7", "3.14.7+local.1", "satisfied"),
        ("!=3.14.7", "3.14.7+local.1", "mismatch"),
        ("===3.14.7", "3.14.7", "satisfied"),
        (">=3.14.0rc1", "3.14.0rc2", "satisfied"),
        (">=3.14.0", "3.14.0rc2", "mismatch"),
        (">=3.13", "3.14.0rc2", "satisfied"),
        ("<3.14", "3.14.0rc2", "mismatch"),
        (">=3.14.0.dev1", "3.14.0.dev2", "satisfied"),
        ("==3.14.0", "3.14.0.post1", "mismatch"),
        (">3.14.0", "3.14.0.post1", "mismatch"),
        (">=1!3.0", "3.14.7", "mismatch"),
        ("", "3.14.7", "satisfied"),
        ("^3.12", "3.14.7", "invalid"),
        ("3.12 || 3.13", "3.14.7", "invalid"),
        (">=3.12.*", "3.14.7", "invalid"),
    ];
    for (range, version, expected) in cases {
        let result = compare(
            &requirement(range, "pep440"),
            "ready",
            Some(&format!("Python {version}")),
        );
        assert_eq!(result.status, expected, "{range} vs {version}");
        assert_eq!(
            result.observed_version.as_deref(),
            Some(format!("Python {version}").as_str())
        );
    }
}

#[test]
fn rejects_unusable_output_and_preserves_missing_failed_and_unsupported_states() {
    let standard = requirement(">=3.10", "pep440");
    for output in [
        "warning Python 3.14.7",
        "Python 3.14",
        "Python 3.14.7 warning",
        "Python v3.14.7",
        "Python 1!3.14.7",
        "3.14.7",
        "Python 3.14.7\n",
        "Python ",
        "Python 3.14.7  ",
    ] {
        assert_eq!(
            compare(&standard, "ready", Some(output)).status,
            "unknown-version",
            "{output}"
        );
    }
    assert_eq!(compare(&standard, "missing", None).status, "missing");
    assert_eq!(compare(&standard, "timeout", None).status, "unavailable");
    assert_eq!(
        compare(&standard, "failed", Some("Python 3.14.7")).status,
        "unavailable"
    );
    assert_eq!(compare(&standard, "ready", None).status, "unknown-version");
    assert_eq!(
        compare(
            &requirement("^3.12", "poetry"),
            "ready",
            Some("Python 3.14.7")
        )
        .status,
        "unsupported"
    );
    assert_eq!(
        compare(
            &requirement("requires-python", "dynamic"),
            "ready",
            Some("Python 3.14.7")
        )
        .status,
        "unsupported"
    );
    let long = requirement(&format!(">=3.12{}", " ".repeat(250)), "pep440");
    assert_eq!(long.constraint.len(), 200);
    assert_eq!(
        compare(&long, "ready", Some("Python 3.14.7")).status,
        "truncated"
    );
}

#[test]
fn bounds_real_python_files_and_serializes_only_report_data() {
    let root = std::env::temp_dir().join(format!(
        "zicode-python-requirements-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    std::fs::write(
        root.join("pyproject.toml"),
        "[project]\nrequires-python='>=3.10'\n[tool.private]\npath='private fixture not returned'",
    )
    .unwrap();
    let mut manifests = super::super::inspect(&root);
    assess(&mut manifests, "ready", Some("Python 3.14.7"));
    assert_eq!(
        manifests[0].requirements[0]
            .assessment
            .as_ref()
            .unwrap()
            .status,
        "satisfied"
    );
    let json = serde_json::to_value(&manifests).unwrap();
    assert_eq!(
        json[0]["requirements"][0]["assessment"]["observedVersion"],
        "Python 3.14.7"
    );
    assert!(!json.to_string().contains("private fixture"));
    std::fs::write(root.join("pyproject.toml"), vec![b'x'; 256 * 1024 + 1]).unwrap();
    assert_eq!(super::super::inspect(&root)[0].status, "too_large");
    std::fs::write(root.join("pyproject.toml"), "[project").unwrap();
    assert_eq!(super::super::inspect(&root)[0].status, "invalid");
    std::fs::remove_dir_all(root).unwrap();
}
