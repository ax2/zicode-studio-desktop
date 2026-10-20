# 受控 HTTP GET 插件 Host 实现（2026-10-15）

## 目标

为 DevTools 的 Spring Actuator 只读诊断解除“Studio 没有插件网络服务”的接口阻塞，同时维持固定能力、用户逐次确认和 Host 网络隔离。目标 profile 为 `service.http.get.v1 = 1.0.0-preview.1`，完整工具验收仍按 154 项全目录矩阵逐项计算。

## 实现

- 新增 Rust Host 服务 `src-tauri/src/host_server/plugin_services/http_get.rs`：health/info/metrics 固定 GET；origin 规范化；公网 HTTPS 与用户确认的私网/loopback分类；DNS 复核和连接地址固定；禁代理、重定向、任意 header/body/凭据；一用授权；权限和 runtime/session 复核；响应大小、JSON复杂度、并发及超时限制；操作取消和结果引用。
- 注册 `/v2/plugin-services/http-get/{prepare,commit,cancel}` 路由，并在插件状态变更时失效待用授权。
- 更新 profile 兼容性校验，要求精确版本与 `service.http.read` 权限。
- 增加 View SDK `services.http.get`、Studio 父窗口逐次确认卡和稳定错误映射；用户拒绝、停用与卸载会消费授权或取消操作。
- 同步预览契约、提供方互操作说明、阻塞清单及 154 项机器/人读矩阵。`spring-actuator` 状态变为 `await_host_conformance`，不是完整接受。

## 当前验证证据

- 前端 `bun run check`：通过（144条既有警告、10条信息和1条既有设计内联样式提示保留）。
- `plugin-capability-gateway`、`plugin-view-host`、`plugin-http-consent` 三组前端测试：41项通过。
- 修正后 `bun run check:rust:static` 的 cargo check 与 warnings-as-errors Clippy 均通过。整仓 fmt 阶段提示其他既有 Rust 文件有格式漂移；新增模块单文件 rustfmt 检查通过，没有批量格式化其他未提交文件。
- HTTP Rust 模块4项定向单测通过，覆盖固定endpoint、非法URL、IP/IPv4-mapped分类和不解析DNS的域名分类。首次运行暴露 `::1` 被误判；限制为IPv4-mapped转换后重跑通过。
- DevTools全量矩阵防漏测试4项通过；`git diff --check` 通过，存在仓库既有 CRLF 提示。

## DNS 用户确认顺序修正

- 复核代码发现早先 `prepare` 为显示域名解析后的网络类别而提前执行 DNS 查询，用户尚未同意时已联系 DNS；这与“确认前无网络”契约不一致。
- 已改为 `prepare` 只规范化 URL、识别 IP 字面量/localhost/普通域名并生成确认卡，不执行 DNS。确认卡会提示普通域名只在批准后解析且只允许公网结果；访问私网/回环服务须使用可见的 `localhost` 或 IP 字面量。
- `commit` 收到同意后才解析、拒绝混合/保留/非公网域名结果，二次解析检测地址变化，并固定已核验地址连接；拒绝确认不会查 DNS。
- Rust hostname/IP分类4项与View确认前端3项均通过；真实 Host DNS 观察仍须作为正式 conformance 证据。

## 未完成验收

- 本 profile 当前只有4项单元测试；DNS变化、代理隔离、超限、取消和撤权仍需 Host conformance 运行证据。
- 新增的真实 Host HTTP 路由尚无本 profile 专属的 HTTP/HTTPS fixture 收据；不能把其他 Host HTTP 功能的验收借用到这里。
- 新增结构化逐请求审计到插件根 `audit/http-services.jsonl`，记录 consent prepared、request started/completed、cancel requested 事件及插件/运行时/操作身份、endpoint、规范化 host/port、地址类别、HTTP 状态、读取字节数、终态/错误码和取消原因；不记录响应正文、凭据、查询、授权材料或插件自由文本。
- 审计写入器单测通过。审计开始记录写入失败会在网络访问前拒绝请求；终态记录写入失败会拒绝返回结果，留下 started 事件用于识别未闭合操作。Host 路由真实写入、磁盘故障/重启恢复和跨平台 conformance 未验收。
- View 确认、结果接力、Pi 实际发现/加载/调用、错误隔离及支持 OS 的 Host conformance 未验收。
- ZiDevTools 独立包、schema、正反向 fixtures 与包外 receipt 未收到；提供方不能发布声明此 preview profile 的兼容包。
- 机器矩阵保持全工具完整接受 `0/154`；此 profile 是接口实现进度，不增加已验收完整工具数。
- 最近测试后空间扫描：target 45,849,259,029 B / 82,102 files，`.cache` 310,353,261 B，task-scratch 747,858,111 B，site 29,644,753 B，均无未知项；E盘可用 21,780,320,256 B。未清理 Debug/Release、Cargo缓存或冻结提供方 fixture。

