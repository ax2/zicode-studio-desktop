# 2026-09-29 模型渠道禁用边界

状态：Rust 模型工具层防护已实现并完成静态检查；完整渠道禁用尚未实现，也未进行实机验证。

## 目标与发现

- [需求基线](../requirements.md)要求渠道可禁用，且必须影响实际模型工作流。
- Pi 文档的 `models.json` provider 字段没有 `enabled` 开关。移除自定义渠道也不能保证同名内置 provider 消失：Pi 文档明确说明，覆盖内置 provider 的配置移除后会恢复内置模型。
- Rust 的 `model_tools` 独立读取当前场景 `models.json`。翻译、摘要、插件模型能力和其目录均通过此模块；原实现遍历全部 provider，忽略显式 `enabled: false`。

## 修改与决定

- Rust 模型工具目录与解析现在排除 `enabled: false` 的 provider。显式选择该渠道的翻译、摘要或插件调用会返回模型不可用，不能继续发起该层的模型请求。
- 暂不把“禁用”按钮暴露给用户：Pi 聊天仍可能使用同名内置 provider 或已选中的模型，单一标记尚不能保证完整禁用。后续必须将模型选择、已选模型的下一轮调用和进行中的请求边界一并设计。
- 不删除渠道配置、模型元数据或凭据；未来启用动作应能保留用户配置。

## 验证与遗留

- `cargo check --all-targets` 和 `cargo clippy --bins -- -D warnings` 通过；`rustfmt --check src/model_tools.rs` 通过。全仓 `cargo fmt --check` 报告多个既有文件格式差异，本轮未批量改写。
- `bun run check:rust` 在完成 `cargo check` 后自动进入 `cargo test` 编译阶段；发现脚本内容后立即中断，没有执行测试用例。后续用单独的 Clippy 与格式命令完成本轮静态检查。未新增测试或做真实模型调用。
- 当前 `model_tools.rs` 尚未纳入 Git 跟踪，因此 `git diff --check` 不覆盖该文件；格式由针对该文件的 `rustfmt --check` 检查。
- Pi 注册表和运行中的聊天会话尚未纳入禁用保护；当前 `enabled: false` 只约束 Rust 模型工具。
- 接续核对 Pi RPC：Host 能在 `set_model` 或普通 `prompt` 前检查当前模型，但扩展命令、已排队的 `steer`/`follow_up` 和进行中的请求仍可能继续调用。仅拦截 Host 的新 `prompt` 不能作为完整禁用实现；需要定义禁用时的会话取消与扩展调用边界。
- 本轮无新截图或发布产物。
