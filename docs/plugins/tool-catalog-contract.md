# Pi工具目录协议实现候选

状态：schemaVersion 1，Studio内置Pi启动已启用目录模式。2026-10-08真实Pi SDK→目录搜索/加载→动态注册及激活→Host→独立WASI Worker已验证；冻结新交付和完整桌面壳验收以本轮档案为准。此协议是Studio内部Broker协议，不改变提供方冻结插件契约。

原有POST /v2/plugin-tools/invoke保持不变。目录使用同一Broker Bearer token，绑定当前运行实例/会话/场景/工作区；desktop token和配对设备token不能替代Broker token。请求不能传入workspace/scene覆盖绑定。停止或令牌到期拒绝请求。

| 请求 | 正文字段 | 返回 |
| --- | --- | --- |
| POST /v2/plugin-tools/catalog/search | schemaVersion:1, runtimeId, sessionId, query可省略, cursor可省略/null | schemaVersion, revision, items, nextCursor/null, total |
| POST /v2/plugin-tools/catalog/load | schemaVersion:1, runtimeId, sessionId, revision, toolId | schemaVersion, revision, toolId, tool(现有PluginPiToolDescriptor完整schema), packageVersion, toolVersion:null |

toolId是JSON编码的[pluginId,capability]，不是显示名称/数组位置。摘要包含toolId、pluginId、capability、name、title、description、packageVersion、toolVersion。未声明工具版本返回null。同能力多个工具名采用按名称排序的规范入口；加载后使用宿主返回的name调用原invoke。摘要不返回inputSchema。

查询按 Unicode NFKC 及小写规范化，再按空白分词；多词必须分别匹配 pluginId、capability、title、description，最长256 UTF-8字节。不做拼音推断。搜索结果先按能力ID或标题的精确、前缀、包含命中排序，再排说明和来源命中；同分保留稳定工具ID顺序。空查询仍按稳定工具ID排序。排序在分页前完成，避免精确工具被宽泛说明匹配挤到后页。每页20项，cursor不可由客户端自行构造；HMAC绑定Host secret、完整runtime binding、规范化query、revision和offset。目录/授权/包版本/schema变化导致旧游标失效，客户端重新搜索。修改查询不复用游标。

Load仅接受当前revision，返回前检查当前包磁盘完整性。加载不增加权限；执行仍实时核对授权/场景/工作区/完整性/幂等缓存身份。搜索32KiB与load256KiB是响应上限；超限返回catalog_response_too_large(413)，不提供残缺schema。未知字段被serde拒绝(422)。cursor失效/伪造返回catalog_cursor_invalid(400)，revision改变返回catalog_revision_changed(409)。错误不带Broker token或工具输入。

### 实际能力契约修订（2026-10-09 源码）

revision 同时绑定当前已授权工具摘要、插件版本及这些工具引用的实际能力声明，
包括 capability inputSchema、可选 outputSchema/maxResultBytes。即使开发包同版本重装、
Pi 工具摘要没有变化，能力契约改变也会使旧分页游标、旧 load 及带旧 revision 的 invoke 失效。
能力稳定排序；字节相同重装及未被已授权 Pi 工具引用的能力变化不使目录失效。
搜索仍只发摘要，不把全部结果 schema 带入每页响应。

生产提供方变更必须提升插件版本，并同步自己的 Pi 输入元数据；同版本重装仅作为回归验证。
这不检查 Pi 输入声明与能力输入声明语义等价，也不改变 legacy 无 toolId/revision 调用的兼容路径；
执行时当前能力的输入、输出和权限门禁仍生效。原生 EXE/嵌入 Pi 的新版本完整链路尚待验收。
专项实际 HTTP 使用内存登记的运行实例，不是模型调用或真实 Pi 进程。

## 启动与运行时

Studio启动内置Pi时设置PI_DESKTOP_PLUGIN_CATALOG=1，兼容字段PI_DESKTOP_PLUGIN_TOOLS固定为[]；不会把全部工具schema塞入Windows环境变量。注册 `studio_plugin_search`、`studio_plugin_load` 和 `studio_plugin_call` 三个目录工具。通常选择后取schema并动态注册、激活，保留已有活动工具；三个名称保留给Studio内置扩展。Pi工具查询API在扩展初始化时尚不可用，名称冲突检查在实际load执行时进行。