## 下一步

下一步补 HTTPS/TLS、DNS复核与变化、撤权/并发、超时/取消、非JSON和响应上限、审计故障恢复等 Host conformance；健康 200/503、确认前不连接、固定请求、重定向拒绝及成功/失败审计已由 loopback Host 测试覆盖。收取 ZiDevTools 独立包和 fixtures 后，再完成真实 View/Pi 链路与目标 OS 验收。

## 2026-10-15 HTTP service audit implementation

- Added a local JSONL audit writer at the plugin registry audit root for service.http.get.v1. It records consent prepared, request started/completed, and cancellation requested events with plugin/runtime/operation identity, fixed endpoint, normalized host/port, address class, HTTP status, response bytes read, terminal/error code and client cancellation reason. It does not store response bodies, URL query data, credentials or authorization material.
- Audit start write failure aborts before network access. Terminal write failure prevents returning the fetched result; the preceding start event marks an operation with missing terminal evidence. Rotation/retention and real Host disk-failure/restart recovery remain open.
- bun run check:rust:static passed cargo check and warnings-as-errors Clippy. Repository-wide cargo fmt --check still reports pre-existing drift; only the changed service files were formatted. The targeted HTTP module suite passed 5 tests, 0 failed, 617 filtered.
- Post-test storage scan completed with no unknown entries: target 45,856,616,625 B / 82,102 files; ordinary .cache 310,353,261 B; task-scratch 747,858,111 B; site 29,644,753 B. E: had 28,676,976,640 B free. No application build or cleanup was run; changes to volume free space may include other processes.
- Audit file behavior has only direct writer unit evidence. Real HTTP/HTTPS Host routing, Pi/View path, user-visible logs, failure isolation and supported-OS conformance remain unverified. DevTools provider package/fixtures are still absent and tool acceptance remains 0/154.

## 2026-10-15 bounded audit retention

- The HTTP service audit writer now rotates at 1 MiB and retains at most one previous file (`http-services.jsonl.1`), bounding its own storage to 2 MiB. An individual event larger than the cap is rejected rather than creating an oversized record.
- `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy. Repository cargo fmt advisory still reports pre-existing workspace drift; the touched Rust module was formatted individually.
- Targeted HTTP service Rust tests passed: 6 passed, 0 failed, 617 filtered. Includes writer privacy and rotation tests; does not prove real Host/network conformance.
- Before/after read-only storage scans completed without unknown entries. Target changed from 45,856,616,625 B to 45,851,946,145 B (82,102 files); `.cache` stayed 310,353,261 B; task scratch stayed 747,858,111 B; site stayed 29,644,753 B. E: free space changed from 28,931,346,432 B to 28,928,126,976 B. Deltas may include unrelated activity. No cache or build output was deleted.
- Current host HTTP/HTTPS routing, disk failure/restart recovery and cross-platform conformance remain unverified; DevTools acceptance stays 0/154.

## 2026-10-15 loopback Host route verification

- Added a real in-process Studio Host route test with an in-memory runtime, temporary workspace, developer plugin manifest/profile grant and local HTTP fixture. It verifies `/prepare` returns a confirmation preview without opening a TCP request; only `/commit` with confirmation reaches the fixed `/actuator/health` endpoint.
- The test verifies `200 application/json` is returned as structured `UP` data and that the plugin audit file contains `consent_prepared`, `request_started`, and successful `request_completed`, with no response body fields.
- Focused test passed 1/1 on the first complete run. `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy after removing the test-only unused-mut warning. The repo-wide fmt advisory still reports unrelated existing drift.
- Post-validation read-only storage scan completed without unknown entries: target 45,856,042,311 B / 82,103 files; `.cache` 310,353,261 B; task scratch 747,858,111 B; site 29,644,753 B; E: free 28,930,293,760 B. The new test binary accounts for some target change; disk/free-space deltas may include unrelated activity. No cache was removed.
- After the final exact-request assertion and repeated Rust static gate, a fresh read-only scan again had no unknown entries: target 45,854,621,538 B / 82,102 files; `.cache` 310,353,261 B; task scratch 747,858,111 B; site 29,644,753 B; E: free 28,921,167,872 B. No build cache or runtime was removed.
- This is loopback HTTP evidence only. HTTPS/TLS, DNS rebinding, authorization races, timeout/cancel, response budgets, fault recovery, Pi/View and supported-OS conformance remain open. Full DevTools acceptance remains 0/154.

## 2026-10-15 health status and redirect Host coverage

