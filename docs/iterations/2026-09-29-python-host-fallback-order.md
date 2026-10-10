# 宿主 Python 回退顺序（2026-09-29）

## 目标与发现

- 项目未显式选 Python、工作区内也无 `.venv`/`.conda` 时，任务与环境诊断会从宿主 PATH 回退查找 Python。
- 原实现先扫描整个 PATH 的 `python3`，再扫描 `python`；较后的系统 `python3` 可能盖过用户 PATH 前段的 `python`。
- 继承的已激活 venv/Conda PATH 虽从子进程环境中被过滤，回退查找仍可能选中其中的绝对 Python 路径，使任务与环境诊断绕过隔离。

## 修改与决策

- 回退查找改为按 PATH 目录顺序，目录内再按平台候选名顺序选择 Python；与系统命令查找和项目工具目录优先级一致。
- 仅在宿主回退阶段跳过由有效 `VIRTUAL_ENV`/`CONDA_PREFIX*` 标记识别的已激活环境目录。项目本地环境和用户显式选择的 Python 环境、工具目录仍优先，且不受这条回退过滤影响。
- 保留工作区内可执行文件不得作为无声明宿主默认 Python 的边界。

## 验证与遗留问题

- `rustfmt --edition 2021 --config skip_children=true --check src-tauri/src/project_environment/python_runtime.rs` 通过。
- 未运行测试或重新编译；此前为释放磁盘空间清理了 Rust 构建目录。
- Windows、macOS、Linux 的多 Python PATH 与宿主已激活环境组合仍待实机验收。
- 未提交，未发布。
