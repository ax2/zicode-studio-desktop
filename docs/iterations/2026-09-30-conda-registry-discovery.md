# Conda 登记环境发现工作日志（2026-09-30）

## 目标与发现

项目原有自动 Python 选择只覆盖工作区内的 `.venv` 与 `.conda`。用户也可以手动输入已有 Conda prefix，但外部环境需要知道完整绝对路径。Conda 的用户级 `~/.conda/environments.txt` 可提供一条跨平台、无需执行 Conda 的发现入口。

## 修改与决策

- Host 新增只读 `project_environment_discover_conda` 操作；先确认工作区存在，再读取当前用户的 Conda 环境登记文件。
- 文件限制为 128 KiB，最多检查前 256 行。逐项复用现有 Python 环境校验，仅返回仍具有 `conda-meta/history` 与平台对应解释器的 Conda prefix；规范化路径并去重。
- 桌面环境设置提供刷新与候选选择，长路径在窄视口换行。选择只修改表单草稿；保存仍走原有版本冲突与路径校验流程。缺失、读取失败、空结果及截断分别展示。
- 不执行 Conda、Python、环境激活脚本或安装操作；不修改登记文件。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react`、`cargo check --all-targets` 与 `cargo clippy --all-targets` 通过。本轮专门 Rust 模块的 `rustfmt --check` 通过。全仓库 `cargo fmt --check` 报告已有多个 Rust 文件格式差异。没有执行测试或三平台桌面实机验收。

该登记文件不覆盖所有 Conda 安装与未登记 prefix，用户仍可手动输入目录。标准目录布局可用不代表包依赖或激活钩子完整。Windows、macOS、Linux 的发现流程仍需分别实机确认。

## 接续：用户环境目录

增补只读扫描 `~/.conda/envs`，与登记文件结果按规范化 prefix 去重，并在界面标记来源。该目录中未登记但仍具有标准布局的环境也可填入草稿。每个来源最多检查 256 项；枚举错误明确报错，不把不完整结果当空列表。其他 Conda 安装目录仍需手动输入。

接续静态检查：`bun run typecheck`、`bun run check`、`bun run build:react`、`cargo check --all-targets`、`cargo clippy --all-targets` 和新增模块的 `rustfmt --check` 均通过；没有运行测试或三平台实机验证。