- Expanded the same real Host route test to execute health 200, health 503, and a 302 response as three separately confirmed operations. The 503 is preserved as structured health data; the redirect returns a service error and is not followed.
- Verified all three audit triples are persisted in order. The first two completion events are successful; the redirect completion is failed with `http_service_redirect_blocked`.
- Final focused Host test passed 1/1. Final `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy; repo-wide fmt advisory still reports pre-existing drift.
- Post-validation scan completed without unknown entries: target 45,855,516,420 B / 82,102 files; `.cache` 310,353,261 B; task scratch 747,858,111 B; site 29,644,753 B; E: free 28,827,865,088 B. No cache was deleted.
- Checked the [official Pi release page](https://github.com/earendil-works/pi/releases) on 2026-10-15: latest is v1.2.0, matching `scripts/pi-version.json`; no binary download/version change was needed.
- DNS rebinding, HTTPS/TLS, authorization races, timeouts/cancellation, size/content-type boundaries, disk recovery, Pi/View integration, and supported-OS conformance remain open. DevTools acceptance remains 0/154.

## 2026-10-15 in-flight cancellation Host coverage

- Extended the real loopback Host test with a request held in flight by a local fixture. `/cancel` returns `status=requested` and `executionFinished=false`; after the fixture is released, `/commit` finishes with HTTP 409 and `http_service_request_cancelled`.
- Verified the same operation's persisted audit includes `cancel_requested` followed by a failed `request_completed` with the stable cancellation code. This proves the Studio Host route's cancellation acknowledgement and terminal result for this fixture; it does not prove every network/TLS/platform cancellation race.
- Focused Host test passed 1/1; `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy. Repository-wide fmt advisory still reports pre-existing drift.
- Final read-only storage scan completed with no unknown entries: target 45,854,873,384 B / 82,102 files; `.cache` 310,353,261 B; task-scratch 747,858,111 B; site 29,644,753 B; E: free 28,919,693,312 B. No cache, runtime, or build output was deleted. The target/task-scratch advisory thresholds remain exceeded; cleanup remains subject to the existing denied-action boundary and manual candidate list.
- Remaining Host gaps include HTTPS/TLS, DNS rebinding and changed-address behavior, authorization/revocation races, timeouts, response size/type boundaries, audit fault recovery, Pi/View/provider-package flow, and supported-OS conformance. Full DevTools acceptance remains 0/154.

## 2026-10-15 cancellation covers DNS resolution

- Code review found that the cancellation select only wrapped the HTTP request, after two DNS lookups. A cancellation acknowledgement could therefore arrive while DNS resolution continued.
- Moved the cancellation guard outside the full fetch future, covering both DNS resolutions and the HTTP request. An already-cancelled operation now exits before `lookup_host`; added a deterministic `.invalid` hostname regression test.
- HTTP service module tests passed 8/8, including the real loopback Host lifecycle and pre-DNS cancellation. `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy; workspace fmt advisory reports existing drift, while `rustfmt --check --edition 2021` passed for the changed module. Matrix source remains 154 entries and full acceptance 0.
- Before/after read-only scans both had no unknown entries. Target changed from 45,854,873,384 B to 45,860,382,575 B (82,102 files); `.cache` stayed 310,353,261 B, task-scratch 747,858,111 B and site 29,644,753 B. E: free space changed from 28,919,021,568 B to 28,919,017,472 B. These deltas are observations and may include unrelated processes; no cache or output was removed.
- Full DNS timing/race cases, HTTPS/TLS, authorization revocation during an active response, response limits, fault recovery, complete Pi/View/provider-package flow and supported-OS conformance remain open.

## 2026-10-15 plugin-scoped HTTP authorization invalidation

- Review of Studio's plugin enablement, permission and uninstall routes found they called a global HTTP grant invalidation method. Changing one plugin could cancel another plugin's unrelated request and invalidate its pending consent.
- Added plugin-scoped grant revisions and `invalidate_plugin`; permission/enablement/uninstall now clear and cancel only the target plugin's HTTP grants/operations. Plugin registry reload still uses global invalidation. Added lifecycle coverage proving a revoked plugin's pending grant and operation are invalidated while another plugin's grant and cancellation token remain usable.
- HTTP service Rust module tests passed 9/9. `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy; workspace fmt advisory continues to report pre-existing drift. The new module passes its edition-aware rustfmt check.
- Before/after read-only scans both completed with no unknown entries: target 45,860,382,575 B → 45,860,538,859 B (82,102 files); `.cache` 310,353,261 B, task-scratch 747,858,111 B, site 29,644,753 B. E: free space 28,919,017,472 B → 28,918,366,208 B. Deltas may include unrelated activity; no build output or cache was removed.
- Matrix remains 154 entries and 0 full-tool acceptances. This is a `Grants` lifecycle unit test, not an end-to-end permission revocation during live HTTP response. HTTPS/TLS, DNS changes, live revocation race, resource/fault cases and Pi/View/provider/OS conformance remain pending.

