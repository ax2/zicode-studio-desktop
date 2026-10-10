# 2026-09-30 Pi 子进程的场景凭据继承

状态：实现和静态检查已完成；真实桌面验收待办。

## 目标与发现

- 模型渠道必须由用户在当前场景显式配置，金融外部连接不能依赖宿主环境中的公司凭据。
- Pi 启动命令会继承桌面进程环境。场景凭据 Broker 仅在该场景保存了 QVeris Key 时才覆盖 `QVERIS_API_KEY`；未保存时，继承值仍可被模型配置中的 `$QVERIS_API_KEY` 引用。
- 上一轮已经移除金融能力客户端直接读取环境变量的路径，但该修改不覆盖 Pi 模型层。

## 修改与决策

- 在启动 Pi 子进程时移除继承的 `QVERIS_API_KEY`，然后按既有启动环境注入当前场景 Broker 提供的同名变量。
- 仅处理内置 QVeris 兼容渠道；其他用户自定义渠道及其环境引用策略未在本轮改变。
- 保留模型配置中的 `$QVERIS_API_KEY` 引用，使已配置场景仍能通过现有模型通道使用该凭据。

## 验证、偏差与风险

- `bun run check:rust:static`：`cargo check --all-targets` 与 `cargo clippy --all-targets -- -D warnings` 通过；脚本的 advisory `cargo fmt --check` 报告仓库格式漂移，未对整个脏工作区运行自动格式化。
- 检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本次生成的 3.2 GiB Rust 构建产物。
- 本轮不新增或运行测试。
- 尚未在真实桌面进程中验证宿主设置了该变量时的未配置场景、已配置场景和重启流程；Windows、macOS、Linux 均需分别验收。
- 本轮只更新本地源码与档案；未提交、推送或发布。
