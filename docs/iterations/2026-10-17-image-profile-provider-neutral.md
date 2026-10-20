# Stage：图片资源执行协议解除提供方 ID 耦合（2026-10-17）

## 目标与发现

Studio 的 `resource.wasi.image.resize.v1@1.0.0-preview.1` 已按能力授予资源输入、
WASI 预算和结果边界，但 manifest 准入还要求能力 ID 必须是
`devtools.image.resize`。这会阻止其他符合相同协议的插件使用 Host profile。

## 修改

- 去除 Host 中固定的 DevTools 图片能力 ID 校验。每个插件恰好一个能力可声明此
  profile；该能力须声明 `outputSchema`，且不得自报 `resourceInputMax`。
- 版本、资源输入/输出 framing、`resource.read`、单图 MIME/大小、Worker 并发、
  fuel、内存、超时、取消及输出登记边界不变。
- 更新预览协议文档，并在 manifest 定向用例中覆盖其他提供方 ID、缺失 schema
  和重复声明。

## 验证

- `bun run check:rust:static` 退出 0：all-targets check 和 Clippy 通过；
  `cargo fmt --check` 报已有格式漂移，仅作 advisory。
- `RUST_TEST_THREADS=2 cargo test --manifest-path src-tauri/Cargo.toml
  image_resize_execution_profile_is_capability_scoped_and_fully_negotiated -- --nocapture`：
  1 passed、0 failed。
- 工作前后只读存储扫描：`target` 从 29,399,231,464 B 到 29,399,678,867 B，
  增加 447,403 B；task-scratch 均为 838,287,896 B。没有删除缓存或重试此前被
  审批策略拒绝的清理。

## 遗留与验收边界

本次验证只覆盖 manifest 协商和编译检查；没有新增真实提供方包、桌面截图、
保存或跨工具执行证据。DevTools 154 项、ZiFile 108 个平台/功能格仍为 0 接受。
签名包、目标系统内存、完整原生运行和跨平台验收继续待补。
