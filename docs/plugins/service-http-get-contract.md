# `service.http.get.v1` 插件接口合同

状态：Studio Host/View 实现合同，版本 `1.0.0-preview.1`。该文件定义插件方可消费的稳定边界；它不是任意网络 API，也不表示 ZiDevTools 已交付或某个目录工具已验收。

## Manifest

插件必须使用 manifest `schemaVersion: 2`，精确声明 profile 版本及可选权限：

```json
{
  "requiredProfiles": { "service.http.get.v1": "=1.0.0-preview.1" },
  "permissions": {
    "optional": [
      { "name": "service.http.read", "reason": "Read a user-confirmed service endpoint" }
    ]
  }
}
```

未获授权限、插件未启用、profile 不匹配或 runtime/session 不属于当前工作区时，Host 拒绝请求。View 不自行调用网络，也不获取 Host token、grant ID 或 DNS 结果。

## View 调用

```js
const result = await window.zicode.services.http.get(
  { origin: "http://127.0.0.1:8080", endpoint: "health" },
  { signal },
);
```

`origin` 必须是仅含 scheme、host、port 的 URL origin。允许的 `endpoint` 是 `health`、`info`、`metrics`；Host 固定映射到 `/actuator/health`、`/actuator/info`、`/actuator/metrics`。View 不得传路径、查询、请求头、请求体或 HTTP method。父页面显示完整目标和网络风险并取得本次确认后才调用 Host；拒绝会返回 `status: "declined"`，不发送网络请求。

View Promise 成功时返回下列对象；业务响应里的 JSON `data` 保持原样：

```json
{
  "schemaVersion": 1,
  "operation": "http.get",
  "result": {
    "endpoint": "health",
    "status": 503,
    "contentType": "application/json",
    "data": { "status": "DOWN" },
    "byteLength": 17
  }
}
```

Host 路由响应还可能有 `resultRef` 或 `resultCaptureError`，但可信父页面不会把它们暴露给 View；父页面独立挂接结果动作。`health` 接受 2xx 及 503 JSON；`info`、`metrics` 仅接受 2xx JSON。插件须将 HTTP 503 显示为诊断数据，不得冒充传输失败。其他状态、非 JSON、无效 JSON、超预算 JSON 均以 Promise rejection 返回 Host 错误。

## Host 路由合同

所有路由为 Studio 当前桌面进程内的 HTTP POST，要求 `x-zicode-desktop-token`。请求体不得超过 4 KiB，未知字段一律拒绝。Studio 前端网关负责注入并保管 token；插件 View 不得直接访问这些路由。

### Prepare

`POST /v2/plugin-services/http-get/prepare`

```json
{
  "schemaVersion": 1,
  "workspaceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "runtimeId": "runtime-opaque-id",
  "sessionId": "session-opaque-id",
  "pluginId": "com.example.actuator",
  "origin": "http://127.0.0.1:8080",
  "endpoint": "health",
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
}
```

成功预览：

```json
{
  "schemaVersion": 1,
  "operation": "http.get.prepare",
  "grantId": "opaque-single-use-grant",
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "expiresInMs": 60000,
  "display": {
    "origin": "http://127.0.0.1:8080",
    "method": "GET",
    "path": "/actuator/health",
    "endpoint": "health",
    "addressClass": "loopback",
    "https": false,
    "maxResponseBytes": 1048576,
    "timeoutMs": 8000
  }
}
```

`addressClass` 是 `public`、`private`、`loopback`、`hostname` 之一。hostname 仅表示尚未获准解析；用户批准后 Host 才解析，并拒绝非公网解析结果。Prepare 不做 DNS 查询或连接。origin 规范化后显示在确认界面，用户确认必须与此 grant 和 operation 一一对应。

### Commit

`POST /v2/plugin-services/http-get/commit`

```json
{
  "schemaVersion": 1,
  "workspaceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "runtimeId": "runtime-opaque-id",
  "sessionId": "session-opaque-id",
  "pluginId": "com.example.actuator",
  "grantId": "opaque-single-use-grant",
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "confirmed": true
}
```

`confirmed: false` 返回 HTTP 200 与 `{"schemaVersion":1,"operation":"http.get","status":"declined"}`。`true` 才会执行一次固定 GET。grant 60 秒过期、绑定 owner/operation、只可消费一次；拒绝、撤权、禁用、卸载和插件列表重载不会留下可重放授权。

### Cancel

`POST /v2/plugin-services/http-get/cancel`

```json
{
  "schemaVersion": 1,
  "workspaceId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "runtimeId": "runtime-opaque-id",
  "sessionId": "session-opaque-id",
  "pluginId": "com.example.actuator",
  "operationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
}
```

