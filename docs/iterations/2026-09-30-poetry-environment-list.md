# Poetry 多环境列表交接（2026-09-30）

## 目标与发现

已有 `poetry env info --path` 只给出当前选中的一个环境。普通 Python 命令及新终端虽可显式使用已有 venv，但用户需要自行查找其他 Poetry 环境路径。Poetry CLI 提供 `poetry env list --full-path`，适合作为用户主动运行的固定项目命令。

## 修改与决策

- Poetry 项目任务目录新增固定 `poetry env list --full-path`，沿用项目目录、工具路径、运行记录和停止机制；任务指纹版本更新，使旧运行结果不会被新目录误用。
- 开发环境页只读取当前 Host 会话、同一工作区与子目录的最近一次列表运行。最近一次失败、历史摘要、输出截断、超过 64 行或不符合绝对路径格式时，不回退更早结果。
- 展示候选前重新读取任务目录，要求固定任务仍可运行且指纹与运行记录相同。选中仅填写草稿；保存后 Host 再验证标准 venv 或 Conda prefix。
- 不自动运行 Poetry。Poetry CLI 及已安装插件的执行由用户从项目命令明确启动；重启 Host 后需重新查询列表。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react`、`cargo check --all-targets`、`cargo clippy --all-targets` 与修改模块的 `rustfmt --check` 均通过。未运行测试或真实 Poetry 查询，Windows、macOS、Linux 的输出格式和环境选择仍待实机验证。列表输出不证明环境包完整或可运行项目命令。
