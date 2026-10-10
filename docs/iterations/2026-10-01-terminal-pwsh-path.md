# Windows 项目终端识别 PATH 中的 PowerShell 7（2026-10-01）

## 目标与发现

项目终端此前只在标准 `ProgramFiles/PowerShell/7/pwsh.exe` 查找 PowerShell 7。通过其他目录安装且已加入 PATH 的 `pwsh.exe` 会被忽略，终端回退到 Windows PowerShell 5.1。项目终端是开发者个人平台的核心入口，Shell 选择应兼容这些安装方式。

## 修改与决策

- 保留标准安装目录优先级；未找到时顺序检查 Host PATH 中的绝对目录，只接受存在的 `pwsh.exe` 文件。相对 PATH 项不会成为隐式的项目目录执行入口。
- 两处均找不到 PowerShell 7 时仍回退系统 Windows PowerShell。终端协议、工作区目录校验、无 Profile 参数、PTY 与进程回收不变；客户端不能提供任意可执行路径。
- 中英文帮助及平台推进记录同步选择顺序。

## 验证与遗留

`bun run check:rust:static` 通过：`cargo check --all-targets` 和 Clippy 均通过；脚本报告仓库中仍有格式漂移，本轮修改的 `process.rs` 已单独运行 `rustfmt` 且格式检查通过。随后用 `cargo clean --manifest-path src-tauri/Cargo.toml` 清理静态检查产物，Cargo 报告移除 18945 个文件、约 3.3 GiB，仓库根目录 `target` 已消失。本轮未新增或运行测试。Windows 实际 PTY 启动、非标准安装目录的 PATH 选择、不同用户 PATH 顺序和终端停止回收仍需实机验收。macOS/Linux Shell 路径未改，真实会话验收仍待完成。
