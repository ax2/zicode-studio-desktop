/// Expand the context macro once per binary: macOS emits an embedded Info.plist
/// symbol at each expansion, including calls used by the headless worker.
pub(crate) fn create() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}
