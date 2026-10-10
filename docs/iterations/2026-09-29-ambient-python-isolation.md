# 2026-09-29 宿主 Python 环境隔离

状态：源码实现与 Rust 静态检查完成；未进行真实跨平台终端操作。

## 目标与发现

- 开发者平台的项目终端和任务应按项目或用户显式选择的 Python 环境运行。此前 PTY 终端直接继承 Host 的 `VIRTUAL_ENV`、`CONDA_PREFIX`、`PYTHONPATH`、`POETRY_ACTIVE` 等变量；PATH 也会包含 Host 启动时已激活环境的目录。
- 标准任务配置已有部分 Python 环境隔离，但本地 `.venv` 命令补 PATH 时仍可能把宿主激活环境追加回来。Poetry 后备查找和终端需要同一规则。

## 修改与决定

- 从宿主 `VIRTUAL_ENV`、`CONDA_PREFIX` 及堆叠 Conda 的 `CONDA_PREFIX_*` 解析绝对环境根目录，仅在对应的 `pyvenv.cfg` 或 `conda-meta` 标记存在时过滤该根目录下继承的 PATH 条目，避免错误环境变量清空系统工具 PATH。显式选中或项目本地 Python 的目录仍作为前缀加入，不改变 Host 自身环境。
- 项目终端先清除继承的 Python/Conda 激活变量、`PYTHONPATH` 与 `POETRY_ACTIVE`，然后仅为选中的 venv/Conda 设置对应变量。普通项目任务即使未选 Python 也清除继承变量；Poetry 任务按同一 PATH 过滤规则运行。本地环境命令也清除 `PYTHONPATH`/`POETRY_ACTIVE`。
- 路径过滤只作用于子进程继承的 PATH；用户在项目工具目录中显式配置的路径仍保留优先级。

## 验证与遗留

- `cargo check --all-targets`、`cargo clippy --bins -- -D warnings`、按 Rust 2021 edition 对修改文件执行的格式检查均通过。
- 未新增或运行测试，也未启动真实项目终端。Windows、macOS 和 Linux 上 Host 从 venv/Conda 启动时的实际 PATH 与终端行为仍待验证。
- 全仓格式检查存在先前记录的其他文件差异；本轮未批量格式化。无新截图或发布产物。
