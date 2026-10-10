# 自动化更新失败恢复与后台启动隔离（2026-10-01）

## 目标与发现

上轮在应用更新前停止无窗口 worker，并用跨进程锁阻止其重新启动。若下载、安装或应用重启失败，原先正在运行的 worker 会保持停止，计划任务无法继续由后台进程承接。另一个启动路径问题是无窗口 Host 与桌面 Host 共用初始化函数，会尝试执行一次性旧会话迁移；worker 与桌面并存时可能同时迁移同一批文件。

## 修改与决策

- 取得更新锁时记住 worker 是否正在运行或停止。安装失败时先释放更新锁，再仅对原先运行的 worker 尝试启动；原先停止的 worker 保持停止。
- Beta 安装错误由 Rust 命令直接执行上述恢复；常规更新在前端安装或重启失败后调用原生结束命令。正常重启仍由进程退出释放更新锁。
- 旧会话迁移只由桌面 Host 执行。无窗口 worker 保留注册项目读取、调度和受限插件 Broker，但不再移动用户会话文件。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react` 和更新 Store 的目标 Biome lint 退出 0；仓库检查仍报告既有非阻断警告。`bun run check:rust:static` 退出 0，包含 Cargo check 和严格 Clippy；新增 worker 模块的目标 `rustfmt --check` 通过，仓库级格式检查仍有既有漂移。未运行测试、实际更新或三平台进程验收。

静态检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18,939 个检查文件、约 3.2 GiB。

恢复启动器最多观察两秒，可能返回 `starting`；若启动随后失败，仍需用户从自动化中心查看状态。成功更新并重启后主动恢复原先 worker 的持久意图尚未实现；更新产物当前仍关闭。

后续加入成功更新或进程中断后的单次恢复标记，见[更新后恢复日志](2026-10-01-automation-update-resume.md)。
