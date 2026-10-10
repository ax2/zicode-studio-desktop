# 项目命令工具的有效 PATH（2026-09-29）

## 目标与发现

- 项目子进程 PATH 已过滤宿主激活的 venv/Conda 目录，并按项目显式工具目录排序。
- 但包管理器和构建工具的后备可执行文件查找仍读宿主原始 PATH。Host 若从 Conda/venv 启动，任务或环境诊断可能选中一个已从子进程 PATH 中过滤的工具。
- Maven/Gradle wrapper 的当前目录优先选择已经独立实现；Poetry 还需避免使用显式 Python 环境目录。

## 修改与决策

- 包管理器/构建工具查找支持传入已计算的有效 PATH；旧的直接调用入口保留，用于未带项目环境的现有调用。
- 项目任务、Maven/Gradle 无 wrapper 时的后备查找及包管理器环境诊断使用 `Environment.path()`。
- Poetry 使用不含显式 Python 环境的 `Environment.tool_path()`；显式工具目录仍优先，原有的已选 Python 目录排除检查保留。
- 随包 Bun 仍在候选首位，项目内部未显式登记的可执行文件仍不会被宿主后备查找选中。

## 验证与遗留问题

- `rustfmt --edition 2021 --config skip_children=true --check` 对五个改动 Rust 文件通过。
- 未运行测试或重新编译；Rust 构建目录此前已为释放空间清理。
- Windows、macOS、Linux 下宿主激活环境、显式工具目录、wrapper 与随包 Bun 的组合仍待实机验收。
- 未提交，未发布。
