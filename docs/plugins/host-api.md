# Plugin Host API

本文命名空间是总体设计，不能据此假设全部已经提供。当前隔离View资源读取候选的实际签名与限制见下面的resources节；尚未实现的接口不能由提供方发布为已支持。

成功 WASI 结果的 `result.json.v1` 为单独的显式 Host 候选 profile，详见[结构化结果协议](result-json-profile.md)。它不向插件 View 增加跨插件操作，也不改变默认文本 v1 结果。

## 当前隔离View资源读取候选

源码SDK提供 `zicode.resources.read({capabilityId,resourceId,contentVersion,offset?,length?})`，返回确认资源的有界Base64分块；不是文件路径读取。每次最多32KiB，默认偏移0，SDK最多32项等待、30秒超时。身份由可信父窗绑定，结果版本/偏移/编码严格校验；目标变化或View销毁后不再交付结果。桌面token不交给插件，子窗仍为opaque sandbox且connect-src none。

参见[资源输入候选draft.4](resource-input-contract.md)。源码可信父窗已提供选择/确认与引用事件：`zicode.resources.getSelected()`返回三个字段的已确认引用或null，`onAvailable(listener)`提供可dispose订阅。确认前不交付引用，插件不能调用文件选择或代替用户确认。Windows真实Tauri开发程序已验证管理页启用/授权、确认前零上传、确认后隔离View读取和撤销拒绝；文件通过自动化设置真实WebView文件控件，尚未验收操作系统文件对话框。真实DevTools资源包、WASI消费、输出保存、其他OS和新冻结交付仍待完成，不能声明resource.v1完整可用。下文“所有调用支持AbortSignal”等是设计目标，本次read(options)没有AbortSignal，SDK超时不等于取消Host工作。

## 调用模型

插件 UI 通过受限 `postMessage` Bridge 使用 SDK；后台 Runtime 使用同一套消息协议。
SDK 不暴露原始 WebSocket、Tauri Invoke 或 Rust 路由。每次调用包含：

```json
{
  "type": "plugin_request",
  "requestId": "opaque-id",
  "pluginId": "com.zicode.notes",
  "apiVersion": "1.0",
  "operation": "capabilities.invoke",
  "parameters": {},
  "context": {
    "sceneId": "writing",
    "workspaceId": "opaque-workspace",
    "sessionId": "opaque-session"
  }
}
```

Host 根据已认证的插件上下文覆盖 `pluginId` 和 Context，绝不信任插件自行填写的身份。
Mutation 必须带幂等键；所有调用支持 AbortSignal、超时和结构化错误。

## SDK 命名空间

### `zicode.commands`

```ts
registerHandler(commandId, handler): Disposable
execute(commandId, args?, options?): Promise<unknown>
list(filter?): Promise<CommandDescriptor[]>
```

插件只能为自己的 Manifest Command 注册 Handler。调用其他插件 Command 需要
`commands.execute` 权限，目标 Command 还可以声明允许的调用方。

### `zicode.views`

```ts
open(viewId, options?): Promise<void>
reveal(activityId): Promise<void>
setBadge(activityId, badge | null): Promise<void>
setTitle(viewId, title): Promise<void>
```

Badge 只接受短文本或计数。插件不能隐藏 Chat Activity、系统设置、权限提示或当前
审批 UI。

### `zicode.context`

```ts
getActive(): Promise<ActiveContext>
onDidChange(listener): Disposable
set(pluginOwnedKey, value): Promise<void>
```

插件只能写入 `plugin.<own-id>.*` Context Key。`sceneId`、工作区信任、Pi 连接状态由
Host 维护。

### `zicode.storage`

```ts
global.get(key): Promise<JsonValue | undefined>
global.set(key, value): Promise<void>
scene.get(key): Promise<JsonValue | undefined>
scene.set(key, value): Promise<void>
files.readText(relativePath): Promise<string>
files.writeText(relativePath, content, options?): Promise<void>
files.list(relativePath?): Promise<PluginFileEntry[]>
```

所有路径相对于插件获授权的数据根目录。单次读写、总容量和文件类型有配额；`..`、
绝对路径、链接逃逸和设备路径被 Rust 侧拒绝。

### `zicode.secrets`

```ts
create(label, secret): Promise<SecretRef>
resolveForRequest(secretRef, request): Promise<ResponseHandle>
delete(secretRef): Promise<void>
```

