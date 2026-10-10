# Monorepo Python 环境继承（2026-09-29）

## 目标与发现

- 当前子目录的 Python 任务、环境诊断与终端只查找该目录内的 `.venv`、`.conda`。monorepo 在工作区根目录设置环境、子目录存放包时会错过该环境。
- 显式选择的环境优先级更高，Poetry 固定命令使用自己的环境选择规则。

## 修改与决策

- 自动环境查找从当前命令目录逐级向上至已登记工作区根目录；每一级仍先检查 `.venv`，再检查 `.conda`。不读取工作区外的上级目录。
- 近处环境损坏、目录链接越界或环境标记不完整时继续报错，不静默回退到远处环境或宿主 Python。
- Python 任务、环境诊断与新终端复用同一查找规则；显式环境仍最高优先，工具目录与宿主 Python 仍在自动环境之后。
- 更新界面说明和中英文来源标签，明确环境可能位于所选目录的上级。

## 验证与遗留问题

- `rustfmt --edition 2021 --config skip_children=true --check` 对三个改动的 Rust 文件通过。
- `bun run typecheck`、`bun run check` 与 `bun run build:react` 均退出 0；仓库现存 Biome/设计检查提示仍会显示。
- 未运行测试，也未在三平台验证真实 monorepo 与终端继承。
- 命名 Conda/Poetry 环境自动枚举与实际激活脚本仍未实现。
- 未提交，未发布。
