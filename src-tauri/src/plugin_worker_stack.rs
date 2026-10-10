//! Keep enough native stack for Wasmtime to return its bounded guest-stack trap.
pub(super) fn execute<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    std::thread::Builder::new()
        .name("plugin-wasi".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(work)
        .map_err(|_| "Cannot start WASI execution thread".to_string())?
        .join()
        .map_err(|_| "WASI execution failed".to_string())?
}
