# Stage：HTTP 成功响应的审计故障隔离复核

日期：2026-10-17。范围仅 Studio 通用 `service.http.get.v1` Host；不修改 DevTools、ZiFile 或冻结提供方候选。本阶段续接[成功审计顺序修正](2026-10-17-http-success-audit-order.md)。

## 目标与修改

上阶段调整了“先写成功终态审计，再登记跨工具结果”的源码顺序，但缺少真实故障注入。本轮扩展现有真实 HTTP Host 专项：在固定 GET 已到达本地服务、`request_started` 已落盘之后，测试服务将审计文件暂时移走并以同名目录阻止追加，再返回有效 JSON。断言 Host 返回 `http_service_audit_unavailable`，结果 Store 记录数保持不变；原审计文件恢复后只多出该操作的 `consent_prepared` 与 `request_started`，没有伪造成功终态。测试用的结果记录计数接口仅在 `cfg(test)` 中编译。

故障注入只在隔离 Host 测试目录触发，测试结束前恢复原审计文件。生产代码仍保持插件注册表锁先于终态审计、结果捕获后于成功终态审计的顺序。

## 验证证据

- `bun run check:rust:static` 退出 0，Cargo check 与严格 Clippy 均通过；全仓 fmt 仍报告既有 advisory 漂移。
- 本轮改动的 `http_get.rs` 与结果 Store 文件单独运行 `rustfmt --edition 2021 --check` 退出 0；只修正测试代码排版后，最终源码再次通过 Rust 静态门槛，行为代码未再变化。
- 真实 Host 专项 `host_routes_confirm_then_fetch_and_persist_audit_events` 1/1 通过，新故障分支的 HTTP 503、稳定错误码、结果 Store 数量不变和缺失成功终态均经实际断言；原有成功、拒绝、取消用例同次通过。测试编译复用项目 `target/debug`，没有创建新完整运行目录。
- 前后只读空间扫描完整，未知条目均 0：`target` 30,021,963,426 → 30,022,025,378 逻辑 B；普通 `.cache` 均 355,458,670 B；`task-scratch` 均 1,178,292,459 B；`site` 均 29,644,753 B。E: 可用 12,109,479,936 → 11,951,058,944 B。卷变化不归因于单次测试；预算超限仅为 advisory，没有删除缓存或重试被拒清理。
- 最终静态检查后再次扫描完整、未知项 0，四棵树逻辑字节与前一后置扫描相同；E: 可用 10,258,235,392 B。卷余量进一步变化时本仓库扫描总量未增长，不能将卷变化归于本次测试或推定本项目释放了空间。

## 遗留

这证明了一个本地成功响应的**终态审计追加失败**边界，不覆盖准备/开始阶段所有磁盘故障、轮转中断后的重启恢复、系统默认根证书的公网 HTTPS、DNS 变化、真实 DevTools Spring Actuator 包、Pi/View 全链与其他系统。Spring Actuator 完整工具接受仍为 0，DevTools 0/154、ZiFile 0/108。
