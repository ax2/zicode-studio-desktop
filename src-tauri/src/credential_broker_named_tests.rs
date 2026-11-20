//! Synthetic vault acceptance only: never opens daily/personal account names.
use super::*;

#[test]
fn named_accounts_cannot_alias_personal_or_other_test_accounts() {
    let root = Path::new("synthetic-owned-root");
    let account = |path, name| credential_account_in_scope(path, name, "programming", "synthetic");
    let named = account(Some(root), Some("long-lived"));
    assert_eq!(named, account(Some(root), Some("long-lived")));
    assert_ne!(named, account(None, None));
    assert_ne!(named, account(Some(root), None));
    assert_ne!(named, account(Some(root), Some("another-test")));
    assert_ne!(
        named,
        account(Some(Path::new("another-root")), Some("long-lived"))
    );
}

#[test]
#[ignore = "Opt-in: writes and removes only synthetic credentials in a random owned test profile"]
fn synthetic_named_profile_vault_survives_restart_and_never_falls_back() {
    const ENV: &str = "ZICODE_SYNTHETIC_TEST_PROFILE_ROOT";
    if let Some(root) = std::env::var_os(ENV) {
        child(
            PathBuf::from(root),
            &std::env::var("ZICODE_SYNTHETIC_TEST_PROFILE_STAGE").unwrap(),
        );
        return;
    }
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let fixture = scratch.join(format!("zicode-named-vault-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&fixture).unwrap();
    fs::write(
        fixture.join("owner.json"),
        r#"{"purpose":"synthetic named vault acceptance","lifetime":"test invocation"}"#,
    )
    .unwrap();
    let root = fixture.join("profile");
    let invoke = |stage: &str| {
        crate::process_command::new_command(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "credential_broker::named_tests::synthetic_named_profile_vault_survives_restart_and_never_falls_back", "--nocapture"])
        .env(ENV, &root).env("ZICODE_SYNTHETIC_TEST_PROFILE_STAGE", stage).output().unwrap()
    };
    let personal = fixture.join("synthetic-personal");
    fs::create_dir(&personal).unwrap();
    fs::write(
        personal.join("profile.json"),
        "{\"schemaVersion\":1,\"kind\":\"zicode-isolated-desktop\"}\n",
    )
    .unwrap();
    let personal_index = personal.join("system/credentials/index.json");
    fs::create_dir_all(personal_index.parent().unwrap()).unwrap();
    let retained = serde_json::json!({"sceneId":"programming","provider":"retained-synthetic","account":credential_account_in(Some(&personal.canonicalize().unwrap()), "programming", "retained-synthetic")});
    fs::write(
        &personal_index,
        serde_json::to_vec(&serde_json::json!({"version":1,"entries":[retained.clone()]})).unwrap(),
    )
    .unwrap();
    let mut failures = Vec::new();
    for stage in ["seed-a", "read-a", "other-b", "read-a", "disabled"] {
        let output = invoke(stage);
        if !output.status.success() {
            failures.push(format!(
                "{stage}: {} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ));
            break;
        }
        if stage == "seed-a" {
            for _attempt in 0..2 {
                let output = crate::process_command::new_command("pwsh")
                    .args(["-NoProfile", "-File"])
                    .arg(
                        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("../scripts/configure-model-credentials.ps1"),
                    )
                    .arg("-PersonalProfile")
                    .arg(&personal)
                    .arg("-TestProfile")
                    .arg(&root)
                    .args([
                        "-TestName",
                        "acceptance-a",
                        "-Provider",
                        "synthetic-model-only",
                        "-Synthetic",
                    ])
                    .output()
                    .unwrap();
                if !output.status.success() {
                    failures.push(format!(
                        "local SecureString helper failed: {} {}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    ));
                    break;
                }
            }
        }
    }
    // Always remove only this random profile's known synthetic entries, also
    // when an assertion above fails. No daily credentials are enumerated/read.
    for stage in ["cleanup-a", "cleanup-b"] {
        let output = invoke(stage);
        if !output.status.success() {
            failures.push(format!("{stage}: cleanup failed"));
        }
    }
    let personal_account = credential_account_in(
        Some(&personal.canonicalize().unwrap()),
        "programming",
        "synthetic-model-only",
    );
    let entry = keyring::Entry::new(SERVICE_NAME, &personal_account).unwrap();
    match entry.get_password() {
        Ok(value) => {
            assert_eq!(value, "synthetic-not-a-real-api-key");
            entry.delete_credential().unwrap();
        }
        Err(keyring::Error::NoEntry) => {}
        Err(error) => panic!("synthetic personal credential cleanup failed: {error}"),
    }
    let saved_personal: Value =
        serde_json::from_slice(&fs::read(&personal_index).unwrap()).unwrap();
    assert!(saved_personal["entries"]
        .as_array()
        .unwrap()
        .contains(&retained));
    if failures.is_empty() {
        fs::remove_dir_all(&fixture).unwrap();
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn child(root: PathBuf, stage: &str) {
    let name = if stage.ends_with('b') {
        "acceptance-b"
    } else {
        "acceptance-a"
    };
    let mut args = vec![
        OsString::from("--isolated-profile"),
        root.clone().into_os_string(),
    ];
    if stage != "disabled" {
        args.extend(["--test-profile".into(), name.into()]);
    }
    crate::desktop_profile::initialize(args).unwrap();
    let system = crate::app_paths::system_root().unwrap();
    let scene = "programming";
    let provider = "synthetic-model-only";
    let visual = "visual-creation-synthetic";
    let image_provider = "visual-images-synthetic";
    let secret = "synthetic-not-a-real-api-key";
    if stage == "disabled" {
        assert!(!crate::desktop_profile::system_credentials_enabled());
        assert_eq!(model_tool_credential(scene, provider).unwrap(), None);
        assert!(!scene_credential_status(scene, provider).unwrap().configured);
        assert!(store_scene_credential(scene, provider, secret).is_err());
        assert!(delete_scene_credential(scene, provider).is_err());
        return;
    }
    assert!(crate::desktop_profile::system_credentials_enabled());
    assert_eq!(crate::desktop_profile::test_profile_name(), Some(name));
    assert!(!crate::desktop_profile::pi_discovery_flags().is_empty());
    let expected_index = system
        .join("credentials/test-profiles")
        .join(name)
        .join("index.json");
    assert_eq!(index_path(&system), expected_index);
    let executable = std::env::current_exe()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let forwarded = |selected: Option<&str>| {
        let mut args = vec![
            executable.clone(),
            "--isolated-profile".into(),
            root.to_string_lossy().into_owned(),
        ];
        if let Some(name) = selected {
            args.extend(["--test-profile".into(), name.into()]);
        }
        args.push("--tools-only".into());
        crate::explorer_entry::forwarded_intent(&args)
    };
    assert!(forwarded(Some(name)).is_ok());
    assert!(forwarded(None).is_err());
    assert!(forwarded(Some("different-test")).is_err());
    match stage {
        "seed-a" => {
            assert_eq!(model_tool_credential(scene, provider).unwrap(), None);
            store_scene_credential(scene, provider, secret).unwrap();
            store_scene_credential(visual, image_provider, secret).unwrap();
        }
        "read-a" => {
            assert_eq!(
                model_tool_credential(scene, provider).unwrap().as_deref(),
                Some(secret)
            );
            assert!(scene_credential_status(scene, provider).unwrap().configured);
            assert_eq!(
                scene_provider_credentials(&system, scene).unwrap(),
                vec![(provider.into(), secret.into())]
            );
            assert_eq!(
                model_tool_credential(visual, image_provider)
                    .unwrap()
                    .as_deref(),
                Some(secret)
            );
            let agent = system.join("synthetic-agent");
            fs::create_dir_all(&agent).unwrap();
            prepare_scene_credentials(&system, scene, &agent).unwrap();
            assert!(!agent.join("auth.json").exists());
            assert!(!fs::read_to_string(&expected_index)
                .unwrap()
                .contains(secret));
        }
        "other-b" => {
            assert_eq!(model_tool_credential(scene, provider).unwrap(), None);
            assert!(scene_provider_credentials(&system, scene)
                .unwrap()
                .is_empty());
            assert!(!scene_credential_status(scene, provider).unwrap().configured);
            assert!(!expected_index.exists());
            store_scene_credential(scene, provider, "synthetic-other-key").unwrap();
        }
        "cleanup-a" | "cleanup-b" => {
            delete_scene_credential(scene, provider).unwrap();
            delete_scene_credential(visual, image_provider).unwrap();
            assert_eq!(model_tool_credential(scene, provider).unwrap(), None);
        }
        _ => panic!("unknown synthetic stage"),
    }
}

use std::ffi::OsString;
