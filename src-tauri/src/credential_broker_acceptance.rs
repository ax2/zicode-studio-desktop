//! Opt-in read-only acceptance against the selected personal profile.
//! Never run against a user's vault as part of the ordinary test suite.
#[test]
#[ignore = "Requires explicit authorization to read the selected personal model credentials"]
fn selected_personal_credentials_are_available_and_image_keys_stay_out_of_pi() {
    assert_eq!(
        std::env::var("ZICODE_VERIFY_PERSONAL_CREDENTIALS").as_deref(),
        Ok("1")
    );
    crate::desktop_profile::initialize([]).unwrap();
    assert!(crate::desktop_profile::root().is_some());
    assert!(crate::desktop_profile::system_credentials_enabled());
    assert!(!crate::desktop_profile::requires_explicit_argument());
    let root = crate::app_paths::system_root().unwrap();
    let index = super::read_index(&root).unwrap();
    let chat = super::scene_provider_credentials(&root, "programming").unwrap();
    assert!(chat
        .iter()
        .any(|(provider, secret)| provider == "tencent-token-plan" && !secret.is_empty()));
    assert!(chat
        .iter()
        .all(|(provider, _)| !provider.starts_with("visual-images-")));
    let images: Vec<_> = index
        .entries
        .iter()
        .filter(|entry| entry.scene_id.starts_with("visual-creation-"))
        .collect();
    assert!(!images.is_empty());
    for entry in images {
        assert!(
            super::model_tool_credential(&entry.scene_id, &entry.provider)
                .unwrap()
                .is_some_and(|secret| !secret.is_empty())
        );
    }
}
