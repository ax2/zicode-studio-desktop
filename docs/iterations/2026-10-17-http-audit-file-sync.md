# HTTP 服务审计的文件同步

日期：2026-10-17。范围仅 Studio 通用 `service.http.get.v1`，不修改 Zi DevTools、ZiFile 或任何冻结提供方包。

## 发现与修改

Host 已在成功响应写入终态审计后才登记可接力的结果引用，但 JSONL 追加原来分两次写入正文和换行，写入成功后未要求文件同步。进程异常可能让返回成功时的审计记录只停留在操作系统缓存中。

`AuditWriter::append` 现在将完整 JSONL 行放在同一缓冲区写入，并调用 `File::sync_data()`；同步出错时沿用 `http_service_audit_unavailable`，成功响应不登记结果引用。现有审计轮转的两个 1 MiB 文件上限不变，插件不能通过此接口提交自由日志正文。文件系统或设备在断电时仍可能有独立行为；轮转目录元数据的持久化和异常重启恢复仍须单独验证。

## 验证与边界

真实 Host 聚焦测试 `host_routes_confirm_then_fetch_and_persist_audit_events` 1/1 通过，同次覆盖正常响应、取消和终态审计追加失败；日志轮转专项 `rotates_audit_log_with_a_bounded_single_backup` 1/1 通过。`bun run check:rust:static` 退出 0，Cargo check 和严格 Clippy 通过；全仓 fmt 仍有既有 advisory 漂移，修改文件单独 rustfmt 检查通过。前后只读空间扫描未知项均为 0，`target` 30,022,025,378 → 30,019,368,104 B，非 scratch `.cache` 均为 355,458,670 B，task-scratch 均为 1,178,292,459 B，`site` 均为 29,644,753 B；E 盘可用 9,509,552,128 → 9,465,143,296 B。卷余量变化包含其他进程，不能归因于本轮；容量 advisory 使扫描退出 1，没有做新的 Release 构建或清理缓存。

该阶段验证 Host 自身的审计顺序与写入路径，不宣称 Spring Actuator 提供方工具、Pi/View 全链、跨平台或完整 154 项验收。
