# 自动化后台进程与应用更新交接（2026-10-01）

## 目标与发现

独立的无窗口自动化 worker 使用已安装的应用可执行文件。Windows 更新安装时，该进程可能占用旧 EXE；macOS 和 Linux 更新后也可能留下继续运行的旧版 worker。现有更新有 Beta Rust 命令和常规 Tauri updater 前端入口，两者此前均未等待 worker 退出。

## 修改与决策

- worker 运行期间持有跨进程共享更新锁；安装方先发送本地停止请求，再等待取得独占更新锁并确认 worker 单实例锁已释放，最长等待 20 秒。请求失败或超时会取消安装。独占锁阻止其他桌面实例在安装期间重新运行 worker。
- 桌面启动器也在启动子进程前取得共享更新锁，并持有至观察到 worker 启动或失败；安装锁已被占用时直接拒绝启动，不再产生无用子进程。
- Beta 安装命令在发现可用更新之后、下载和安装之前取得更新锁。常规更新入口在 `downloadAndInstall` 前调用原生命令。锁由原生进程保存至安装完成后的应用重启；安装失败或重启调用返回时由同一工作区窗口释放，进程退出也会由 OS 释放。旧运行环境缺少命令接口时保留原有更新行为。
- 停止仍由 worker 自行关闭 Host 和 Pi；更新流程不按 PID 强制结束进程。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react` 和针对更新 Store 的 Biome lint 均退出 0。仓库检查仍报告既有的非阻断警告。`bun run check:rust:static` 退出 0，包含 Cargo check 和以警告为错误的 Clippy；仓库级格式检查仍报告已有格式漂移。未运行测试或真实安装，也未做三平台升级验收。

检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18,939 个构建文件、约 3.2 GiB，避免静态检查产物继续占据项目磁盘空间。

跨进程锁与真实安装还未做 Windows、macOS 和 Linux 实机竞争验收。启动器观察超过两秒仍未确定启动结果时会返回 `starting` 并释放其共享锁；极慢启动下仍需实机检验安装与子进程取得锁的交接。自动更新产物当前仍关闭。

后续补充安装失败时恢复先前运行的 worker，并让无窗口 Host 跳过一次性会话迁移，见[更新失败恢复日志](2026-10-01-automation-update-recovery.md)。
