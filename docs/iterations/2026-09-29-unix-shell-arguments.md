# 2026-09-29 Unix 项目终端 Shell 参数

## 目标与发现

- 项目终端允许使用宿主 `SHELL` 指向的可执行程序，但原实现给所有未识别 Shell 都传入 `-i`。
- 不同 Shell 的选项语法不同。可执行文件可被选中，不代表它接受 POSIX 风格的 `-i`。

## 修改与决策

- Bash、Zsh、Fish、PowerShell 7 继续使用已有专属参数；已知支持 `-i` 的 sh/dash/ash/ksh/mksh/csh/tcsh 明确列出。
- 其他可执行 Shell 不附加选项，在 PTY 中按其自身规则启动。宿主 `SHELL` 缺失或不可执行时仍回退 `/bin/sh`。
- 中英文帮助与平台进度同步说明该边界。

## 验证与遗留

- 静态核对 Shell 参数分支和终端创建调用链；`rustfmt --edition 2021 --config skip_children=true --check src-tauri/src/project_terminal/process.rs` 通过。
- 未运行测试、Rust 编译或 macOS/Linux 真实 PTY；未知 Shell 可能自行选择非交互模式，需在目标平台确认。
- 仅更新本地工作树，未发布。
