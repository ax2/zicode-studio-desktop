use super::*;

pub(in crate::host_server) fn create_receiver(
    source: &std::path::Path,
    receiver: &std::path::Path,
) {
    fn copy_tree(source: &std::path::Path, destination: &std::path::Path) {
        std::fs::create_dir_all(destination).unwrap();
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let target = destination.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &target);
            } else {
                std::fs::copy(entry.path(), target).unwrap();
            }
        }
    }
    copy_tree(source, receiver);
    // The frozen provider contract pins pluginId in the WASI binary. Patch only
    // equal-length identity bytes in this derived test copy; never the frozen source.
    let module_path = receiver.join("runtime/tools.wasm");
    let mut module = std::fs::read(&module_path).unwrap();
    let original = b"com.zicode.devtools.text";
    let replacement = b"com.zicode.devtools.echo";
    let positions: Vec<_> = module
        .windows(original.len())
        .enumerate()
        .filter_map(|(index, bytes)| (bytes == original).then_some(index))
        .collect();
    assert!(!positions.is_empty(), "Frozen fixture identity changed");
    for position in positions {
        module[position..position + original.len()].copy_from_slice(replacement);
    }
    std::fs::write(module_path, module).unwrap();
    let mut manifest: Value =
        serde_json::from_slice(&std::fs::read(receiver.join("plugin.json")).unwrap()).unwrap();
    manifest["id"] = json!("com.zicode.devtools.echo");
    std::fs::write(
        receiver.join("plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
}
