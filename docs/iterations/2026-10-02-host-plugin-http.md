# Rust Host 插件运行时接口验证

日期：2026-10-02。状态：Windows 实际 Host HTTP 用例与静态检查通过；其他平台运行待补。

## 目标与当前实现

前一轮仅通过真实 Pi 与模拟 HTTP 服务验证打包 JavaScript 桥接。本轮新增真实 Rust Host 本机 HTTP 用例，使用独立临时数据库与笔记文件、内存运行时，调用正式 `/v2/plugin-tools/invoke` 路由。

覆盖缺少/错误身份、错误会话、合法笔记搜索、插件关闭后重新检查授权、运行时停止和身份过期。调用身份由正式配置函数生成，存储侧核对只保留哈希；不记录身份值。内存运行时不代表真实 Pi 子进程。

## 验证结果

新增 `host_server::plugin_broker_tests::runtime_plugin_http_enforces_identity_expiry_liveness_and_current_grants` 在本机实际启动 Host HTTP 服务，通过合法笔记搜索及六组拒绝边界；格式整理后再次执行通过。既有 `host_server::tests::lists_and_invokes_authorized_capabilities_through_the_host_api` 也通过。

`bun run check:rust:static` 全目标编译与严格 Clippy 通过，仓库既有格式漂移继续作为 advisory；新增测试文件已单独格式化。新用例未标记 ignored，默认 Rust 测试与跨平台统一入口会执行。

执行时仅为进程设置无调试符号与无增量编译参数。完成后 `cargo clean --manifest-path src-tauri/Cargo.toml` 回收 22,651 个文件、工具报告 4.7 GiB，根目录 target 不存在；E 盘空闲约 60.72 GiB。

## 范围与后续

服务端路由与笔记执行是真实实现，Pi 运行时使用内存替身；没有把真实 Pi 与此 Host 连在一起，也未验证 WebView、外部账户或其他平台。后续仍需补完整 Pi→Host 调用、真实插件动作和三平台安装运行。未发布或修改外部服务，档案不保存调用身份。
