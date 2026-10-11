# 资源调用一次性准入（draft1）

2026-10-11。Studio-only 候选扩展 `resource.call.admission.draft1`，不改变提供方 Worker ABI。
本契约用于弥补旧调用记录消失后无法安全解锁的问题；**不将旧 invoke-view 的 unknown 解释为未执行**。

## 生命周期与边界

Host 生成 `resource-call-<UUID>`，绑定完整资源 Access 与输入的规范 JSON SHA-256，以及当前 runtime/session/plugin/capability。
准备操作只保留摘要与元数据，不读取文件、不启动 Worker，不代表资源权限或参数已经通过；执行仍走全部既有授权、schema、限额与隔离检查。

| 状态 | 执行准入 | 恢复操作 |
| --- | --- | --- |
| prepared | 输入匹配时原子消费一次 | 封存为 sealed，返回 not_started |
| active | 拒绝再次消费 | 请求取消，返回 active / executionFinished=false |
| finished | 拒绝再次消费 | 返回 ended / executionFinished=true |
| sealed | 拒绝消费 | 重复恢复仍返回 not_started / executionFinished=true |
| 缺失/过期/淘汰 | 拒绝执行 | 返回 not_admissible / executionFinished=true |

准备与结束记录保留60秒；活动记录不自然退休。全局128项、每runtime32项，容量不足只淘汰已结束记录；不能淘汰活动/未消费凭据来接收更多调用。
缺失记录不重新创建。客户端不能指定 prepare 的调用ID；已过期/淘汰凭据也不能再次执行。
消费与封存在同一锁内互斥：恢复若先封存，迟到执行会拒绝；执行若先消费，恢复必须等待活动 lease 释放，不能提前称为结束。

`finished/ended` 只证明执行作用域释放，不证明算法成功、Worker清理成功、输出仍可用或保存成功。
`not_admissible` 不区分从未领取、过期、淘汰或已结束；只证明**当前Host内该严格凭据不会再开始且没有活动lease**，不证明历史操作未发生。
原Host实例不匹配、runtime/session失效或状态存储错误均拒绝，不能据此声称旧执行已结束。

## API

全部要求桌面身份；插件 bearer token 不被接受。请求未知字段拒绝。

### POST /v2/plugin-resources/prepare-call

128KiB body 上限：

```json
{"schemaVersion":1,"access":{"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"resourceId":"UUID","contentVersion":"SHA256"},"input":{}}
```

返回 schemaVersion=1、profile、owner、callId、hostInstanceId、phase=prepared、expiresInSeconds=60、persistent=false。
返回后应保存原样 owner/callId/hostInstanceId；准备响应丢失不会执行，遗留元数据自然过期，不自动重试执行。

### POST /v2/plugin-resources/invoke-call

128KiB body 上限：

```json
{"access":{"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"resourceId":"UUID","contentVersion":"SHA256"},"callId":"resource-call-UUID","hostInstanceId":"UUID","input":{}}
```

资源和参数须与准备时相同，实例须匹配。Worker容量满时拒绝且凭据仍未消费，客户端可显式恢复封存；不得因429/网络错误自动重放。
消费后即使权限校验、参数schema或Worker执行失败，该凭据仍不能再用；修正输入必须重新准备新调用。
成功响应沿用既有资源执行结果和输出句柄格式，不返回输入副本。

### POST /v2/plugin-resources/reconcile-call

```json
{"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"callId":"resource-call-UUID","hostInstanceId":"UUID"}
```

这是**有状态恢复操作，不是只读查询**：会封存未开始调用，或对活动调用设置取消标记。界面接入时必须说明其作用。
允许原资源/插件权限撤销后恢复，但要求原Host和当前有效runtime/session；不授权读取资源或输出。
返回 schemaVersion=1、profile、owner/callId/hostInstanceId、phase、executionFinished、admissionClosed=true、persistent=false、resultAvailable=false。
phase为 not_started、active、ended、not_admissible；仅active的executionFinished为false。
反复恢复不延长终态保留期，不创建缺失记录，不自动执行、保存或重放。

## 兼容与当前接入状态

凭据带前缀，旧 invoke-view/cancel-view 的 UUID 校验会拒绝，不能通过删掉严格路径把同一凭据当成旧调用。
旧的普通UUID调用仍按原协议运行；一次性保证只属于本协议的调用，不适用于任意旧请求。
提供方模块不需要修改，不向插件 iframe 新增接口或权限，不提前宣告正式resource.v1。

**目录资源工具和跨工具接力父控制器已采用新协议；旧iframe保持原路径。**
父控制器先准备Host颁发凭据，再一次消费；资源身份和输入在异步准备前保存快照。取消/销毁后迟到的准备响应会封存，失败后请求有界取消，但只有用户显式恢复并获得同Host有效证明才解除不确定状态。界面使用“停止并恢复调用”，明确会封存未开始调用或请求取消；分别展示not_started、active、ended、not_admissible，不把恢复称为只读查询。

2026-10-11界面接入验证：226项插件前端测试通过；真实Host/生产Worker+Edge最终13.25秒，接力与目录成功响应各扣留一次，不自动重放或写入；先封存再投递迟到invoke返回resource_call_used且无新增Worker审计。活动/Host变化为代理注入，终态和封存来自真实Host。6张桌面/窄屏截图已检查。证据见技术档案iterations/resource-call-admission-ui-2026-10-11。
目录和接力后续已增加[本地调用恢复记录](resource-call-journal.md)：执行前提交元数据，工具中心可在关闭工具或同origin刷新后查找并显式恢复；存储失败/同工具待核对记录会阻止新执行。跨Host重启终态、原结果恢复与真实DevTools算法完整验收仍未完成，不能将本地记录等同于持久执行收据。

验证证据：技术档案 `iterations/resource-call-admission-2026-10-11/`，包含100轮准入/恢复竞态、容量与退休测试，以及真实HTTP Host/Worker专项。
