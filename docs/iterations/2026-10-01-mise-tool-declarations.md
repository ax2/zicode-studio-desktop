# 2026-10-01 mise 工具版本声明

状态：实现及静态检查完成；跨平台实机验收待补。

## 目标与发现

- 环境页已有 `.tool-versions`、Node/Python/Rust 原生版本文件的只读报告，但遗漏 mise 常用的 TOML 配置。
- [mise 官方配置文档](https://mise.jdx.dev/configuration.html)列出 `mise.local.toml`、`mise.toml` 及点文件变体，并说明配置会沿目录层级读取；读取配置不能证明 mise 最终合并结果或实际激活版本。

## 修改与决策

- 选中目录读取 `mise.local.toml`、`.mise.local.toml`、`mise.toml` 与 `.mise.toml`；多文件同时存在则分别显示，不推断优先级。父目录的同名文件也逐层显示，最多上溯注册工作区内 32 层，避免遗漏层叠配置中的声明。
- 固定路径另包括 `mise/config.toml`、`.mise/config.toml`、`.config/mise.toml` 和 `.config/mise/config.toml`；沿用原有文件大小与规范路径边界，解析 TOML 后仅返回 `[tools]` 声明，不返回 `[env]` 或任务内容。
- 这些文件名由一处固定清单驱动本地与祖先读取，避免两条路径覆盖范围漂移。
- 沿用 256 KiB 读取上限、规范路径边界与明确的不可读/越界/无效状态。最多显示 64 个工具声明，版本文本最多 200 字符。
- 仅解析 `[tools]` 的字符串、字符串数组以及仅含 `version` 的表。带有 `os`、`postinstall` 等其他选项或无法直接表达的声明显示 `complex declaration`，避免把条件声明误当成无条件版本要求；不会解释任务、环境变量或执行项目代码。
- 单一完整数字版本沿用现有宿主工具精确比较；别名、动态版本和多个候选值仍标记为不能静态比较。

## 验证、偏差与风险

- `bun run check:rust:static` 通过 Cargo check 与 Clippy；全仓库 `cargo fmt --check` 仍提示已有格式漂移，本轮新增模块单独通过 `rustfmt --check`。本轮不新增或运行测试。
- 目录链及复杂声明修订后再次通过 `bun run check:rust:static`；随后用 `cargo clean --manifest-path src-tauri/Cargo.toml` 清理本轮生成的约 3.2 GiB Rust 构建文件。
- 分组配置路径接入后再次通过 `bun run check:rust:static`；Cargo check 与 Clippy 通过，仓库原有格式漂移仍为 advisory。随后再次清理静态检查生成的约 3.2 GiB Rust 构建文件。
- 静态检查后运行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除 18,936 个本轮可再生的 Rust 构建文件，约 3.2 GiB。
- 呈现本地及注册工作区内最多 32 层祖先的固定文件名，不实现 mise 的配置合并、别名解析、插件逻辑或实际版本选择。用户全局配置、`conf.d` 片段和环境专用文件名不在本次报告中。
- 尚未在 Windows、macOS、Linux 的真实 mise 项目中做实机验收。
- 本轮只更新本地源码及档案；未提交、推送或发布。
