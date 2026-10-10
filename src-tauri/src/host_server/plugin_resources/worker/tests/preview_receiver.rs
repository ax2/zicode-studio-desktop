//! Studio-owned receiver fixture, independent of frozen DevTools packages.
use super::*;

pub(super) fn install(host: &HostServer, root: &std::path::Path, template: &Value) {
    let package = root.join("preview-receiver-package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    let id = "com.zicode.studio.preview-receiver";
    let mut manifest = template.clone();
    manifest["id"] = json!(id);
    manifest["displayName"] = json!("资源接收验证");
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
    manifest["contributes"] = json!({"capabilities":[{
        "id":"resource.receive","title":"接收输出示例",
        "inputSchema":{"type":"object","properties":{
            "label":{"type":"string","title":"结果标签"},
            "count":{"type":"integer","title":"数量","minimum":0},
            "flag":{"type":"boolean","title":"保留标记"}},"additionalProperties":false},
        "outputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}
    }]});
    std::fs::write(package.join("plugin.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    // Consume bytes through the resource ABI. This is transport evidence, not an image algorithm.
    std::fs::write(package.join("runtime/tools.wasm"), r#"(module
      (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
      (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 1) (data (i32.const 1024) "{\22text\22:\22received\22}")
      (func (export "_start")
        i32.const 0 call $size i64.const 0 i64.le_u if unreachable end
        i32.const 0 i64.const 0 i32.const 0 i32.const 1 call $read i32.const 1 i32.ne if unreachable end
        i32.const 2048 i32.const 1024 i32.store i32.const 2052 i32.const 19 i32.store
        i32.const 1 i32.const 2048 i32.const 1 i32.const 2060 call $json drop))"#).unwrap();
    let mut registry = host.state.plugins.lock().unwrap();
    registry.install_developer(&package).unwrap();
    registry.set_enabled("programming", id, true).unwrap();
    registry.set_permission("programming", id, "resource.read", true).unwrap();
}
