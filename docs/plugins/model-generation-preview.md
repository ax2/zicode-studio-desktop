# 插件模型生成预览契约

状态：`model.generate.v1 = 1.0.0-preview.1`，Studio 原生桌面 View 专用。它依赖 `model.catalog.read.v1 = 1.0.0-preview.1`，不等于通用 `service.v1`。提供方不能把该预览当成 DevTools 模型工具已完成接入。

插件清单需用 schemaVersion 2，在 `requiredProfiles` 同时声明上述两个精确版本，并声明 `model.catalog.read`、`model.generate` 权限及用途。两个权限都授予且插件在当前场景启用时，View 可先调用 `window.zicode.services.models.list()` 取得本次运行的不透明 `modelRef`，再调用 `window.zicode.services.models.generate(input)`。WASI Worker、Pi 扩展、普通网页和 LAN/公网客户端不能调用。

`input` 为 `{modelRef,goal,materials,maxOutputTokens,deadlineMs}`。`goal` 必须非空且最多 2048 UTF-8 字节；`materials` 最多 32 项，文本合计最多 32768 UTF-8 字节。每项含 `sourceId`、`displayName`、`sourceKind`、`trust`、`text`；其来源标签来自插件，**Host 不把标签当作可信的文件/结果来源证明**。`maxOutputTokens` 为 1–4096，`deadlineMs` 为 1000–120000。此预览仅接受 Studio 场景配置中明确列出的 OpenAI Completions 兼容模型，不能指定网络地址、凭据或任意模型 ID。

可信父界面从活动 View 注入插件、运行时和会话身份。Host 校验桌面令牌、当前运行目标、插件启用、profile 与权限，匹配 `modelRef` 后固定本次目标，发给父界面一次性 `grantId`、模型名称、目标域名与**实际待发送的完整 JSON 文本**。Studio 使用可滚动的本机选择对话框显示完整文本；用户选择发送后，父界面提交单次授权。拒绝即消费授权且不发网络请求。授权 120 秒过期，最多 8 个待确认；插件 View 从不收到授权 ID 或凭据。

执行由 Host 使用当前场景的凭据代理完成。授权对话框在待确认授权过期时自动关闭；插件 View 的调用等待预算覆盖最长确认期和最长模型请求期。停用/卸载插件或变更单个插件权限时，只清除并取消该插件的待确认与在途授权；其他插件的待确认授权和运行中请求保持有效。插件注册表整体重载仍会全局失效。提交结束时再次核对插件范围的撤权代数和运行目标，失效结果不返回插件。请求禁止 HTTP 重定向，模型响应限 4 MiB，返回的文本限 24576 UTF-8 字节；错误只给固定代码，日志不记录待发送文本或凭据。

模型目录标 `supportsCancellation:true`。可信父界面为每次请求生成并绑定工作区、插件、运行时/会话的 UUID `operationId`。View SDK 可用 `window.zicode.services.models.generate(input,{signal})` 传入 `AbortSignal`；signal 只留在沙箱本地，不会跨 iframe 序列化。Studio 接收取消消息后通过独立桌面 Host 取消端点请求取消；Host 只对匹配的操作令牌生效，并使用可丢弃的异步 HTTP 请求 future 中断在途连接。插件 View 卸载或工作区切换时也会请求取消。取消端点的 `requested` 仅是确认收到请求；原生成调用返回 `model_request_cancelled` 才表示请求 future 已停止。若取消赶不上已完成的模型响应，原请求可正常返回成功结果；Host 撤权/插件失效检查仍会阻止过期结果返回和捕获。未传 `operationId` 的旧调用保持兼容，但不能中途取消。

生成成功后，可信 Studio 父页面可接收 Host 生成的短期结果引用并显示现有“发送到工具/保存”操作；结果引用不经 iframe 消息返回给插件。引用绑定工作区、插件 ID/版本、精确 `model.generate.v1` profile、当前授权及 Host 捕获的文本，15 分钟到期；全局最多 64 条/2 MiB，单条受现有文本结果上限约束。插件停用、撤权或包/profile 更新会令来源证明失效。每次发送仍先显示目标字段映射与内容，用户确认后才调用本地 WASI 接收工具；保存仍先显示文本与位置，用户确认后写入工作区产物库。捕获失败时仍显示模型文本，但不提供复用/保存操作。

提供方 `service.v1` 草案中的 `consentId`、长任务事件、MCP、数据库、网络探针、运行中取消及通用跨工具来源证明尚未实现。DevTools 若要使用此预览，需由其独立插件 View 调用 SDK，不能从 WASI 伪造授权；模型工具完整验收仍需签名提供方包、真实模型授权/请求、原生运行环境和跨平台证据。

## 本机 Host 验证（2026-10-15）

Rust HTTP 集成回归 `host_server::plugin_services::tests::model_generation_result_is_captured_and_save_requires_confirmation`：真实 Studio Host、隔离 profile、合成插件和仅监听 `127.0.0.1` 的兼容模型服务，覆盖模型目录、完整发送预览、拒绝后不调用、明确确认后生成、Host 结果捕获、第二个在途请求的取消路由/ACK/终态、取消后模型连接确实关闭且没有结果引用，以及保存预览、拒绝写入及确认后工作区产物创建。最终代码下该专项通过。另有 owner/workspace 绑定单测和撤权取消令牌单测。

此证据覆盖 Rust Host/HTTP、在途请求 future 取消及保存授权边界；前端定向测试覆盖 View 取消消息到 Host Gateway。尚未覆盖实际 DevTools View 在 WebView2 中带 AbortSignal 的交互、用户已配置的真实模型服务、插件发送到 WASI 工具或跨平台原生验收。测试使用合成响应，不代表任何模型质量或外部服务兼容性结论。
