# 资源跨工具确认授权候选

2026-10-10；`resource.transfer.draft1` 是 Studio 内部候选，未加入公开 supported profiles。提供方不得据此改动冻结包或宣称正式 `resource.v1` 支持。

## 目的

将一个工具的资源输出交给另一个独立插件工具，保留来源、权限和生命周期。准备阶段不授权接收端读取，也不执行工具；可信 Studio 界面展示接收工具和数据范围，用户单独确认后取得目标专属引用。保存到磁盘另行授权。本轮先实现 Host 协议和验证，用户界面接线仍待。

## 接口

两个路由仅接受本机桌面凭据，不向 Broker 或隔离 View bridge 开放。所有结构拒绝未知字段。`Access` 是 `{schemaVersion:1, owner, resourceId, contentVersion}`；`owner` 是 `{runtimeId, sessionId, pluginId, capabilityId}`。

### 准备

`POST /v2/plugin-resources/prepare-transfer`

请求：`{schemaVersion:1, source:Access, target:Owner}`。

源须已确认可读，且全部祖先授权有效；目标须启用、获 resource.read、存在指定能力，并声明 `resource.wasi.input.draft2`。源与目标须在同一 runtime/session 且为不同工具。跨运行会话不隐式授权。

返回：`schemaVersion, profile, grantId, expiresInSeconds:60, requiresConfirmation:true, saved:false`；source 含插件/能力/资源/摘要，target 含 Host 读取的 pluginId/capabilityId/pluginName/pluginVersion/toolTitle，另有 mimeType/byteLength。不返回字节或目标资源 ID。可信 UI 必须按纯文本展示元数据，不把名称作为权限证明。

### 确认

`POST /v2/plugin-resources/commit-transfer`

请求：`{schemaVersion:1, source:Access, grantId, confirmed:true}`。不能覆盖接收端、路径或授权证明。未确认请求被拒绝。Host 从票据读取目标并重新检查双方证明、完整来源链及当前资源配额；成功才登记目标 owner 专属新资源。

返回：`{schemaVersion:1,profile,status:"committed",replayed,reference:{capabilityId,resourceId,contentVersion},saved:false}`。引用可作为接收工具资源调用的输入；确认只授权共享，不自动执行接收工具。目标独立 View 如何接收新引用、工具选择/输入保留和实际用户确认仍须界面验证。

同一未过期票据重复确认返回同一引用，不复制/再次登记。不保证重启后持久幂等；目标引用撤销、来源撤销、证明变化或票据过期后拒绝重放，不静默重新共享。

固定拒绝分类：`desktop_only`（非桌面凭据）、`resource_confirmation_required`（未确认）、`resource_transfer_scope_invalid`（同工具或跨会话）、`resource_transfer_busy`（票据上限）、`resource_transfer_unavailable`（不存在/过期/来源不匹配）、`resource_authorization_changed`（证明改变）、`resource_budget_exceeded`（登记配额）。已有权限/profile/资源失效分类沿用。客户端须用固定友好提示，不能透传任意服务端消息；更改接收端必须重新准备和确认。

## 资源与授权

最多16张票据，60秒自动过期，票据不持有字节、不预留目标资源配额。确认时沿用32条/128MiB资源配额，目标按完整长度计费。不可变 Arc 分块允许接力共享内存底层数据，锁内只复制分块引用。输出和输入写入后均不可变。

目标引用最长900秒且不超过直接来源剩余寿命；保留显式来源 Access/proof。源资源撤销或过期时级联删除下游；源插件权限、版本、模块、凭据或会话变化由每次读取、Worker运行前/期间/结束和输出发布前的祖先检查阻止。恢复权限不是恢复旧证明。相同 owner 在一次检查内复用证明，避免长链反复读取同一模块；不同 owner 分别复核。

本候选不暴露任意路径、不授权文件写入、不启动 DevTools.exe。数据已交给 Worker 后无法收回已复制字节；授权失效会阻止后续读取/结果交付，现有 Worker watcher 请求取消。不是外部文件系统变化的原子历史证明。

## 验证范围与后续

定向 Store/请求测试覆盖准备无读取权、owner隔离、重复确认、目标撤销不重建、来源链级联、过期、证明改变、同会话限制、票据上限和登记配额。实际 HTTP/生产 Worker 专项验证源工具原始输出→确认共享→目标工具实际消费，及源/目标撤权重授拒绝和独立资源不受影响；终态以阶段收据为准。

仍需：可信界面的接收工具搜索/分页/按需加载、确认详情与取消、切换目标失效处理、交付到接收 View 的引用、真实 DevTools 图片/文件算法、跨运行会话协议、持久审计/幂等、确认保存/冲突恢复和其他OS。完整154工具状态继续单列，不因 Host 基础通过改变接受计数。

多跳链上限由32条资源记录约束；不同 owner 的模块证明逐项复核。最大深度/多插件链的低端CPU、读取成本和峰值内存尚未压测，不以短链样例推断性能接受。

## 提供方接入需求（未向其他会话发送）

可信父级接收端目录、按需参数、明确共享确认和独立运行界面现已实现，验证边界见[界面说明](resource-transfer-ui.md)。上文“仍需”的界面项是此前Host阶段记录，原生GUI及真实提供方算法仍须独立验收。

- 后续另交有独立版本的新资源候选包；不要原地修改现有冻结包。消费工具使用已定义input draft2，产生资源的工具另显式选择output draft1；正式发布仍等待双方协议定版。
- 工具算法须通过资源ABI读入/输出，不读取Studio目录、宿主凭据或独立版配置；保留非null、符合声明schema的JSON结果与严格资源描述符。
- 提供完整工具子功能、格式/MIME、失败/取消/预算案例及支持OS证据。Host复制夹具不能替代提供方算法验收。Studio继续负责用户确认和跨工具引用，不要求提供方自行实现桌面转授权接口。