每会话最多动态注册128个具体工具、256KiB累计schema元数据，不截断授权目录；搜索页不包含schema。达到预算时，`studio_plugin_load` 返回 `mode:generic`、当前输入schema和 `studio_plugin_call` 入口，不注册第129个具体工具；模型须依据该schema构造输入，再携带已加载toolId/revision调用通用入口。通用入口只接受本会话已按需加载的身份，调用前再次向Host加载以检查版本/权限/签名，执行时Host再次验证输入schema、授权、调用身份及当前修订。通用入口最多保留2048个轻量身份，不缓存其schema，也不自动淘汰已注册工具；满额时明确要求新会话。其参数校验不如具体工具的Pi参数schema，错误输入会由Host拒绝。目录请求15秒超时并传递AbortSignal；WASI执行预算保持既有5秒。运行中Worker取消、包更新全链路、模型自主发现、跨平台及完整桌面壳仍需专项验收。消费者保留旧快照解析用于旧宿主兼容。

真实Pi验收使用实际SDK注册与激活方法，observer只捕获定义用于确定性执行，不替换SDK；没有向模型发送数据，不能代替模型自主使用工具验收。已覆盖五能力及串联、业务错误、取消搜索、撤权拒绝旧修订、重新授权恢复、已有活动工具保留。千项目录是合成摘要规模证据，不是1000个已实现DevTools工具。

## Pi 执行传输保护（2026-10-08 源码候选）

目录加载后的工具及旧快照工具共用 `plugin-invoke-client.ts`。单次 invoke 从请求到完整响应累计最多15秒；流式统计响应最多2MiB（包含Host JSON包装），严格UTF-8/对象/显式result校验。该上限是客户端保护，不增加Worker的1MiB输出预算，也不改变冻结提供方ABI。

调用取消立即停止客户端等待并取消读取、释放响应流。分别显示 `plugin_request_cancelled`、`plugin_request_timeout`、`plugin_response_too_large`、`plugin_response_invalid` 或 `plugin_transport_error`。Host拒绝只保留已知错误码，未知码降为HTTP状态；不转发原始服务message或传输异常。业务 `ok:false` 仍作为原始工具结果交给既有业务处理，不冒充传输成功即业务成功。

客户端取消不证明已经停止Host中的Worker执行，也不能撤销已授权的写入。Host已有Worker预算仍生效，已接入Host/Pi候选取消通道，运行中WASI回收已获HTTP及Pi同调用专项证据，原生入口仍需验收。自动重试未启用；调用ID及幂等规则保持不变。

后续源码已增加[Worker取消与Host/Pi候选通道](worker-cancellation.md)，覆盖运行中真实测试子进程终止/回收、Broker审计/缓存、独立的鉴权HTTP取消入口及Pi独立有界取消请求。真实Pi取消探针与下一调用恢复通过，但取消瞬间的WASI执行阶段/进程未观测，原生入口未验收；不能用请求接受证明Worker已结束。原调用15秒预算之后，取消确认最多额外2秒。

2026-10-09新增真实HTTP→固定dev57 WASI Worker专项，观察同一PID取消时存活、kill/wait及IO线程回收、409取消错误与下一工具成功。随后同一次实际Pi调用取消专项关联PID 7296的启动、取消时存活、回收及IO结束，并通过下一调用及五能力/撤权/恢复回归。原生取消入口、停止实例竞争及其他OS仍待验收；未声称算法指令级中断或模型自主取消，详见取消文档与对应档案。

真实HTTP流超时、连接取消及后续工具成功已验证；当前构建的Broker扩展在实际内置Pi→目录→Host→冻结WASI Worker五能力/撤权/恢复回归通过。证据见技术博客 `iterations/plugin-invoke-transport-2026-10-08`。未冻结新Windows目录，不把旧交付扩展标为包含本轮修改；全部153工具接入仍未完成。

