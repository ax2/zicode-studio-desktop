# Poetry 项目命令工作日志（2026-09-27）

## 目标与发现

现有 Python 命令识别 `pyproject.toml`，但只通过选定解释器运行普通 `python -m` 命令。Poetry 项目没有自己的固定命令，也无法在环境诊断中看到 Poetry CLI 状态。

## 本轮修改

- 用有界清单读取和 TOML 解析确认 `[tool.poetry]` 或 `poetry.core.masonry.api` 构建后端；无效 TOML 不生成 Poetry 专属命令，普通 Python 命令仍按原规则显示。
- 添加 `poetry check`、`poetry run python -m unittest discover`、`poetry run python -m pytest`、`poetry build` 固定命令。命令由 Host 任务运行器解析为固定 argv，保留工作区任务指纹、执行状态和历史。
- 环境页增加 Poetry CLI 的有界版本探测，沿用项目工具目录与宿主 PATH 选择规则；版本探测在项目外运行。
- 更新中英文帮助和开发者平台总览。

## 决策与风险

- Poetry 命令使用 Poetry 自己的环境选择；项目中显式选择的 Python 解释器仍用于普通 `python -m` 命令，不代替 Poetry 的环境解析。
- 固定命令没有自动安装 Poetry、依赖或虚拟环境，但用户显式运行 `poetry run` 时 Poetry 可能创建环境；`build` 会写产物，测试会运行项目代码。
- 仅识别当前命令目录的有效清单，不枚举外部 Poetry 环境，也不把存在 `poetry.lock` 当作 Poetry 声明。没有 Windows、macOS、Linux 的真实 Poetry 运行证据。

## 验证与发布

`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、Rustfmt 检查、`bun run typecheck`、`bun run check`、i18n 覆盖检查、严格文档构建和 Git 差异空白检查均通过。全局 lint 与设计检查仍报告仓库其他位置的既有提示。未运行测试、Poetry 命令或安装包发布。
