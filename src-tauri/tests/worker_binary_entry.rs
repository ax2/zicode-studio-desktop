//! Forces Cargo's ordinary test gate to build the real desktop binary and
//! verifies that its isolated Worker entry is available on this platform.

#[test]
fn desktop_binary_accepts_the_worker_entry_without_starting_the_ui() {
    let executable = env!("CARGO_BIN_EXE_zicode-studio-desktop");
    let output = std::process::Command::new(executable)
        .arg("--zicode-plugin-worker")
        .output()
        .expect("start the desktop Worker entry");
    assert_eq!(output.status.code(), Some(1));
    let response: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("bounded Worker error response");
    assert_eq!(response["ok"], false);
    assert!(response["result"].is_null());
    assert!(response["error"].is_string());
}
