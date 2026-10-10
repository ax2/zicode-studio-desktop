# 资源输入授权接口候选

2026-10-09，标识 `studio.resource-input/1.0.0-draft.4`，请求schemaVersion=1。仅源码候选，不表示resource.v1完整支持，也未冻结Windows交付。首批compute.wasi.v1契约保持不变。draft.4在draft.3的隔离View读取上增加可信父窗选择/确认和引用交付；旧材料见阶段档案，不代表旧交付已更新。

便携请求约束见[JSON Schema](resource-input.schema.json)，每条路由选对应定义；revoke使用access。该schema描述可接受请求，状态/预算/身份仍由Host检查，contentEncoding/format注解不能代替严格Base64与UUID校验。

## 身份与权限

Owner为 `{runtimeId,sessionId,pluginId,capabilityId}`。Host从实际存活的运行实例派生workspace/scene，不接受插件传本机路径或覆盖工作区。插件必须启用、声明并获得resource.read授权，指定能力必须可用。沿用WASI包/模块完整性与目录修订证明，插件版本、权限或目录发生变更会使旧资源不可读，重新授权不会复活旧证明。

新Pi实例由temporary会话绑定正式会话时，Broker凭据仍来自启动环境。Host仅根据运行实例保存的不可变启动目标允许该次绑定，工作区/场景/实例必须一致；Broker可提交启动或当前正式会话，后续作用域始终派生为当前目标。资源Owner只接受当前实际会话，已有资源不会从临时会话自动迁移。未知别名、不同工作区、停止实例和过期/轮换凭据仍拒绝，不能用字符串前缀推定任意会话等价。原生发现及回归见技术博客iterations/native-resource-input-2026-10-09；运行重启/凭据刷新全生命周期仍需继续验证。

资源ID随机生成、绑定Owner及包/权限证明；内容版本是64字符小写SHA-256。它是已上传字节快照的身份，不是本机文件路径或实时文件监视器。插件尚不能从现有一次stdin/stdout WASI调用回调Host；Pi HTTP资源读取也尚未注册成模型工具。

## HTTP候选（全部POST）

| 路径 `/v2/plugin-resources/` | 请求 | 授权及返回 |
| --- | --- | --- |
| prepare | `{schemaVersion:1,owner,mimeType,byteLength,contentVersion}` | 可信桌面token；返回resourceId、maxChunkBytes=65536、maxChunks=512、expiresInSeconds=120、confirmed=false；不向插件授权 |
| append | `{access,offset,dataBase64}` | 可信桌面token；严格Base64，offset必须等于已上传长度；返回uploadedBytes，不自动重试、不覆盖已传块 |
| commit | `{access,confirmed:true}` | 可信桌面token；确认精确字节长度及摘要后冻结资源，返回mimeType/byteLength/contentVersion/confirmed；重复commit不续期 |
| read | `{access,offset,length}` | Broker Bearer和Owner运行身份；仅确认后可读，length=1..65536，返回同版本、offset、byteLength、eof、dataBase64 |
| read-view | `{access,offset,length}` | 可信桌面token；父窗派生Owner，Host复核当前实例/权限/包证明；仅确认后可读，length=1..32768 |
| revoke | access | 可信桌面token；绑定Owner/版本撤销，重复撤销成功；实例停止或插件撤权后仍能释放资源 |

Access为 `{schemaVersion:1,owner,resourceId,contentVersion}`；请求/子对象拒绝未知字段。读取从EOF位置返回空块，超过EOF或负偏移拒绝，最后一块允许不足length。客户端必须检查版本/偏移及eof。请求接受不代表用户已选择文件；可信原生界面必须实际展示和获取同意，不能由插件伪造confirmed。

## 预算与数据边界

- 单资源最多32MiB、全Host最多32条/128MiB预留字节；未上传草稿也占预留预算。分块各64KiB，每资源最多512块，防止大量微小块的元数据绕过内存预算；建议除最后一块外均使用64KiB。所有字节只暂存内存，不自动落盘、读取文件、保存、输出日志或发送模型。
- 草稿120秒，确认后900秒；后续操作清理过期记录，Host结束全部释放。当前是惰性过期清理，内存上限持续有效；不是定时清零保证。
- 所有资源操作共享8项实际工作配额，满载立即返回429/resource_busy，不排入无限等待队列。配额由执行线程持有；HTTP等待者断开不释放仍在运行的工作，失败或panic结束释放。客户端可提示稍后重试，不自动重新提交上传/确认操作。该配额只约束资源操作，不是全Host网络请求/插件计算的总并发保证。
- MIME只允许octet-stream、text/plain、PNG/JPEG/WebP。标签来自可信入口，不等于已解码/验证图片；后续图片Worker必须另设像素、编码、方向、动画及解码膨胀限制。
- 内容不支持原地修改；变化的材料必须新资源/新确认。取消上传使用revoke，已返回给读取者的字节不能撤回。读取不能自动传给其他工具或赋予保存权限。
- 脱敏错误只给固定码；不返回原始输入、凭据、本机路径或内部异常。permission_denied、runtime_stopped、resource_unavailable、resource_content_mismatch、resource_upload_conflict、resource_confirmation_required和预算/协议错误应分别提示。

## 实现与验收边界

