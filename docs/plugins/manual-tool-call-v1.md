# 普通工具调用生命周期 v1（Host候选）

2026-10-10。仅可信桌面内部扩展，不是插件包能力声明，也不要求DevTools引用Studio代码。Host与可信界面已实现，当前Windows debug EXE已验证Studio夹具的取消及新调用恢复；WASI和其他OS待验。此证据不代表DevTools全部工具已接受。

## 请求顺序

所有接口使用既有可信桌面凭据。远程连接、插件iframe均无权调用。基础路径 `/v2/plugin-capabilities`。

1. `GET /call-protocol`：探测 `schemaVersion:1, profile:"manual.tool.call.v1", prepareRequired:true`。旧Host不提供该接口时界面不能显示可取消。
2. `POST /prepare-call`：提交与普通invoke相同的sceneId/workspaceId/pluginId/capabilityId/input/captureResult/catalogRevision，不得传callId。工作区必须存在；目录修订、启用状态、外部Worker/WASI运行时及输入schema需通过检查。返回Host生成的callId；此步骤不执行插件、不授予写入或权限。
3. `POST /invoke`：原请求加callId。Host校验完整作用域和请求摘要，单次消费句柄，再按现有执行路径检查当前目录、权限和schema。执行期间不持有注册表或broker锁。旧无callId请求保持既有行为，不能通过本扩展取消。
4. `POST /cancel-call` 或 `/call-status`：提交 `{schemaVersion:1,callId,scope:{sceneId,workspaceId,pluginId,capabilityId}}`。取消仅作用于已登记的匹配调用，未知句柄不会创建墓碑。即使插件被禁用或撤权，匹配的既有调用仍可请求取消。

2026-10-18 Studio View 接收侧复用：当前 Host 的 `/v2/plugin-views/source` 附带加载时的 `catalogRevision`，可信父页以该修订按能力 ID 读取详情、准备句柄并代理 `capabilities.invoke`。详情接口按声明查找，不要求能力出现在当前搜索页；iframe 无法直接调用上述可信接口，也拿不到句柄。取消 ACK 和结果未知时的恢复边界见 [View 能力取消状态](view-capability-cancellation-gap.md)。该扩展未更改提供方包协议。

## 状态与终态

2026-10-10 前端补强：已发放句柄后的请求错误不会直接解锁；终态 outcome 必须为有效非空字符串，取消/查询/退休证明一致校验。具体规则与验证边界见[结束证明说明](manual-call-terminal-proof.md)。

- `prepared`：已登记，未开始；`running`：正在执行。
- `cancel_requested`：设置取消标记，`executionFinished:false`。提前取消的标记会随同一句柄进入执行路径，不能被新标记覆盖。
- `finished`：执行闭包释放句柄后返回 `executionFinished:true`，outcome为 `completed` 或既有错误码（如worker_cancelled/worker_timeout），异常退出为plugin_execution_abandoned。`completed`只表示HTTP执行路径成功，业务结果须看原invoke响应。
- 终态取消不会覆盖原结果。界面必须等待原invoke或Host终态查询，不能用fetch断开显示“已取消”。如果取消过晚，应显示实际成功结果。
- 不保存输入/结果明文，仅保存摘要、作用域、状态和终态错误码。结果依旧由原invoke交付，状态查询不重放计算或结果。

## 预算与错误

总句柄128、活动16，prepared/finished保留60秒；活动记录在执行结束前不因TTL过期。预算满返回manual_call_budget_exceeded，不能静默挤掉尚可取消的活动任务。prepare请求体最多128KiB，超限交由HTTP拒绝。

作用域/摘要不匹配或过期返回manual_call_unavailable；重复执行返回manual_call_already_started；非登记工作区manual_call_scope_invalid；缺失目录修订manual_call_revision_required；不支持内建同步工具manual_call_runtime_unsupported。目录和执行错误继续沿用既有协议。取消/查询请求须严格schema版本和UUID格式。

## 验证边界

验证证据维护在技术博客 `iterations/manual-tool-cancel-host-2026-10-10/`，区分单元、真实HTTP/生产Worker以及原生界面。本候选不改变154个DevTools工具的完整验收状态。

## 可信界面接入与补充证据

2026-10-10后续源码增加独立[状态恢复扩展](manual-call-reconciliation-v1.md)：同一Host实例证明已退休或封闭prepared后才恢复，跨Host仍保守锁定。下述Windows EXE/UI证据属于该扩展之前，不作为恢复扩展的实机验收。

界面先探测协议；旧Host回退既有invoke且不显示取消。目录javascript对应协议worker。Host prepare返回句柄后才执行；prepare晚于卸载返回时仅取消句柄，不执行。busy期间禁止重复执行和关闭工具；切换笔记等应用保留同一工具中心React实例、输入、结果及调用控制器。工作区变化或shell销毁时请求取消，不能将请求本身视作终止。

取消ACK只表示cancel_requested。原invoke返回worker_cancelled后显示“工具已取消”，不写最近、不创建成功结果；晚取消仍展示实际成功结果。传输失败或超时保留执行锁，允许重试取消/查询Host终态；原响应尚未结束时即使查询finished也不放开新调用，防止迟到响应覆盖重试。状态不可用/过期仍不能证明任务退出，目前保持锁定，尚缺安全恢复入口。beforeunload提醒已注册，原生窗口运行中关闭行为未验。

界面证据在 `iterations/manual-tool-cancel-ui-2026-10-10/`：95项定向测试通过；Windows真实WebView验证发现→按需打开→执行→切换笔记返回→取消→原响应worker_cancelled→新UUID重试成功→结果展示，取消不改recent、成功revision21→22且收藏不变。原生截图1442×931浅色已检查。夹具不是DevTools算法；不支持result capture的提示保留，本轮不证明接力/保存。当前EXE SHA256为1648b2339656eefa8bb4a50852b903abd29c638b835c9abc82af2e107129b1f6，版本0.1.0，五项public资源与运行目录匹配。

实机取消1次采样Worker退出，应用正常关闭后10个采样自有进程全部退出；本轮生产日志没有pipes_closed事件，不据此宣称所有管道关闭。原Host测试3个Worker回收/管道关闭属上一阶段证据。最初3次手动UI操作超过既有5秒Worker预算，worker_timeout保留为失败；最终自动化在真实WebView内及时点击取消，未放宽预算。其他平台、深色/窄窗、撤权/卸载期间取消、WASI与独立分发目录待验。


## 2026-10-10 状态恢复Windows原生补验

后续已用当前debug EXE b98554661f9ee4c5347e588433be08fb630dab5e4093113421107aeca910a34a/0.1.0实际验证：目录发现/按需加载Studio夹具→真实Worker成功但测试网络侧丢弃响应→锁定且recent不变→生产60秒TTL自然过期→原Host身份恢复证明→解锁并提示核对，无自动重放→主动新UUID调用成功展示→recent22→23且收藏不变。原生浅色1442×931截图已检查。源/运行目录五项资源摘要匹配，无ZIP/新全运行副本；正常关闭后10采样自有进程剩余0，临时夹具2文件1029B已清除。

这是故障注入与Studio合成guest验收，不代替真实写入事故、跨Host旧进程结束、WASI/其他OS、全部DevTools工具算法或独立分发目录；原首次启动超时仍待诊断。154完整接受仍0。详见manual-call-reconciliation-v1.md和技术博客iterations/manual-call-recovery-native-2026-10-10/work-log.md。
