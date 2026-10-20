# 服务接口目标插件鉴权（2026-10-18）

## 目标与发现

Studio 的模型目录、笔记摘要、模型生成和受控 HTTP 读取四条 Host 服务路径只检查一个指定插件，却通过 `PluginRegistry::list(scene)` 生成整份插件列表，再按 ID 查找。随着插件数量增长，这在全局注册表锁内复制所有插件的清单、版本列表及授权映射。上一轮签名列表缓存已经消除了列表路径的签名元数据磁盘读取；本轮改善的是无关插件的内存投影开销，不能记作新的磁盘 I/O 节省。

## 修改

上述四处改为 `execution_plugin(scene, plugin_id)`。模型目录、模型生成、HTTP 读取仍要求目标插件启用，保留原有 profile 和权限检查及错误码。笔记摘要仍取内置笔记插件的 `network.fetch` 授权，启用状态由原有 `ensure_notes_authorized` 管理。本轮没有更改插件协议、UI、用户插件状态、应用版本或发布产物。

用户选择暂不启用隔离配置中的 ZiDevTools JSON 对象插件；其主开关和 `pi.tools.register` 均不由本轮修改。这条真实插件的“发现 → 执行 → 结果接力”验收继续标记为待验收，不将其他合成或局部检查代替它。

## 验证与边界

`bun run check:rust:static` 退出 0：Cargo check 与严格 Clippy 通过；整仓 fmt 仍报告既有 advisory。四项已有 Host 专项各 1/1 通过：`checks_notes_network_permission_and_model_selection_through_the_host`、`http_catalog_requires_live_scope_profile_and_grant`、`revoking_one_plugin_during_host_model_requests_preserves_the_other`、`host_routes_confirm_then_fetch_and_persist_audit_events`。这些用例检查服务授权、存活会话、撤销和审计，未验证正式 JSON 对象插件。

前后只读扫描完整、`UnknownEntries=0`：`target` 30,032,062,711 → 30,032,055,543 逻辑字节，`task-scratch` 均为 1,258,318,024 字节，E 盘空闲 8,404,221,952 → 8,403,042,304 字节。扫描退出码 1 为容量建议，卷差额不直接等于本轮产物；未清理可复用缓存。

本轮没有在上百个插件的真实目录中测量锁占用或 UI 响应，也没有运行当前源码的跨平台 CI 或真实桌面截图；没有 UI 变更。
