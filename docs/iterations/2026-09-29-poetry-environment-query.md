# 2026-09-29 Poetry 环境查询

状态：实现与静态检查完成；真实 Poetry 运行验收待补。

## 目标与发现

开发环境页只在项目外探测 Poetry CLI 版本，不能说明 Poetry 对当前项目实际选择了哪个虚拟环境。直接在页面读取时运行 `poetry env info` 会加载 Poetry 及其插件，因此沿用此前的只读边界。

## 修改与决策

- 对有效 `pyproject.toml` 中声明 Poetry 的目录，新增固定任务 `poetry env info --path`。该任务继承现有 Poetry 工具选择、Python 激活隔离、目录边界、任务状态和运行历史。
- 开发环境页提示用户在项目任务中主动运行该命令。查询结果保留在任务输出与历史，不将其误标为自动发现或已验证的 Python 解释器。
- 更新中英文帮助与开发平台进度。任务清单指纹升至 `poetry-tasks-v2`，避免旧清单与新命令混用。

## 验证与风险

`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、目标文件 Rustfmt、`bun run typecheck`、`bun run check`、翻译覆盖检查与目标 Git 差异空白检查通过。`bun run check` 仍报告仓库其他位置的既有提示；全仓库 Rustfmt 仍报告其他文件的格式差异。本轮未运行测试或真实 Poetry 命令。Poetry CLI 可能加载用户安装的插件；用户运行时也可能因未创建环境而得到空路径或错误。Windows、macOS、Linux 的实际输出和副作用尚未验收。
