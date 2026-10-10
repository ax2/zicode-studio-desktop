# 项目终端 Python 环境工作日志

## 目标与发现

项目命令会自动使用所选目录的 `.venv` 或 `.conda`，新终端此前只使用显式 Python 环境。开发者从同一子项目的命令区切到终端时，可能意外使用宿主 Python。

## 修改与决策

- 新终端在确认启动目录后沿用项目命令的本地环境发现规则：显式环境优先；否则当前目录 `.venv` 优先于 `.conda`。
- 将选中环境的可执行目录置于终端 PATH 前，设置 `VIRTUAL_ENV` 或 `CONDA_PREFIX`，清理继承的冲突激活变量；不运行激活脚本。
- 损坏、越界或不完整的本地环境阻止启动并显示修复提示，不静默切换宿主 Python。
- 终端会话记录实际启动时选中的环境路径。Shell 中后来手动切换目录或环境不会更新此记录；现有终端保持原环境。

## 验证

已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2539 个中文词条，缺失 0）、`bun run build:react`、`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。未运行测试或启动真实 PTY 终端。

## 遗留问题与风险

- 不自动发现项目外的 Poetry/Conda 环境；可使用已有的显式环境配置。
- 不执行 Conda 激活钩子及其配置变量，依赖钩子的项目仍需用户在终端中手动处理。
- Windows、macOS、Linux 的实际终端启动、路径和 Shell 行为尚待实机验收。

## 发布结果

本阶段仅更新本地工作区，没有发布或打包。
