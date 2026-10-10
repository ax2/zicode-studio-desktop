# uv 项目命令与环境诊断（2026-09-30）

## 目标与现状

现有项目开发流程支持普通 Python 与 Poetry 固定命令，但 `uv` 项目没有独立命令或工具诊断。普通 Python 命令可能使用用户显式选择的 venv/Conda，而 uv 应自行决定项目环境。

## 修改与决策

- 当前子项目有有效 `pyproject.toml`，且存在普通文件 `uv.lock` 或 `[tool.uv]` 表时，目录增加固定的 `uv lock`、`uv sync`、unittest、pytest、`uv build` 命令。有锁文件时同步使用 `--locked`；测试命令使用 `uv run --no-sync`，不会由任务目录自动启动同步。
- `uv.lock` 不按普通小型清单读取，避免较大的锁文件突破 256 KiB 清单上限；只核对它是当前目录的普通文件。任务指纹记录是否有锁文件，切换同步命令时会拒绝旧指纹。
- 命令启动时重新读取目录清单和指纹，uv 可执行文件优先选项目工具目录，再查找排除已选 Python 环境的宿主 PATH。执行进程剥离单独选择的 Python 环境变量和路径，以及宿主的 `UV_PROJECT_ENVIRONMENT`、`UV_WORKING_DIR` 覆盖；环境页用同一工具查找规则只读运行 `uv --version`。
- 中英文项目帮助和环境提示说明命令的显式启动、同步前置条件与潜在下载/写入。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react`、`cargo check --all-targets`、`cargo clippy --all-targets -- -D warnings`、修改过的 Rust 文件的 `rustfmt --check` 及相关 `git diff --check` 均通过。项目检查仍报告 123 条警告、7 条提示和一条设计警告，退出码为 0。本机 `uv 0.8.0` 的帮助输出确认 `run --no-sync`、`sync --locked`、`lock` 与 `build` 命令存在。仓库 `check:rust` 脚本在通过 `cargo check` 后还会启动 `cargo test`；发现后在测试编译阶段中断，未执行测试用例，改用独立静态命令。随后 `cargo clean` 清理本轮生成的 6.2 GiB 编译产物。本轮未运行真实 uv 项目命令；uv CLI 版本差异、依赖解析、Windows/macOS/Linux 实际运行仍需验收。`uv.lock` 内容变化不影响固定命令种类，任务指纹只包含有无锁文件。
