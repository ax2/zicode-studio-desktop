# 2026-09-27 模型网关日志隐私

状态：本轮实现与静态检查完成；实际代理请求验收待办。

## 发现与决策

- 本机模型网关代理会记录 Authorization 头的前缀和长度，以及上游响应正文的前 200 字节。即使不记录完整令牌，前缀和长度仍是凭据片段；正文可能含私有对话或服务返回的敏感信息。
- 请求日志仅保留方法、是否存在 Authorization 头和请求大小；响应日志仅保留 HTTP 状态与响应大小。不记录动态路径、请求体、响应正文、令牌片段或长度。
- 保持模型网关代理的转发、角色转换、状态码与响应内容行为不变；现有认证日志断言更新为只检查存在状态。

## 工作记录

- Host 代理不再读取 Authorization 值用于日志；只报告该头是否存在。删除上游响应正文预览，也不记录任意动态路径。现有认证日志断言改为只检查存在状态。
- 代理仍按原流程转发请求、将 QVeris 不接受的 `developer` 角色转为 `system`，并将上游响应返回调用方。本轮没有改动目标端点或凭据来源。

## 验证记录

- `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets`：通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict`：通过；旧页面未列入导航的提示仍存在。
- `git -c core.safecrlf=false diff --check`：通过。
- 搜索当前代理日志调用确认仅保留请求方法、认证头存在状态、HTTP 状态和字节数。本轮未新增或运行测试，也未发起真实模型请求。

## 遗留与发布

- HTTP 状态和报文大小仍属于可观察元数据；磁盘日志或其他组件的历史记录不因本次源码改动自动清除。其他服务入口的日志应逐项审查。
- 本轮只保存本地源码与文档，未提交、推送或发布。
