# 2026-09-29 Poetry 诊断与命令环境一致性

状态：本地 Rust 编译和格式检查通过；未运行测试或跨平台实机验收。

## 目标与发现

- 用户选择 Python venv/Conda 后，Poetry 固定命令已改用 `selected_tool` 与 `configure_poetry`，保留项目工具目录，但不继承另一个 Python 环境的 PATH 和激活变量。
- 环境诊断仍调用通用 `selected` 与 `configure`，可能优先选中该 Python 环境里的 Poetry，并带入 `VIRTUAL_ENV`、`CONDA_PREFIX` 等变量。诊断与实际命令由此可能指向不同工具或给出不同结果。

## 修改与决定

- Poetry 诊断现在和固定命令一样，先从显式项目工具目录选取可执行文件，再回退 Host PATH。
- 版本探测使用 `configure_poetry`，清除选中 Python 环境的激活变量和 PATH 前缀；其他工具继续走原有通用环境规则。
- 不改变用户的环境设置、命令目录或实际 Poetry 运行逻辑。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked` 通过。
- 目标文件 `rustfmt --check --edition 2021` 和 `git diff --check` 通过。
- 本轮未新增或运行测试，未启动 Poetry、Conda 或 macOS/Linux 实机。真实工具链组合的诊断与命令一致性仍需跨平台验证。