默认不向插件 JavaScript 返回已有密钥明文。网络请求优先通过 Host 注入凭据并返回脱敏
响应句柄。读取明文需要单独的高风险权限，内置插件也必须说明用途。

### `zicode.net`

```ts
fetch(request, options?): Promise<PluginResponse>
```

Host 检查 `network.fetch` 权限、用户动作来源、域名规则、重定向链、响应大小和超时。
默认拒绝环回地址、私网地址、`file:`、非 HTTP(S) 协议和从公网重定向到私网。场景策略
可以进一步收紧域名。

### `zicode.capabilities`

```ts
registerHandler(capabilityId, handler): Disposable
invoke(pluginId, capabilityId, input, options?): Promise<JsonValue>
```

输入与输出按 Manifest Schema 校验。调用链携带调用者 `chat`、`pi`、`plugin` 或
`user`，插件可按调用者决定是否需要确认。循环调用在 Host 中检测并拒绝。

### `zicode.pi`

```ts
getActiveSession(): Promise<PiSessionSummary | null>
getCapabilities(): Promise<PiRuntimeCapabilities>
sendPrompt(input, options): Promise<PiTurnHandle>
addContext(items, options): Promise<void>
request(command, parameters, options): Promise<unknown>
```

权限分层：

- `pi.session.read`：读取当前会话的有限摘要；
- `pi.prompt.send`：以明确来源向当前会话发送消息；
- `pi.context.add`：向下一轮加入带来源、可移除的上下文；
- `pi.runtime.control`：模型切换、压缩等受控操作；
- `pi.rawRpc`：仅内置核心插件，第三方插件不可申请。

`sendPrompt` 必须显示“由哪个插件发起”，默认不能在后台静默开始付费模型调用。插件不能
伪造用户消息、修改历史 Session JSONL 或绕过当前 Scene Tool Allowlist。

### `zicode.workspace`

```ts
getRoots(): Promise<AuthorizedRoot[]>
readText(resource): Promise<string>
writeText(resource, content, options?): Promise<void>
pickFile(options?): Promise<ResourceHandle | null>
```

资源使用不透明 Handle，不把任意绝对路径作为跨边界参数。写入需要
`workspace.write`，且仍受当前工作区授权、Scene Policy 和用户审批约束。

### `zicode.ui`

```ts
showInformation(message, actions?): Promise<string | undefined>
showWarning(message, actions?): Promise<string | undefined>
showError(message, actions?): Promise<string | undefined>
showProgress(options, task): Promise<unknown>
openExternal(url): Promise<void>
```

系统审批、权限和密钥窗口使用 Host UI，插件不能自绘成系统授权对话框。

## Notes Host API

P5 内置 Notes 使用同源 Host 路由，不向前端暴露任意文件系统路径：

| 路由 | 用途 |
| --- | --- |
| `GET /v2/notes` | 笔记本、标签和过滤后的笔记摘要 |
| `POST /v2/notes/notebooks` | 创建 Astro 兼容 Vault |
| `GET /v2/notes/note` | 读取一篇完整笔记 |
| `POST /v2/notes/create` | 创建 Markdown 笔记 |
| `POST /v2/notes/save` | 使用 `expectedVersion` 保存 |
| `POST /v2/notes/delete` | 使用 `expectedVersion` 删除 |
| `POST /v2/notes/capture` | 受控采集公开网页 |
| `POST /v2/notes/attachments` | 保存 5 MiB 内的受限附件 |
| `GET /v2/notes/attachment` | 经权限检查读取附件 |
| `POST /v2/notes/import-markdown` | 导入 Markdown 文件 |
| `GET /v2/notes/export` | 导出可读 JSON 备份 |
| `POST /v2/notes/import-backup` | 校验并导入备份 |
| `POST /v2/notes/rebuild` | 重建可删除索引并报告损坏内容 |

所有路由按 Scene 重新检查 Notes 启用状态和 `storage.plugin`；采集额外检查
`network.fetch`。版本不一致返回 `version_conflict`，客户端必须重新加载，不能自动
覆盖。采集的 SSRF、凭据、响应大小和 HTML 清理边界见
[Notes 内置插件](notes.md)。

## Artifacts Host API

