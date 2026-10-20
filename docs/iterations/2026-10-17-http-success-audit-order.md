# Stage：HTTP 服务成功审计与结果登记顺序

日期：2026-10-17。仅修改 Studio 的通用 `service.http.get.v1` Host；DevTools 提供方、冻结候选和本地 0.4.2 版本均未修改。

## 发现与修改

原成功路径在 `request_completed/succeeded` 审计写入前调用 `capture_service_http`。如果读取已成功但终态审计落盘失败，Host 会向调用方返回 `http_service_audit_unavailable`，同时可能已在结果 Store 登记一个调用方没有收到的结果引用。现在仍先获取插件注册表锁，再写成功终态审计，写入成功后才尝试结果捕获；若审计失败，不会进入结果登记。保持锁获取时机可避免注册表不可用时先记“成功”审计。正常捕获失败仍通过已有 `resultCaptureError` 回报，HTTP 结果本身保持可见。

这关闭的是**成功终态审计失败时不产生新结果引用**的代码顺序缺口，不表示网络读取可以回滚；已发送的 GET 与 `request_started` 审计仍然可能存在。审计写入失败的原生故障注入和重启恢复仍待验收。

## 验证

- `bun run check:rust:static` 退出 0：Cargo check 和严格 Clippy 通过；全仓 fmt 仍为既有 advisory 漂移。
- 现有真实 HTTP Host 专项 `host_routes_confirm_then_fetch_and_persist_audit_events` 1/1 通过，覆盖成功、拒绝、审计落盘和取消的正常路径。此用例没有注入终态审计写失败，不能据此宣称该故障路径动态验收通过。
- 锁顺序复核后的最终源码再次运行静态检查与同一真实 Host 专项，均通过；最终测试二进制从同一 `target/debug` 重新编译，没有新增独立 Cargo target。
- 前置和后置只读预算扫描均完整，未知项 0。`target` 30,021,963,426 → 30,021,962,914 逻辑 B；普通 `.cache` 均 355,458,670 B；`task-scratch` 1,178,307,657 → 1,178,316,170 B；`site` 均 29,644,753 B。E: 可用 12,727,046,144 → 11,985,870,848 B；卷余量变化包含其他进程影响，不归因于本轮测试。预算为 advisory，未删除缓存或重试被拒清理。
- 最终再次扫描完整、未知项 0：`target` 回到 30,021,963,426 B，普通 `.cache` 355,458,670 B，`task-scratch` 1,178,292,459 B，`site` 29,644,753 B；E: 可用 12,182,863,872 B。中间与最终变化包含其他活动，不把差值归因于本次代码或声称清理释放。

## 仍待验收

系统默认根证书 HTTPS、公网 DNS 变化、审计故障注入/重启恢复、完整 Pi/View、提供方正式包和其他系统 Host conformance 均未完成。Spring Actuator 全工具接受仍为 0；DevTools 完整工具接受仍为 0/154，ZiFile 0/108。
