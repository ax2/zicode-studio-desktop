# 2026-09-29 Unix 项目终端 Shell 选择

状态：实现与当前 Windows 主机静态检查完成；Unix 编译与实机验收待补。

## 发现

项目终端此前只确认 Unix `SHELL` 是绝对路径的文件；不可执行文件会被当作 Shell，直到 PTY 启动失败。通用 `-i` 参数也会用于 PowerShell 7 登录 Shell，不能保证以预期方式启动。

## 修改

- Unix Shell 候选须有可执行权限；缺失、非普通文件或不可执行时回退 `/bin/sh`，最终目标仍经启动前检查。
- `pwsh` 使用 `-NoLogo -NoProfile -NoExit`；现有 bash、zsh、fish 参数保持不变。
- 更新中英文帮助与平台进度。

## 验证与风险

当前 Windows 主机上的 `cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、目标文件 Rustfmt 和目标差异空白检查通过。本轮未运行测试或真实 PTY。Windows 编译不能证明 macOS/Linux 分支已编译或真实 Shell 行为通过；非标准 Shell 仍使用通用 `-i` 参数，后续需实机检查。
