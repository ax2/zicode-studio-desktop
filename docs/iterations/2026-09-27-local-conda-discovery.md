# 2026-09-27 项目内 Conda 自动发现

状态：本轮实现与静态检查完成；跨平台实机验收待办。

## 发现与决策

- 上轮显式 Conda prefix 已能用于命令、诊断与新终端，但自动 Python 选择只读取所选目录 `.venv`，随后就转向项目工具目录或宿主 Python。
- 在当前子项目目录中只读检查 `.venv`、`.conda`，`.venv` 优先；同目录优先于工具目录与宿主。两者都沿用上一轮已有结构校验，不执行 Python、conda 或激活脚本。
- 若优先的目录已存在但损坏、越界或类型不符，返回明确错误，不静默回退。自动发现只影响当前命令目录；新终端不自动激活它。
- 环境诊断标注自动 Conda 来源和版本未检查；显式选中目录后才允许现有版本探测。
- 不新增或运行测试；按现有约束使用静态检查，记录真实运行与跨平台验收缺口。

## 本轮修改

- Native Python 选择按显式环境、当前命令目录 `.venv`、当前命令目录 `.conda`、项目工具目录、宿主 Python 的顺序解析。候选目录已存在却无效时停止选择并返回对应错误；不将损坏环境隐藏为宿主 Python。
- 自动发现沿用环境结构和目录边界检查。`.conda` 必须是带 Conda 标记的 prefix；`.venv` 若实际为 Conda prefix，则按 Conda 类型处理。命令运行时使用现有的环境变量与 PATH 前缀处理，不执行激活脚本。
- Python 任务目录指纹加入来源、环境目录和 PATH 前缀。切换自动环境类型或目录后，旧任务目录不会继续被当作同一选择。
- 环境诊断和项目界面显示本地 Conda 来源、无效环境原因以及只读发现尚未执行解释器的状态；更新中英文帮助和平台路线图。

## 验证记录

- `bun run typecheck`：通过。
- `bun run check`：通过；现有 111 条 warning、7 条 info。
- `bun scripts/check-i18n-coverage.mjs`：通过；2530 个键，缺失 0。
- `bun run build:react`：通过；构建后恢复原本干净的生成包，只保留本轮及既有改动对应的产物。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets`：通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict`：通过；输出中的未列入导航页面提示为现有信息。
- 本轮未新增或运行测试；没有进行 Windows/macOS/Linux 上的真实 Conda 环境运行、界面操作或终端生命周期验收。

## 遗留与发布

- 自动发现限定在所选命令目录的 `.venv` 与 `.conda`；其他 Conda/Poetry 环境的枚举仍待实现。`.venv` 优先，即使它已损坏也不会自动转用 `.conda`。
- 自动模式不会为新终端激活本地环境；需要 Conda 激活钩子或环境配置变量的命令仍需在终端中手动激活。
- 本轮仅保留本地代码、构建产物和文档记录；未提交、推送或发布。
