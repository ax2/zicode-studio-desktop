//! Runtime declarations must never imply an execution engine the Host ignores.
use serde_json::Value;

pub(crate) fn validate(runtime: &Value) -> Result<(), String> {
    if runtime.is_null() {
        return Ok(());
    }
    let fields = runtime
        .as_object()
        .ok_or("runtime must be an object or omitted")?;
    for (name, value) in fields {
        if matches!(name.as_str(), "native" | "executable" | "nativeWorker") {
            return Err("Native plugin runtime is not supported: requires versioned resource mediation, platform confinement and lifecycle acceptance; standalone executables are not plugin Workers".into());
        }
        if !matches!(
            name.as_str(),
            "worker" | "wasi" | "resourceInputProfile" | "resourceOutputProfile"
        ) {
            return Err(format!("Unsupported runtime field: {name}; runtime declarations require explicit Host support"));
        }
        if !value.is_string() {
            return Err(format!("runtime.{name} must be a string"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_unsupported_native_and_unknown_engines() {
        for name in ["native", "nativeWorker", "executable"] {
            assert!(validate(&json!({(name): {"entry":"worker.exe"}}))
                .unwrap_err()
                .contains("Native plugin runtime is not supported"));
            assert!(validate(&json!({(name): "worker.exe", "wasi":"fallback.wasm"})).is_err());
        }
        for value in [
            json!({"wasm":"tools.wasm"}),
            json!({"worker":"tools.js","typo":"ignored"}),
        ] {
            assert!(validate(&value)
                .unwrap_err()
                .contains("Unsupported runtime field"));
        }
    }

    #[test]
    fn accepts_only_explicit_existing_runtime_shapes() {
        for value in [
            Value::Null,
            json!({}),
            json!({"worker":"worker.js"}),
            json!({"wasi":"tools.wasm"}),
            json!({"wasi":"tools.wasm","resourceInputProfile":"resource.wasi.input.draft2","resourceOutputProfile":"resource.wasi.output.draft1"}),
        ] {
            validate(&value).unwrap();
        }
        for value in [
            json!("worker.exe"),
            json!([]),
            json!({"worker":null}),
            json!({"wasi":3}),
            json!({"resourceInputProfile":true}),
        ] {
            assert!(validate(&value).is_err());
        }
    }
    #[test]
    fn runtime_admission_rejects_before_install_and_preserves_other_plugins() {
        use crate::plugin_package::write_test_signed_package;
        use crate::plugin_registry::PluginRegistry;
        use std::fs;
        let root =
            std::env::temp_dir().join(format!("zicode-native-admission-{}", uuid::Uuid::new_v4()));
        let packages = root.join("packages");
        let source = packages.join("developer");
        fs::create_dir_all(&source).unwrap();
        let mut manifest = json!({"schemaVersion":1,"id":"com.example.native-admission","name":"Admission fixture","description":"Synthetic runtime admission fixture","version":"1.0.0","publisher":"example","runtime":{"native":{"entry":"worker.exe"}},"contributes":{}});
        fs::write(
            source.join("plugin.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let mut registry = PluginRegistry::open(root.join("registry")).unwrap();
        let before = registry.list("programming").len();
        assert!(registry
            .install_developer(&source)
            .unwrap_err()
            .contains("Native plugin runtime is not supported"));
        assert!(!root
            .join("registry/developer/com.example.native-admission")
            .exists());
        let signed = write_test_signed_package(&packages, &manifest, "native.zicode-plugin");
        assert!(registry
            .preview_signed(&signed)
            .unwrap_err()
            .contains("Native plugin runtime is not supported"));
        assert!(registry
            .install_signed(&signed, true)
            .unwrap_err()
            .contains("Native plugin runtime is not supported"));
        assert!(!root.join("registry/trust/publishers.json").exists());
        assert!(!root
            .join("registry/signed/com.example.native-admission")
            .exists());
        assert_eq!(registry.list("programming").len(), before);
        manifest["runtime"] = json!({});
        fs::write(
            source.join("plugin.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        registry.install_developer(&source).unwrap();
        assert_eq!(registry.list("programming").len(), before + 1);
        let bad = root.join("registry/developer/com.example.invalid-runtime");
        fs::create_dir_all(&bad).unwrap();
        manifest["id"] = json!("com.example.invalid-runtime");
        manifest["runtime"] = json!({"native":"worker.exe"});
        fs::write(
            bad.join("plugin.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        registry.reload_developer_plugins().unwrap();
        assert_eq!(registry.list("programming").len(), before + 1);
        assert!(registry
            .diagnostics()
            .iter()
            .any(|d| d.code == "manifest_invalid"
                && d.message.contains("Native plugin runtime is not supported")));
        drop(registry);
        assert!(root
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("zicode-native-admission-"));
        fs::remove_dir_all(root).unwrap();
    }
}
