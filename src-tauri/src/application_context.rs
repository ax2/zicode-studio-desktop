/// Expand the context macro once per binary: macOS emits an embedded Info.plist
/// symbol at each expansion, including calls used by the headless worker.
pub(crate) fn create() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

/// Keep local debug and isolated acceptance processes out of the installed
/// application's single-instance namespace.
pub(crate) fn create_desktop() -> tauri::Context<tauri::Wry> {
    use sha2::{Digest, Sha256};

    let mut context = create();
    let mut identifier = context.config().identifier.clone();
    if cfg!(debug_assertions) && !crate::desktop_profile::is_isolated() {
        identifier.push_str(".dev");
    }
    if let Some(root) = crate::desktop_profile::root() {
        let digest = Sha256::digest(root.to_string_lossy().as_bytes());
        let hash = format!("{digest:x}");
        identifier.push_str(".isolated.");
        identifier.push_str(&hash[..12]);
    }
    context.config_mut().identifier = identifier;
    context
}

#[cfg(test)]
mod tests {
    #[test]
    fn debug_identity_differs_from_installed_identity() {
        let context = super::create_desktop();
        if cfg!(debug_assertions) {
            assert!(context.config().identifier.ends_with(".dev"));
            assert_ne!(
                context.config().identifier,
                super::create().config().identifier
            );
        }
    }
}