P6 内置 Artifacts 使用同源 Host 路由，并只返回不含本地路径的资源句柄：

| 路由 | 用途 |
| --- | --- |
| `GET /v2/artifacts` | 按 Scene、类型、来源插件和查询词列出产物 |
| `GET /v2/artifacts/item` | 读取完整内容并校验 SHA-256 |
| `POST /v2/artifacts/create` | 保存有界内容和来源信息 |
| `POST /v2/artifacts/delete` | 使用 `expectedVersion` 删除 |

所有路由检查 Artifacts 在当前 Scene 已启用且获 `storage.plugin` 权限；创建还检查
`pluginId` 对应的来源插件在同一 Scene 已启用。内容上限 1 MiB，来源上限 32 KiB，
每 Scene 最多 2,000 条。完整数据模型与 Finance 集成见
[Artifacts 内置插件](artifacts.md)。

## Pi Tool Broker

当前 P4 基础链已实现：

- `GET /v2/plugin-capabilities?sceneId=...` 返回当前场景已启用的 Capability；
- `POST /v2/plugin-capabilities/invoke` 供 Chat/应用层调用；
- `POST /v2/plugin-tools/invoke` 只接受 Native Runtime 的 Bearer Token；
- Host 只保存 Token SHA-256，Token 与 Runtime/Session 绑定并在 Runtime 停止后失效；
- Manifest 校验 Pi Tool 到 Capability 的映射与工具名，当前场景拒绝重名工具；
- `notes.search`、`notes.get` 和 `notes.create` 在 Host 内执行；搜索只返回插件数据根
  目录下的相对路径；
- 独立插件 Worker 的完整序列化请求上限 256 KiB、输出上限 1 MiB；通用 Capability 入口另有 16 MiB 预检上限，供内置图片/文档能力使用，不能据此认为独立插件可接收 16 MiB 参数。Pi 调用按 Runtime + `toolCallId` 幂等；
- 审计为 JSONL，只记录调用元数据和输入哈希，不记录输入、结果或密钥。

隔离 Worker Runtime、调用取消的 Host 侧主动传播、真实并发配额和长任务 Handle 尚未
实现；Developer Capability 因此返回 `plugin_not_active`。

Pi 启动时，Rust Host 根据当前 Scene 生成已启用工具注册表：

```text
Plugin Manifest piTools
  → permission and scene policy filter
  → bounded tool schema snapshot
  → zicode-plugin-broker registers Pi tools
  → model invokes tool
  → broker POSTs to loopback Host with one-runtime token
  → Host validates runtime, plugin, permission, schema and approval
  → plugin capability handler
  → bounded structured result returned to Pi
```

代理请求必须包含 `runtimeId`、`sessionId`、`toolCallId`、工具名和输入哈希。Host 使用
`toolCallId` 提供幂等语义。默认限制：

- 激活 5 秒；
- 普通调用 30 秒，长任务显式返回 Task Handle；
- 输入 256 KiB；
- 结构化输出 1 MiB；
- 同一插件最多 4 个并发工具调用；
- 用户取消 Agent Turn 时传播取消信号。

超时、取消、权限拒绝、插件不可用和 Schema 错误使用稳定错误码，不把堆栈、密钥或 Host
路径返回给模型。

## 事件

首版事件：

- `app.ready`
- `scene.changed`
- `workspace.changed`
- `session.changed`
- `pi.connectionChanged`
- `permissions.changed`
- `theme.changed`
- `plugin.willDeactivate`

事件按插件队列顺序投递，有界缓存；慢消费者会收到丢失事件标记并必须重新读取快照。

## 稳定错误码

| 错误码 | 含义 |
| --- | --- |
| `plugin_not_enabled` | 当前场景未启用 |
| `plugin_not_active` | 激活失败或后台运行器不可用 |
| `permission_denied` | 权限未授予或被 Scene Policy 收紧 |
| `invalid_parameters` | 输入不符合 Schema |
| `resource_not_found` | Handle 或资源不存在 |
| `conflict` | Command、Tool 或数据版本冲突 |
| `cancelled` | 用户或调用方取消 |
| `deadline_exceeded` | 超时 |
| `quota_exceeded` | 大小、容量或并发超限 |
| `provider_unavailable` | Pi、网络或依赖服务不可用 |
| `internal` | 已脱敏的内部错误 |