## 2026-10-15 live Host permission revocation isolation

- Added a separate real Host test with two installed fixture plugins and concurrent HTTP requests. It calls the actual `/v2/plugins/permission` route to revoke plugin A while A and B are both waiting on a loopback response.
- Verified A's operation terminates with `http_service_request_cancelled`; B remains pending after A's revocation, then succeeds after its own response is released. The persisted audit records A failed and B succeeded under their distinct plugin/operation identities.
- HTTP service module tests passed 10/10. `bun run check:rust:static` passed cargo check and warnings-as-errors Clippy; repository fmt advisory still reports existing drift. Both changed test modules pass `rustfmt --check --edition 2021`.
- Matrix remains 154 entries with 0 complete tool acceptances; Spring Actuator remains `await_host_conformance`. Plugin reload races, HTTPS/TLS, DNS changes, response limits, audit failure recovery, Pi/View/provider package and other OS conformance remain open.
- Pre/post read-only scans had no unknown entries. During the validation interval, observed target changed from 45,860,538,859 B / 82,102 files to 30,133,141,559 B / 78,074 files; E: free space changed from 28,876,210,176 B to 44,632,563,712 B. `.cache` stayed 310,353,261 B; task-scratch 747,858,111 B; site 29,644,753 B. This session issued no deletion command; the large delta's cause is not established and is not attributed to the tests. No further cleanup was performed.

## 2026-10-15 response budget Host coverage

- Extended the real loopback Host route test with a response declaring `Content-Length` above 1 MiB and a deeply nested JSON body. The service rejects the declared oversized response as `http_service_response_too_large` before reading it and rejects excessive JSON nesting as `http_service_json_complexity_exceeded`.
- Targeted Host test passed 1/1 after correcting the test fixture's `write_all` argument to borrow its byte vector. This verifies these two rejection paths through the HTTP route and audit, alongside the existing success, health failure, redirect and cancellation cases.
- This does not cover a chunked/streaming response that crosses the byte limit, every JSON node/string budget, HTTPS/TLS, DNS changes, Pi/View/provider package, fault recovery or supported-OS conformance. Matrix remains 154 entries and 0 complete tool acceptances.

## 2026-10-15 chunked response Host coverage

- Extended the loopback Host route fixture with a valid HTTP/1.1 chunked response whose decoded body is 1 MiB + 1 byte and has no `Content-Length` header.
- The Host rejected the streamed body with `http_service_response_too_large`; its persisted terminal audit carried the same stable error code. The focused route test passed 1/1.
- This closes only the chunked byte-cap path. Other response-budget dimensions, TLS/DNS behavior, audit recovery, provider package and full Pi/View/OS conformance remain open; full DevTools tool acceptance remains 0/154.

- Final validation for the chunked case: bun run check:rust:static passed all-target Cargo check and warnings-as-errors Clippy; repository cargo fmt --check remains advisory-drifted, while rustfmt --check --edition 2021 passed for the HTTP module. git diff --check passed (only existing LF-to-CRLF notices).
- Post-validation read-only scan completed with no unknown entries: target 29,370,587,178 B / 73,788 files; .cache 310,353,261 B; task-scratch 748,164,366 B; site 29,644,753 B; E: free 60,574,347,264 B. No files were deleted; volume free-space changes may include unrelated processes.

## 2026-10-16 untrusted TLS certificate Host coverage

- Added an in-process TLS fixture using a generated CA and a server certificate whose SAN matches 127.0.0.1, but whose CA is not in the Host default trust store.
- After user confirmation, the real Host route returned http_service_request_failed; the fixture observed no HTTP request over the TLS connection, and the JSONL audit recorded the failed terminal event. This verifies rejection of an untrusted certificate before the service request is sent.
- The focused Host route test passed 1/1. This is negative certificate validation only: successful HTTPS with a trusted chain, public DNS changes, TLS/platform variants, Pi/View/provider package and cross-OS conformance remain unverified. Full DevTools acceptance remains 0/154.

- Final Rust static check after the TLS test passed cargo check --all-targets and warnings-as-errors Clippy. Repository cargo fmt --check remains advisory-drifted; the changed HTTP module passes rustfmt --check --edition 2021.
- Final read-only storage scan completed without unknown entries: target 29,370,851,882 B / 73,788 files; .cache 310,353,261 B; task-scratch 748,164,366 B; site 29,644,753 B; E: free 63,633,096,704 B. No files or caches were deleted; volume free-space movement may include unrelated processes.
