//! Optional real-browser rendering against this actual HTTP Host and production Worker.
use super::*;
#[path = "preview_receiver.rs"]
mod receiver;

pub(super) async fn verify(
    host: &HostServer,
    root: &std::path::Path,
    target: &RuntimeTarget,
    template: &Value,
) -> Value {
    let Some(script) = std::env::var_os("ZICODE_PREVIEW_SCRIPT") else {
        return Value::Null;
    };
    let node = std::env::var_os("ZICODE_PREVIEW_NODE").expect("existing Node required");
    receiver::install(host, root, template);
    let package = root.join("preview-package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    std::fs::create_dir_all(package.join("views")).unwrap();
    let mut manifest = template.clone();
    let id = "com.zicode.studio.preview-fixture";
    manifest["id"] = json!(id);
    manifest["displayName"] = json!("输出预览验证");
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
    manifest["runtime"]["resourceOutputProfile"] =
        json!(crate::plugin_worker::resource_output::PROFILE);
    manifest["contributes"]["capabilities"][0]["title"] = json!("文件输出示例");
    manifest["contributes"]["capabilities"][0]["outputSchema"] = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
    manifest["contributes"]["views"] = json!([{"id":"preview.main","title":"输出预览验证","location":"main","entry":"views/main.html"}]);
    std::fs::write(
        package.join("plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(package.join("views/main.html"), r#"<!doctype html><html lang="zh-CN"><head><title>文件输出示例</title><style>body{font:16px system-ui;padding:16px;color:#172438;background:#f4f7fb}button{padding:8px 16px}p{line-height:1.5}</style></head><body><h2>文件输出示例</h2><p>选择并确认共享文件后，运行独立插件。结果由 Studio 按需预览。</p><button id="run" disabled>运行工具</button><p id="status" role="status">等待共享文件</p><script>
    zicode.resources.onAvailable(r=>{document.querySelector('#run').disabled=!r;});
    document.querySelector('#run').onclick=async()=>{try{const r=zicode.resources.getSelected();window.lastOutput=await zicode.resources.invoke({capabilityId:'resource.inspect',resourceId:r.resourceId,contentVersion:r.contentVersion,toolCallId:crypto.randomUUID(),input:{}});document.querySelector('#status').textContent='执行完成';}catch(e){document.querySelector('#status').textContent='执行失败';}};
    </script></body></html>"#).unwrap();
    // First input byte selects one of the protocol MIME enums; remaining bytes are copied.
    std::fs::write(package.join("runtime/tools.wasm"), r#"(module
      (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
      (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
      (import "zicode_resource_output_draft1" "create" (func $create (param i32 i64) (result i32)))
      (import "zicode_resource_output_draft1" "write" (func $write (param i32 i32 i32) (result i32)))
      (import "zicode_resource_output_draft1" "finish" (func $finish (param i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 2) (data (i32.const 65536) "{\22text\22:\22copied\22}")
      (func (export "_start") (local $length i32) (local $offset i32) (local $chunk i32)
        i32.const 0 call $size i32.wrap_i64 i32.const 1 i32.sub local.set $length
        i32.const 0 i64.const 0 i32.const 0 i32.const 1 call $read i32.const 1 i32.ne if unreachable end
        i32.const 0 i32.load8_u local.get $length i64.extend_i32_u call $create i32.const 0 i32.ne if unreachable end
        (block $done (loop $loop
          local.get $offset local.get $length i32.ge_u br_if $done
          local.get $length local.get $offset i32.sub local.tee $chunk i32.const 65536 i32.gt_u if i32.const 65536 local.set $chunk end
          i32.const 0 local.get $offset i32.const 1 i32.add i64.extend_i32_u i32.const 0 local.get $chunk call $read local.get $chunk i32.ne if unreachable end
          i32.const 0 i32.const 0 local.get $chunk call $write local.get $chunk i32.ne if unreachable end
          local.get $offset local.get $chunk i32.add local.set $offset br $loop))
        i32.const 0 call $finish i32.const 0 i32.ne if unreachable end
        i32.const 65600 i32.const 65536 i32.store i32.const 65604 i32.const 17 i32.store
        i32.const 1 i32.const 65600 i32.const 1 i32.const 65620 call $json drop))"#).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry.set_enabled("programming", id, true).unwrap();
        registry
            .set_permission("programming", id, "resource.read", true)
            .unwrap();
    }
    let mut command = crate::process_command::new_command(node);
    command
        .arg(script)
        .env("ZICODE_PREVIEW_HOST", host.origin())
        .env("ZICODE_PREVIEW_TOKEN", host.desktop_token())
        .env(
            "ZICODE_PREVIEW_TARGET",
            serde_json::to_string(target).unwrap(),
        )
        .env("ZICODE_PREVIEW_SAVE_WORKSPACE", root.join("save-workspace"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let (status, output) = tokio::task::spawn_blocking(move || {
        crate::plugin_capabilities::worker_process::run_observed(
            command,
            Vec::new(),
            Duration::from_secs(120),
            65536,
            None,
            None,
        )
    })
    .await
    .unwrap()
    .unwrap();
    assert!(
        status.success(),
        "browser verification failed; inspect its sanitized stage receipt"
    );
    serde_json::from_slice(&output).expect("browser verification receipt")
}