响应 `status` 为 `requested` 或 `finished`，并带 `executionFinished`。`requested` 是取消信号已接收，不是 Host/网络执行已经结束；调用方继续等待原 commit Promise 的最终终态。重复取消或已完成操作返回 `finished`。

插件 View 的 `services.http.get(input, { signal })` 在 `AbortSignal` 中止时向可信父页面发送该调用的取消请求；View 等待原操作终态。View 的 75 秒请求等待预算覆盖最多 60 秒的确认弹窗和最多 8 秒的网络请求，并留出准备与结果传递余量；到期也发送取消请求，但本地 Promise 会以 `plugin_view_timeout` 结束，不能据此推定 Host 已停止。Host 终态、审计与副作用边界仍以 cancel/commit 协议为准。预先已中止的信号不提交请求。

若取消发生在可信授权弹窗等待期间，父页面通过弹窗的 `dismissSignal` 结束该次确认，并拒绝提交已取消的 grant。取消仍需等待 Host 原操作终态；弹窗关闭本身不代表网络操作完成。

弹窗仅对其自身的第一次终态执行清理；若取消信号晚于用户确认或拒绝，不能清空随后打开的另一弹窗。

## 错误与资源预算

HTTP 错误 envelope 为 `{"error":{"code":"...","message":"..."}}`。调用方按稳定 `code` 分类，不展示或记录原始网络异常、URL 私密部分、凭据或响应正文。主要 profile 错误码：

| 场景 | 错误码 |
| --- | --- |
| 输入、owner、origin 或 endpoint 无效 | `http_service_input_invalid`、`http_service_origin_invalid` |
| workspace、runtime、插件、profile、权限或 grant 不可用 | `model_workspace_unavailable`、`runtime_stopped`、`service_plugin_unavailable`、`http_service_profile_required`、`permission_denied`、`http_service_grant_unavailable` |
| 同插件/全局并发上限 | `http_service_plugin_busy`、`http_service_busy` |
| DNS 或目标地址拒绝 | `http_service_dns_timeout`、`http_service_dns_failed`、`http_service_address_blocked`、`http_service_mixed_addresses`、`http_service_address_changed`、`http_service_dns_changed`、`http_service_https_required` |
| 网络响应拒绝 | `http_service_request_failed`、`http_service_timeout`、`http_service_request_cancelled`、`http_service_redirect_blocked`、`http_service_status_error`、`http_service_content_type_invalid`、`http_service_json_invalid` |
| 响应或 Host 状态边界 | `http_service_response_too_large`、`http_service_json_complexity_exceeded`、`http_service_authorization_changed`、`http_service_audit_unavailable`、`http_service_unavailable` |

Host 将稳定 code 放在 envelope 内；具体 HTTP 状态以当前路由响应为准。权限拒绝和目标策略拒绝不应自动重试。只有 `health` 的 HTTP 503 属于业务数据。

- HTTP 总时限 8 秒、连接最多 3 秒、DNS 最多 3 秒；全局最多 2 个在途调用，每个插件最多 1 个。
- 请求没有用户自定义 header、cookie、authorization、代理或 body；Host 只发送固定 `Accept: application/json` 和固定 Studio User-Agent，不跟随重定向。
- JSON 响应上限 1 MiB；解析后最大深度 32、值与对象键合计最多 20,000 个节点、单个对象键 UTF-8 最多 16 KiB。超界返回 `http_service_json_complexity_exceeded`。
- HTTPS 使用系统默认证书验证；不支持忽略 TLS 错误或插件自带 CA。公网仅 HTTPS；HTTP 只允许用户确认的 loopback/RFC1918 地址。多地址解析须全部属于同一允许类别，连接地址被固定并在连接前复查 DNS。

Host 的结构化审计不保存响应正文、token、cookie、插件自由文本或 URL 路径/查询。当前/单份轮转文件分别有 1 MiB 硬上限。

## 验收边界

Host 单测和 loopback conformance 已覆盖固定 endpoint、无确认不连接、200/503、拒绝重定向、取消终态、审计落盘、1 MiB 与 JSON 复杂度预算。HTTPS 测试先拒绝未信任的本地 CA，再仅在测试状态中信任该根并通过完整 Host 路由验证证书 SAN 与 200 结果；正式 Host 不接受插件或用户注入根证书。操作系统默认根证书成功路径、DNS变化/公网域名、Host shutdown 与审计故障恢复、真实 Pi 加载和 DevTools View/算法仍未验收。插件方应交付独立 manifest/View、逐 endpoint 正反例与精确版本清单；Studio 再按发现、按需加载、真实 Pi→Host→View、取消/撤权和结果接力逐项验收。该合同不改变 DevTools 总工具矩阵的接受数。
