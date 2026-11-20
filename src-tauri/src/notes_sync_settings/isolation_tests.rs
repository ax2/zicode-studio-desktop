use super::*;

#[test]
fn personal_and_two_named_profiles_keep_independent_configuration_and_secret_references() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let profiles = [None, Some("test-a"), Some("test-b")];
    let mut expected = Vec::new();
    for (index, profile) in profiles.iter().copied().enumerate() {
        let mut connection = connection();
        connection.endpoint = format!("https://profile-{index}.invalid/dav/");
        connection.username = format!("initial-user-{index}");
        let initial = status(&root.0, profile, "workspace", true, &secrets).unwrap();
        let saved = save(
            &root.0,
            profile,
            "workspace",
            true,
            &secrets,
            request(
                connection.clone(),
                initial.revision,
                Some(&format!("initial-password-{index}")),
                Some(&SyncKey::generate().1),
            ),
        )
        .unwrap();
        expected.push((connection, saved.revision));
        for (peer, (connection, revision)) in profiles.iter().copied().zip(&expected) {
            let current = status(&root.0, peer, "workspace", true, &secrets).unwrap();
            assert!(current.connection == *connection);
            assert_eq!(&current.revision, revision);
            assert_eq!(current.state, "configured");
        }
    }
    for (index, profile) in profiles.iter().copied().enumerate() {
        let mut changed = connection();
        changed.endpoint = format!("https://changed-{index}.invalid/new-dav/");
        changed.username = format!("changed-user-{index}");
        let code = SyncKey::generate().1;
        let password = format!("changed-password-{index}");
        let saved = save(
            &root.0,
            profile,
            "workspace",
            true,
            &secrets,
            request(
                changed.clone(),
                expected[index].1.clone(),
                Some(&password),
                Some(&code),
            ),
        )
        .unwrap();
        expected[index] = (changed, saved.revision);
        for (peer, (connection, revision)) in profiles.iter().copied().zip(&expected) {
            let reopened = status(&root.0, peer, "workspace", true, &secrets).unwrap();
            assert!(reopened.connection == *connection);
            assert_eq!(&reopened.revision, revision);
            assert_eq!(reopened.state, "configured");
        }
        let store = Storage::open(
            &root.0,
            &configuration_key("workspace", profile).unwrap(),
            false,
        )
        .unwrap()
        .unwrap();
        let metadata = read(&store, "workspace").unwrap().unwrap();
        let password_account = account(
            &root.0,
            profile,
            "workspace",
            metadata.password_ref.as_deref().unwrap(),
            "password",
        );
        let key_account = account(
            &root.0,
            profile,
            "workspace",
            metadata.key_ref.as_deref().unwrap(),
            "key",
        );
        assert_eq!(
            secrets.get(&password_account).unwrap().unwrap().as_str(),
            password
        );
        assert_eq!(secrets.get(&key_account).unwrap().unwrap().as_str(), code);
    }
    assert_eq!(
        configuration_key("workspace", None).unwrap(),
        workspace_key("workspace").unwrap()
    );
    let personal = root
        .0
        .join("notes-sync")
        .join(workspace_key("workspace").unwrap())
        .join("current.json");
    assert!(personal.is_file());
}

#[test]
fn named_configuration_never_falls_back_to_personal_or_another_name() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    save(
        &root.0,
        None,
        "workspace",
        true,
        &secrets,
        request(
            connection(),
            None,
            Some("personal-password"),
            Some(&SyncKey::generate().1),
        ),
    )
    .unwrap();
    let before_reads = secrets.reads.get();
    let named = status(&root.0, Some("test-a"), "workspace", true, &secrets).unwrap();
    assert_eq!(named.state, "unconfigured");
    assert!(
        named.revision.is_none()
            && named.connection.endpoint.is_empty()
            && named.connection.username.is_empty()
    );
    assert_eq!(secrets.reads.get(), before_reads);
    save(
        &root.0,
        Some("test-a"),
        "workspace",
        true,
        &secrets,
        request(
            connection(),
            None,
            Some("named-password"),
            Some(&SyncKey::generate().1),
        ),
    )
    .unwrap();
    let before_reads = secrets.reads.get();
    let peer = status(&root.0, Some("test-b"), "workspace", true, &secrets).unwrap();
    assert_eq!(peer.state, "unconfigured");
    assert!(peer.revision.is_none() && peer.connection.endpoint.is_empty());
    assert_eq!(secrets.reads.get(), before_reads);
    assert_eq!(
        status(&root.0, None, "workspace", true, &secrets)
            .unwrap()
            .state,
        "configured"
    );
}
