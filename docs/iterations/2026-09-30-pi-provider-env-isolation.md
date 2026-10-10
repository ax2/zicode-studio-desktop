# 2026-09-30 Pi 通用渠道环境密钥隔离

状态：实现和静态检查已完成；真实桌面验收待办。

## 目标与发现

- 用户配置的通用模型渠道以 `$<PROVIDER>_API_KEY` 引用密钥，Host 从当前场景的系统凭据库向 Pi 子进程注入同名变量。
- 上轮仅清除了继承的 `QVERIS_API_KEY`。其他提供商若在宿主桌面环境中存在同名变量，未配置该场景密钥时仍可能被 Pi 读取，不符合场景默认隔离要求。

## 修改与决策

- Pi 启动时清除从桌面进程继承的所有 `*_API_KEY` 环境变量，然后通过原有启动环境仅恢复当前场景 Broker 提供的密钥。
- 清理只作用于 Pi 子进程，桌面进程和 Host 启动的项目任务环境不在本轮变更范围内。
- 中英文帮助明确要求在当前场景录入模型密钥。依赖宿主环境密钥的 Pi 扩展需要改为场景内显式配置；其他名称的敏感环境变量仍需单独评估。

## 验证、偏差与风险

- `bun run check:rust:static`：`cargo check --all-targets` 和 `cargo clippy --all-targets -- -D warnings` 通过；advisory `cargo fmt --check` 报告仓库格式漂移。
- 检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本次生成的 3.2 GiB Rust 构建产物。
- 本轮不新增或运行测试。
- 尚未在 Windows、macOS、Linux 的真实桌面场景中验证通用渠道、场景切换和第三方 Pi 扩展行为。
- 本轮只更新本地源码、帮助与档案；未提交、推送或发布。
