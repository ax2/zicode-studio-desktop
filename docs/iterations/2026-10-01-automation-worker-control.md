# 无窗口自动化进程控制与日志（2026-10-01）

## 目标与发现

无窗口入口已有显式启动命令，但 Windows 发布构建采用 GUI 子系统，可能没有可用控制台；只监听 Ctrl+C 不足以正常停止。该进程也没有 Tauri 日志插件，启动失败和自动化告警可能不可见。

## 修改与决策

- 新增用户级 `automation-worker.lock` 操作系统文件锁，同一用户只能运行一个无窗口 worker；它与自动化任务的 `automation-runner.lock` 分开，桌面进程仍能与 worker 并存并等待执行权。
- 新增显式 `--zicode-automation-worker-stop` 命令。命令先核对 worker 锁确实被其他进程持有，再以独占创建的普通文件写入停止请求。worker 每秒检查一次，收到请求后走现有 Host 取消、退出等待和 Pi 子进程停止路径；不按 PID 强杀。worker 启动时清理上次崩溃留下的普通停止请求，锁文件长期保留。
- worker 和停止命令把 Info 及以上日志写入本机 `zicode/logs/automation-worker.log`。单条消息限制为 4 KiB，文件达到 1 MiB 时截断；Unix 文件权限设为 `0600`。日志不记录控制令牌或完整凭据。

## 验证与遗留

`bun run check:rust:static` 退出 0，包含 Cargo check 和以警告为错误的 Clippy；仓库级格式检查仍报告已有格式漂移。新增 worker 控制、日志和入口文件的目标 `rustfmt --check` 通过。未运行测试或实机启动与停止。停止命令目前仍需用户显式调用，桌面 UI 尚未提供启动、状态与停止控制；开机启动、Windows 无控制台信号行为、三平台文件锁与进程交接仍待验收。

检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18,936 个构建文件、约 3.2 GiB。

后续已加入自动化中心的主动启动、状态和停止入口，见[桌面控制日志](2026-10-01-automation-desktop-control.md)。
