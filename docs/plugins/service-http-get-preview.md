# 受控只读 HTTP GET 插件服务预览

状态：`service.http.get.v1 = 1.0.0-preview.1` 的 Host 路由、profile/权限门控和 View 确认桥已写入 Studio 工作树。真实 loopback Host 测试现验证自签名 CA 在未信任时被拒，并在测试专属注入其根证书后通过同一 Host 路由取得 HTTPS 200 JSON；该注入不会进入正式构建。Spring Actuator 无签名 candidate-02 已冻结并通过实际 Host 的清单、View 源路由与固定 GET 定向测试，见[阶段记录](../iterations/2026-10-17-spring-actuator-candidate02-intake.md)。系统默认信任库中的真实 endpoint、完整 DNS/TLS conformance、原生 View 确认/结果链路、跨平台 conformance，以及 DevTools 正式提供方包与逐项 fixtures 尚未验收，因此仍属预览；提供方不得据此宣称 Spring Actuator 或网络类工具已完整接入。

View 桥等待预算现与最长确认期对齐：HTTP GET 最多等待 75 秒，覆盖 60 秒确认、8 秒网络和桥接余量；到期仍请求取消，Host 最终状态需另行核对。见[阶段记录](../iterations/2026-10-17-http-view-confirmation-budget.md)。

## 目标与边界

为 Spring Actuator 只读诊断提供一个由 Host 执行的 HTTP 服务调用切片。插件 View 可请求健康、信息或指标数据；请求经过 Studio 确认，由 Rust Host 发出。WASI 模块、Pi 扩展及 iframe 本身都不能建立网络连接。插件不提供任意 URL、HTTP 方法、路径、请求头、请求体、代理、凭据或重定向。

本 profile 只覆盖以下操作：

| endpoint | 固定相对路径 | 允许的响应 |
| --- | --- | --- |
| `health` | `/actuator/health` | 2xx JSON；HTTP 503 JSON 保留为健康状态结果 |
| `info` | `/actuator/info` | 2xx JSON |
| `metrics` | `/actuator/metrics` | 2xx JSON |

只接受 origin（scheme、host、port）；不接受基础路径、userinfo、query 或 fragment。带 Spring context path、自定义 Actuator base path、认证要求或非 JSON 响应的服务目前不支持。工具需要支持这些情况时，先新增精确、可审查的 profile 操作与安全预算，不放宽成任意请求。

## 当前实现与验证边界

- Host 实现位于 `src-tauri/src/host_server/plugin_services/http_get.rs`，路由注册在 `host_server.rs`，profile 兼容性在 `plugin_registry/profile_compatibility.rs`；View 桥接与确认卡位于 `public/native/plugins/`。
- 当前代码限定固定 endpoint、桌面 token 和活动插件身份、显式权限、单次确认、DNS 地址复核与固定连接、禁代理/重定向、响应/并发/超时上限、取消及结果引用。
- 已通过的检查：前端 `bun run check`、41项相关插件前端测试、修正后 `bun run check:rust:static` 的 cargo check 与 warnings-as-errors Clippy、HTTP模块4项Rust单测。整仓 fmt 阶段仍提示其他既有文件格式漂移；新增模块单文件 rustfmt 检查通过。
- 新增本地 loopback HTTP Host 闭环测试，确认准备阶段没有 HTTP 连接，确认后发出固定请求并读取 JSON；覆盖 health 的 HTTP 200/503、302 重定向拒绝、在途取消 ACK 与最终取消错误，以及逐请求审计真实落盘。取消接口的 `requested` ACK 不等于执行已终止；本地 fixture 验证随后以 HTTP 409 `http_service_request_cancelled` 结束，审计包含 `cancel_requested` 和失败终态。HTTPS/公网 DNS、Pi/View完整调用链和跨平台 conformance 尚未验收。因此这条 Host 测试不代表提供方插件发现/加载/执行链路已验收，也不增加154项目录中的完整接受数。

## 身份、权限与确认

- 插件 schemaVersion 2 清单须精确声明 profile 版本 `=1.0.0-preview.1`，并声明可选权限 `service.http.read` 及清楚说明用途。
- 可信父页面注入 `pluginId`、`runtimeId`、`sessionId` 和场景；View 不能提交或覆盖这些身份字段。Host 每一步都校验桌面令牌、活动 runtime/session、插件启用状态、profile 与权限授予状态。
- 每个请求都需要在 Studio 父界面单独确认。确认卡显示规范化 origin、HTTP/HTTPS、固定 endpoint、完整固定路径、无凭据/请求体、响应上限及超时。私网/回环地址和明文 HTTP 显示额外警示。域名目标会明确提示“仅在批准后解析”；域名只允许解析为公网地址，访问本地服务需使用可见的 `localhost` 或 IP 字面量。
- `prepare` 只解析 URL 字符串并生成短期一次性 `grantId`，不做 DNS 查询或 HTTP 请求。授权有效 60 秒；拒绝、过期、插件停用、卸载、重载或撤权会消费/作废授权。
- `commit` 只能消费与同一插件、runtime、session、origin、endpoint 绑定的授权。重复提交拒绝。SDK 可使用 `AbortSignal`，Host 按不可猜测的 operation ID 取消在途请求；取消 ACK 只表示收到，最终请求结果表明连接是否已停止。

