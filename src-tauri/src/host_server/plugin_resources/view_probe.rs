//! Optional real Chromium SDK + real Host acceptance; never production code.
use super::*;

pub(super) async fn run(
    host: &HostServer,
    target: &RuntimeTarget,
    access: &Value,
    root: &std::path::Path,
) {
    let Some(script) = std::env::var_os("ZICODE_TEST_RESOURCE_VIEW_PROBE") else {
        return;
    };
    let node =
        std::env::var_os("ZICODE_TEST_RESOURCE_NODE").expect("Explicit bundled Node path required");
    let mut command = crate::process_command::new_command(node);
    command
        .arg(script)
        .env("ZICODE_PROBE_HOST", host.origin())
        .env("ZICODE_PROBE_DESKTOP_TOKEN", host.desktop_token())
        .env(
            "ZICODE_PROBE_TARGET",
            serde_json::to_string(target).unwrap(),
        )
        .env("ZICODE_PROBE_ACCESS", access.to_string())
        .env("TEMP", root.join("browser-temp"))
        .env("TMP", root.join("browser-temp"));
    let output = tokio::task::spawn_blocking(move || command.output())
        .await
        .unwrap()
        .unwrap();
    // Do not include captured process output: it may contain transport details.
    assert!(
        output.status.success(),
        "Resource View probe failed; inspect its bounded evidence"
    );
}