源码为host_server/plugin_resources、独立store及operations配额模块；HostState/路由只作最小接线。包身份校验、资源锁与摘要计算都在线程池中执行，避免占用异步HTTP线程。资源证明另绑定Broker凭据代次，读取必须与实际鉴权得到的代次一致，不能由同ID新实例沿用旧资源。HTTP验证采用实际Host监听器和测试运行实例/派生包身份，覆盖通道和权限，不运行图片算法，也不能算DevTools完整工具接入。配额测试实际启动八个工作线程并等就绪，确认超限不执行、等待任务中断不释放仍存活工作、释放后恢复及失败/panic回收；不等于原生界面或插件算法失败隔离验收。记录见技术博客iterations/plugin-resource-input-2026-10-09及plugin-resource-concurrency-2026-10-09，终态以工作日志为准。

待实现/验收：操作系统文件对话框、真实DevTools资源消费包、WASI资源承载/读取或有界预装协议、二进制输出与可信预览、跨工具接力、确认保存/冲突恢复、持久审计、完整生命周期与逐OS验收。Windows Tauri开发程序的资源输入/隔离View读取专项已验证，不能推定整个资源profile完成。只有这些协议及真实链路完成后才能发布resource.v1支持声明。当前全154工具完整验收计数不变。

## 隔离View读取候选（draft.3）

实际注入SDK提供 `await zicode.resources.read({capabilityId,resourceId,contentVersion,offset?,length?})`，默认offset=0、length=32768。拒绝未知字段，不接受runtimeId/sessionId/pluginId/workspaceId/路径。父窗使用已挂载View所属插件和当前运行目标生成Owner，调用read-view；桌面凭据只留在可信父窗，子窗不能访问HTTP或父窗DOM。

返回仅含schemaVersion、resourceId、contentVersion、offset、byteLength、eof、dataBase64。父窗校验版本、偏移、长度、规范Base64和EOF后才返回，剔除未知字段；运行目标变化或View销毁后的结果丢弃。每个SDK最多32项等待请求，30秒到期后删除等待记录；迟到结果不交付。超时不是Host工作已终止或写入回滚。每次最多32KiB，适配现有消息桥64K字符预算，不可通过增大length绕过。

错误以固定码区分resource_request_invalid、resource_view_changed、resource_gateway_unavailable、resource_response_invalid，以及允许公开的Host权限/资源/忙碌码；其他异常统一resource_read_failed，不转发原始异常。插件SDK只消费已确认资源，不提供上传、确认、选择文件、保存或跨工具授权。draft.4的选择/确认由可信父窗拥有，不能由插件调用来代替用户同意。

验证记录见技术博客iterations/plugin-resource-view-2026-10-09。普通Rust测试未设置显式浏览器探针时只验证Host HTTP边界；浏览器专项必须另有成功证据，不能由单元测试推断真实View接入。

## 可信选择与引用交付（draft.4）

仅主View且已获resource.read、当前目标有运行实例/会话时显示Studio选择区域。用户通过可信父窗HTML文件控件选择单个文件，先显示名称、大小、插件名称/版本和接收能力；未确认不读取字节、不上传、不向插件交付引用。确认后在父窗计算摘要，以64KiB顺序分块调用prepare/append/commit。未知MIME按octet-stream处理，不作图片解码或安全类型判定。

同一父窗最多一个实际上传，取消后在途工作完成/清理前不启动第二个文件读取，防止重复取消造成无限快照分配。单文件32MiB；每步检查110秒上传截止和View/目标有效性，HTTP请求沿用30秒超时。截止检查不抢占文件读取、摘要计算或当前HTTP，也不意味着立即终止Host工作。当前父窗会持有整个有界文件快照，尚不是流式文件读取实现。

确认成功后子窗收到资源事件，`zicode.resources.getSelected()`返回只含capabilityId/resourceId/contentVersion的冻结引用，未授权或撤销后返回null；`zicode.resources.onAvailable(listener)`接收引用或null，并返回带dispose()的订阅。可直接使用read(reference)。文件名、Owner、路径、Desktop token不进入引用。事件不自动执行工具/模型调用；提供方决定如何在自己的View处理已授权输入。

取消、替换文件/接收能力、销毁View或切换目标时使旧交付无效并请求revoke；在prepare/commit返回后才发现取消也会请求撤销。已被插件读出的字节无法撤回。网络或配额导致撤销失败时依赖原有过期和预算，不宣称立即释放；取消本身不是写入回滚。上传错误不转发原始服务异常到可信界面或插件。本轮未增加跨插件/工作实例接力、保存或输出授权。

真实Chrome验收使用实际源码控件/SDK和实际Host，经仅测试私有代理完成选择→取消零上传→重新选择→确认→读取精确字节→撤销后拒绝；桌面1366×900和窄屏390×844截图已读。浏览器自动设置File输入证明控件和数据链路，不证明操作系统原生文件对话框或Tauri壳。完整证据见iterations/plugin-resource-selection-2026-10-09；DevTools资源消费实包尚未交付。

后续Windows实际Tauri开发程序已完成同链路：真实管理界面启用/授权，当前正式运行会话、父窗文件确认、无测试HTTP代理的Host上传/读取、撤销后拒绝。1440×900 CSS/1800×1125像素浅色截图已读，修正插件顶部保留工具栏间距与滚动复位。使用Studio派生验收View和固定模块作完整性证明，不执行图片算法；CDP设置File输入仍不证明原生操作系统文件对话框。证据见iterations/native-resource-input-2026-10-09，真实DevTools资源包、输出链路/其他OS/新冻结交付仍待完成。

draft.2另增加实际HTTP接线检查：控制资源Store争用，等待八个真实Broker读取占满配额；第九个资源操作立即429，同时bootstrap响应。中断一个客户端后仍不释放正在执行的工作；释放Store后其余读取及新调用恢复。这里不持有插件注册表/执行锁，不证明任意WASI插件争用下主界面流畅；整个插件执行链的锁争用、原生界面和完整生命周期仍需专项验收。
