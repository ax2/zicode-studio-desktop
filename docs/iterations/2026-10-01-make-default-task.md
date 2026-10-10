# GNU Make 默认目标接入（2026-10-01）

状态：本地代码已接入；真实 Windows、macOS、Linux 项目运行待验收。

## 目标与发现

项目任务目录已支持多种语言和构建工具，但只有 Makefile 的项目没有可选任务。GNU Make 的默认目标无需推断任意规则名，适合作为固定的显式运行入口。

## 修改与决策

- 在所选子项目目录中按 GNU Make 的 `GNUmakefile`、`makefile`、`Makefile` 优先级读取第一个存在的文件，使用现有工作区路径和 256 KiB 文件大小边界。只提供一项 `make` 默认目标；不解析、预览或自动执行规则。来源文件不可读、越界或过大时只将该任务标为不可运行，其他任务继续显示。
- 来源文件内容进入任务指纹，点击运行前仍会重新读取目录并比较指纹。执行继续通过 Host 的工具目录、有效 PATH、子进程限额、停止和运行历史流程。
- Make 不是随 Windows 安装包提供的内置工具；没有可用 CLI 时，点击运行会得到工具缺失错误。帮助说明默认目标可能执行任何项目自定义动作，运行前需要用户查看文件。
- 开发环境报告加入三种 Make 文件名和 `make --version` 只读 CLI 探测，工具查找复用项目有效 PATH；前端将 Make CLI 与当前 Make 清单分组。版本探测在临时目录中运行，不触发项目规则。

## 验证与遗留

接入默认任务与环境诊断后，分别运行 `bun run check:rust:static`，两次均退出 0，包含 Windows Cargo check 与以 warning 为错误的 Clippy；全仓 rustfmt 仍提示既有测试模块格式漂移。目标 Rust 文件在跳过子模块的格式检查中通过，`bun run typecheck`、`bun run check`、目标前端文件格式检查及修改文件的 `git diff --check` 通过。每轮静态检查后均运行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 各报告移除 18,951 个文件、约 3.3 GiB 可再生编译产物。未新增或运行测试；三平台实际 Make 工程、文件变更时的任务刷新和 Windows Make 可用性仍待验收。