View SDK 草案：

```js
const result = await window.zicode.services.http.get(
  { origin: "http://127.0.0.1:8080", endpoint: "health" },
  { signal },
);
```

父页面负责 prepare、展示确认、commit 与取消消息；View 不收到 desktop token、grant ID、内部 DNS 地址或 Host HTTP 客户端。View CSP 保持 `connect-src 'none'`。

## 目标与网络策略

- 仅允许 `https` 公网目标，以及用户明确确认的 RFC1918 私网或 loopback 目标。公网目标必须 HTTPS；HTTP 只限 loopback/RFC1918，确认卡标明明文传输。域名批准后只能解析到全公网地址；指向私网/回环的服务必须使用 `localhost` 或 IP 字面量，确保确认卡展示真实地址类别。
- 拒绝未指定、组播、广播、链路本地、IPv4/IPv6 映射后的保留/非路由地址，以及云 metadata 地址（包括 `169.254.169.254`）。混合公网与私网解析结果整体拒绝。
- Prepare 不触发 DNS。用户批准后，Commit 才解析并校验全部 DNS 地址；随后再次解析，地址集合变化即拒绝。连接固定到已核验地址，同时保留正确 Host/TLS SNI。禁用环境代理和系统代理，禁用重定向。
- 不发送 Cookie、Authorization、用户代理输入、任意请求头或 body；不将系统代理凭据、Pi 配置、环境变量或项目配置传给插件。
- 仅支持系统默认 TLS 验证；不支持忽略证书错误或用户自定义 CA。URL 中的用户名、密码、路径、查询和片段均拒绝。

现有实现使用独立的 `http_get` Host 模块；不复用 `public_http`，因为后者面向公开网页抓取，拒绝私网/loopback且代理语义不同。下方验收完成前，DNS 固定、地址分类和代理隔离仍需以真实 Host conformance 证据确认。

## 预算、结果与审计

- Prepare/确认总预算 60 秒；HTTP 总超时最多 8 秒，连接超时最多 3 秒；View 可取消。
- 每个响应最多读取 1 MiB，检查 Content-Length 并在流式读取时最多读取上限加 1 字节。只接受 `application/json` 或带 `+json` 的 Content-Type；解析后深度最多32、值与对象键合计最多20,000个节点、单对象键最多16KiB UTF-8。
- 全局最多 2 个在途请求、单插件最多 1 个；排队不延长用户授权有效期。资源槽以 RAII 释放，Host shutdown、插件撤权与 View 销毁都会取消请求。
- 普通启用状态/权限变更和卸载只使目标插件的 HTTP 授权与操作失效；一个插件的撤权不会清除其他插件的待用授权或取消其在途 HTTP 操作。插件列表重载仍全局失效。
- 真实 Host 并发测试通过管理路由撤销插件 A 的 `service.http.read`，确认 A 的在途操作停止且返回取消错误；插件 B 的独立请求在 A 撤权后仍保持在途，并在释放其 fixture 响应后成功。该用例不覆盖插件列表重载或进程异常期间的撤权竞态。
- 返回结构化 `endpoint`、HTTP `status`、`contentType`、有界 JSON `data` 与稳定错误码。health 的 503 是诊断数据，不映射成通用传输失败。重定向、DNS变化、超时、取消、撤权、非 JSON、过大响应分别有稳定错误码。
- Host 将结构化 JSONL 写入插件数据根的 `audit/http-services.jsonl`。记录 `consent_prepared`、`request_started`、`request_completed` 和 `cancel_requested` 阶段，以及时间、profile 版本、插件/运行时/操作身份、固定 endpoint、scheme、规范化 host/port、地址类别、HTTP 状态、实际读取字节数、终态、稳定错误码和用户取消原因。
- 审计日志有硬上限：当前文件及单个轮转备份各最多 1 MiB。追加会超限时最多保留最近一个旧文件并开始新文件；超限的单条事件拒绝写入，限制长期运行的磁盘占用。
- 日志不包含响应正文、任意 URL 路径/查询、Cookie、授权材料或插件自由文本。开始请求前审计写入失败会阻止网络访问；终态写入失败会返回稳定服务错误，先前的 `request_started` 记录用于标识未完成审计的操作。成功响应终态追加失败已通过真实 Host 故障注入。Host 启动时会将残缺或无效的当前 JSONL 原样隔离到唯一轮转备份，不在坏尾行后继续追加；这不恢复未知请求结果。轮转中断、备份替换失败与断电后的恢复仍待 conformance 验收，见[阶段记录](../iterations/2026-10-17-http-audit-tail-isolation.md)。
- 审计追加现将完整 JSONL 行一次写入并同步文件；成功终态同步完成后才登记可接力结果引用。文件同步失败仍返回 `http_service_audit_unavailable`。该顺序不证明断电时轮转目录元数据的持久性，异常重启恢复仍待验收；见[阶段记录](../iterations/2026-10-17-http-audit-file-sync.md)。
- 启动时若审计 Writer 无法初始化，Host 仍启动主界面和其他插件服务，HTTP GET 服务局部不可用；准备请求返回 `http_service_audit_unavailable` 且不保留授权或发起网络访问。修复审计路径后需重启 Host；见[隔离记录](../iterations/2026-10-17-http-audit-host-isolation.md)。
- 成功响应的 `request_completed` 审计现先于结果 Store 登记。真实 Host 故障注入已验证：终态审计写失败返回 `http_service_audit_unavailable`、结果 Store 不增加记录，原审计仅保留准备与开始阶段。见[顺序修正](../iterations/2026-10-17-http-success-audit-order.md)及[故障复核](../iterations/2026-10-17-http-audit-fault-conformance.md)。

