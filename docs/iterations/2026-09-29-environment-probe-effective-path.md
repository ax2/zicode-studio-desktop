# 环境诊断的有效 PATH（2026-09-29）

## 目标与发现

- Node、Cargo、Go、CMake、Java 等非包管理器工具的环境诊断从宿主原始 PATH 选取可执行文件。
- 项目终端和工具版本查询的子进程会按项目设置过滤宿主已激活的 Python/Conda 环境目录。此前诊断可能先选中被过滤目录中的绝对工具路径，显示一个新终端实际找不到的工具。
- 现有非 Python 诊断每项只有一个可执行文件名称候选；通用查找器仍按名称优先遍历 PATH，和项目工具目录的目录优先规则不一致。

## 修改与决策

- 非包管理器的环境诊断从 `Environment.path()` 提供的有效 PATH 查找，沿用项目工具目录优先与宿主激活环境过滤规则。
- 通用查找器改为 PATH 目录优先、同目录内候选名称次之。保留 WindowsApps 跳过、Unix 可执行权限、工作区内隐式程序拒绝和 rustup shim 的原始调用路径。
- 包管理器与 Python 的专用查找规则保持原有路径；它们需要独立处理包装器或环境选择。

## 验证与遗留问题

- `rustfmt --edition 2021 --config skip_children=true --check src-tauri/src/host_data/environment/probe.rs` 通过。
- 未运行测试或重新编译；Rust 构建目录此前已清理。
- macOS/Linux GUI 启动 PATH、Windows Conda PATH 与项目工具目录组合仍需实机验收。
- 未提交，未发布。
