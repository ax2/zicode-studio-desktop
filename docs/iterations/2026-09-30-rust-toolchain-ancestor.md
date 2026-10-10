# 2026-09-30 Rust 工具链祖先声明

状态：实现和静态检查已完成；真实项目验收待办。

## 目标与发现

- 环境页只报告选中目录里的 `rust-toolchain` 或 `rust-toolchain.toml`。子项目目录即使受到祖先声明影响，也看不到该要求。
- Rustup 会沿目录查找工具链文件；环境报告应在注册工作区边界内显示最近的声明，同时保留对本地文件的优先权。

## 修改与决策

- 选中目录没有任何工具链文件时，最多向上查找 32 层，遇到最近的祖先文件即停止；只读取注册工作区内的路径。
- 两种文件同层出现时报告冲突；文件不可读、指向声明目录外或超出清单上限时保留相应状态，不继续借用更远祖先。
- 报告用相对注册工作区的路径标识来源，仍只比较宿主默认 `rustc` 版本，不断言 rustup 实际选择。

## 验证、偏差与风险

- 首轮 `cargo check --all-targets` 通过，严格 Clippy 提示新模块的匹配表达式应使用 `matches!`；修正后 `bun run check:rust:static` 的编译检查与 Clippy 均通过。全仓格式检查仍报告 advisory 漂移，定向 `rustfmt --check` 通过。
- 检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本轮生成的 3.2 GiB Rust 构建产物。本轮不新增或运行测试。
- 工作区外的 rustup 祖先文件、`RUSTUP_TOOLCHAIN` 环境变量和用户级覆盖不在当前报告范围内。
- 尚未在 Windows、macOS、Linux 的真实多项目工作区中验收。
- 本轮只更新本地源码与档案；未提交、推送或发布。
