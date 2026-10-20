//! Stable execution failure classes; never expose guest stack traces or reports.
pub(crate) fn execution(error: &wasmtime::Error) -> &'static str {
    use wasmtime::Trap;
    match error.downcast_ref::<Trap>() {
        Some(Trap::OutOfFuel) => "WASI fuel exhausted",
        Some(Trap::MemoryOutOfBounds) => "WASI memory access rejected",
        Some(Trap::StackOverflow) => "WASI stack budget exhausted",
        Some(_) => "WASI execution trapped",
        None if error.downcast_ref::<wasmtime_wasi::I32Exit>().is_some() => {
            "WASI module exited unsuccessfully"
        }
        None => "WASI execution failed",
    }
}

pub(crate) fn public(message: Option<&str>) -> (&'static str, &'static str) {
    match message {
        Some("WASI fuel exhausted") => (
            "worker_fuel_exhausted",
            "Plugin computation budget exhausted",
        ),
        Some("WASI memory access rejected") => {
            ("worker_memory_trap", "Plugin memory access rejected")
        }
        Some("WASI stack budget exhausted") => {
            ("worker_stack_exhausted", "Plugin stack budget exhausted")
        }
        Some("WASI execution trapped") => ("worker_trapped", "Plugin execution trapped"),
        Some("WASI module exited unsuccessfully") => {
            ("worker_exit_failed", "Plugin exited unsuccessfully")
        }
        _ => ("worker_failed", "Plugin Worker execution failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_budget_traps_and_never_forwards_unknown_messages() {
        for (trap, expected) in [
            (wasmtime::Trap::OutOfFuel, "worker_fuel_exhausted"),
            (wasmtime::Trap::MemoryOutOfBounds, "worker_memory_trap"),
            (wasmtime::Trap::StackOverflow, "worker_stack_exhausted"),
            (wasmtime::Trap::UnreachableCodeReached, "worker_trapped"),
        ] {
            assert_eq!(public(Some(execution(&trap.into()))).0, expected);
        }
        assert_eq!(
            public(Some("private guest path, report, token")),
            public(None)
        );
        assert_eq!(
            public(Some(execution(&wasmtime_wasi::I32Exit(2).into()))).0,
            "worker_exit_failed"
        );
    }

    #[test]
    fn real_wasi_execution_has_stable_budget_memory_stack_and_exit_classes() {
        use super::super::{execute_wasi, WorkerRequest};
        let scratch =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("worker-failure-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("owner.json"),
            br#"{"purpose":"real WASI failure classification"}"#,
        )
        .unwrap();
        for (index, (wat, expected)) in [
            ("(module (func (export \"_start\") (loop br 0)))", "worker_fuel_exhausted"),
            ("(module (memory 1) (func (export \"_start\") i32.const 65536 i32.load drop))", "worker_memory_trap"),
            ("(module (func $r call $r) (func (export \"_start\") call $r))", "worker_stack_exhausted"),
            ("(module (import \"wasi_snapshot_preview1\" \"proc_exit\" (func $exit (param i32))) (memory (export \"memory\") 1) (func (export \"_start\") i32.const 2 call $exit))", "worker_exit_failed"),
        ].into_iter().enumerate() {
            let path = root.join(format!("{index}.wasm"));
            std::fs::write(&path, wat).unwrap();
            let result = execute_wasi(&WorkerRequest {
                worker_path: path.to_string_lossy().into_owned(), worker_kind: "wasi".into(),
                plugin_id: "test.failure".into(), capability_id: Some("test.failure".into()),
                command_id: None, execution_profile: None,
                scene_id: "programming".into(), input: serde_json::json!({}),
            });
            assert_eq!(public(Some(&result.unwrap_err())).0, expected);
        }
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