## Host HTTP 路由

所有路由仅绑定当前桌面 Host，并要求桌面 token；请求 body 限制 4 KiB、拒绝未知字段。

```json
{"schemaVersion":1,"pluginId":"com.example.actuator","runtimeId":"...","sessionId":"...","origin":"http://127.0.0.1:8080","endpoint":"health"}
```

Prepare 返回：

```json
{"schemaVersion":1,"operation":"http.get.prepare","grantId":"<opaque>","display":{"origin":"http://127.0.0.1:8080","method":"GET","path":"/actuator/health","addressClass":"loopback","maxResponseBytes":1048576,"timeoutMs":8000}}
```

Commit 只接受 `schemaVersion`、可信 owner、opaque `grantId` 与 `confirmed:true`；操作 ID 由可信父页面创建并逐 View 绑定。结果引用如需跨工具接力，须使用现有 Host 捕获结果/来源证明流程；HTTP service 本身不授权写入或自动传递给其他工具。

当前路由：`/v2/plugin-services/http-get/prepare`、`/commit`、`/cancel`。Prepare 仅解析 URL 字符串并产生确认预览；DNS 查询只能由用户批准后的 Commit 触发。loopback HTTP Host 请求（200/503、302拒绝、在途取消、声明长度和 chunked 流式响应超过1 MiB、深层 JSON复杂度拒绝）、不受信任 loopback HTTPS 拒绝和测试 CA 信任后的 HTTPS 200 成功、真实审计落盘与有界轮转均有定向测试；取消包住 DNS 与 HTTP 全生命周期。操作系统默认根证书路径的 HTTPS 成功、公网 DNS 变化、审计故障恢复、其他响应预算边界和跨平台审计 conformance 仍未验收。当前请求/响应、取消、错误与预算快照见[service.http.get.v1 接口合同](service-http-get-contract.md)；它不代表插件方已兼容。

## 验收门槛

1. 纯单元测试：规范化 origin、userinfo/path/query/fragment/非法端口、IP 分类、mapped IPv6、metadata、混合 DNS 地址、DNS变化与固定解析、endpoint 路径映射。
2. 本地真实 HTTP Host：无 token/错误 owner/无权限/未启用/错误 profile/撤权后拒绝；确认前无网络；一次性授权重放拒绝；请求只含固定 GET、无 body/header、无代理、无重定向。
3. 回环 HTTP 与本地 HTTPS fixture：health 200、health 503 JSON、info/metrics JSON、非 JSON、3xx、超时、取消、超长 chunked body、错误 Content-Length、TLS 错误及 Host shutdown。
4. 插件 View 到可信父界面的真实消息链：用户拒绝无请求、同意后只调用固定 endpoint、停止后不显示迟到结果、插件故障不影响其他工具；检查宽屏/窄屏截图与页面错误日志。
5. DevTools 提供方交付独立包、schema、正反向 fixtures、Windows 真实 Host/Worker/View/Pi 收据；再核对其他目标 OS 的 Host conformance。仅协议或合成测试不增加完整工具接受数。
