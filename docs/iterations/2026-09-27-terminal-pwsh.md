# 2026-09-27 Windows 项目终端 Shell 选择

状态：本轮实现与静态检查完成；终端实机验收待办。

## 目标与发现

- 项目 PTY 终端此前在 Windows 固定启动 Windows PowerShell 5.1，即使标准路径已安装 PowerShell 7。现代开发者常用 `pwsh`，其跨平台命令体验更一致。
- Host 只检查 `ProgramFiles/PowerShell/7/pwsh.exe`，校验实际文件位于该安装根目录内；找到时优先使用，缺失时沿用系统 Windows PowerShell。Shell 仍由 Host 决定，不接受前端传入任意可执行路径。
- 两种 PowerShell 均沿用无 Profile 启动与既有控制台处理、进程组和 PTY 生命周期逻辑。会话返回实际 Shell 文件名供界面展示。

## 工作记录

- 修改 Windows Shell 选择：优先标准 `ProgramFiles/PowerShell/7/pwsh.exe`，路径校验失败或文件缺失时沿用原有 Windows PowerShell 路径。终端的目录、无 Profile 参数和生命周期代码保持原有流程。
- 同步中英文帮助与开发者平台计划；没有新增前端控制或用户配置。

## 验证记录

- 当前 Windows 主机只读检查确认标准位置的 `pwsh.exe` 与系统 Windows PowerShell 均存在。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets`：通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict`：通过；旧页面未列入导航的提示仍存在。
- `git -c core.safecrlf=false diff --check`：通过。
- 本轮未新增或运行测试，也未启动真实 PTY 会话。PowerShell 7 的初始输出、控制台处理、键盘与停止回收，以及 macOS/Linux 行为仍需实机验收。

## 遗留与发布

- 非标准安装位置的 PowerShell 7 不会被自动选择；将来需要提供用户可查看、可选择的 Shell 配置，并验证不同系统的生命周期。
- 本轮仅保存本地源码和文档；未提交、推送或发布。
