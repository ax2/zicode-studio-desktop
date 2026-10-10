# 普通工具调用状态恢复 v1

2026-10-10，Studio可信桌面内部扩展候选，profile `manual.tool.reconcile.v1`。与 `manual.tool.call.v1` 配合，插件生产者无需引用Studio代码、无需修改普通能力输入输出。此文不代表新生产EXE/全部DevTools工具/其他平台已验收。

## 问题与约束

普通调用响应可能丢失，而prepared/finished记录只保留60秒。`manual_call_unavailable`同时覆盖未知句柄、过期与作用域不匹配，不能据此解除执行锁；切换到另一个Host也不能证明旧Host的任务结束。

恢复证明仅针对原Host实例的调用生命周期。不恢复结果、不自动重放、不授予权限，也不能证明先前写入未发生。若原调用可能已成功，用户须检查数据再决定是否新建调用。

## 能力探测与身份

- `GET /v2/plugin-capabilities/call-protocol` 增加可选 `reconcileProfile:"manual.tool.reconcile.v1"`，原schema/profile/旧客户端行为保持。
- `prepare-call` 增加 `hostInstanceId` UUID，由Host的Calls容器创建，所有克隆共享同一身份；新Host使用新UUID。它是实例标识，不是凭据，不能替代可信桌面认证。
- 客户端必须在prepare时保存该身份，不得从后续Host探测结果替换。缺少能力声明、接口或有效实例身份时，继续旧有保守锁定行为。

## 请求

`POST /v2/plugin-capabilities/reconcile-call`

```json
{
  "schemaVersion": 1,
  "hostInstanceId": "<original Host UUID>",
  "callId": "<Host-issued call UUID>",
  "scope": {
    "sceneId": "programming",
    "workspaceId": "<workspace>",
    "pluginId": "<plugin>",
    "capabilityId": "<capability>"
  }
}
```

与cancel/status使用相同可信桌面认证，中间件和handler均拒绝未授权请求。严格schema、UUID与未知字段检查。实例不同返回409 `manual_call_host_changed`；存在句柄的scope不同返回409 `manual_call_unavailable`；锁损坏返回`manual_calls_unavailable`，均无终态证明。禁用/撤权不能阻止控制原调用，因此不重新要求插件启用或执行权限。

## 原子语义

恢复与begin/清理使用同一个有界记录锁：

| 当前记录 | 动作 | executionFinished | outcome |
| --- | --- | --- | --- |
| active | 设置取消标志，保留lease | false | null |
| prepared | 原子改为finished，封闭后续begin | true | manual_call_not_started |
| finished | 保留实际既有终态 | true | 原outcome |
| 不存在/过期 | 确认原实例没有该活动lease；后续begin必拒绝未知UUID | true | manual_call_retired |

active记录不会随TTL过期。不存在时不新建墓碑；prepare不允许指定ID，只有Host生成新UUID，旧ID无法重用。prepared封闭仍沿用60秒保留、128总记录/16活动限制，不扩大缓存，也不储存输入/结果明文。

成功响应含 `schemaVersion:1, profile:"manual.tool.reconcile.v1", hostInstanceId, callId, status:"finished"|"cancel_requested", executionFinished, outcome`，无结果正文。`manual_call_retired`只证明本Host生命周期已结束或未开始，不区分业务成功/失败/取消，不能生成“成功结果”或“工具已取消”。

## 前端规则

状态凭据另执行[终态 outcome 完整性检查](manual-call-terminal-proof.md)。匹配身份但缺少终态结果的响应也不能解锁。

目前从“检查工具状态”入口，在call-status明确返回manual_call_unavailable后才请求恢复；网络错误、错误结构或其他错误不触发恢复。恢复响应必须同时匹配原Host身份、callId、profile及合法状态。

原invoke仍等待响应时，即使Host证明结束也继续等原响应，不开放新执行。原响应已丢失且Host证明终态时解锁，保留输入，提示“工具已结束但结果不可用，请检查后再运行”；不写成功结果/recent，不自动重试。实际迟到成功按原invoke处理。Host更换/不可达/旧Host不支持时保持不确定锁定；跨Host旧进程终止证明仍待设计。

## 验证记录

证据目录：技术博客 `iterations/manual-call-recovery-2026-10-10/`。区分Rust状态机/并发、真实HTTP+保留生产Worker、前端组件，以及尚待的新EXE原生截图验收。测试推进TTL只在测试记录中进行，生产仍60秒；不提高Worker预算。154项逐工具验收状态不随本扩展提升。

### Windows原生补验（2026-10-10）

后续 `iterations/manual-call-recovery-native-2026-10-10/` 已完成实际Windows工具中心验证。当前debug EXE SHA256 `b98554661f9ee4c5347e588433be08fb630dab5e4093113421107aeca910a34a`，版本0.1.0，复用target/debug及原隔离profile；五项关键public资源与运行目录逐文件摘要匹配，完整运行目录保留，无新安装包/ZIP。

从实际目录发现→按需加载Studio自有夹具→真实Worker执行成功→仅测试网络侧丢弃返回界面的响应→界面不确定/输入和关闭锁定→切换笔记返回保留→自然等待65秒（生产TTL未改）→call-status返回manual_call_unavailable→同Host原身份reconcile返回manual_call_retired→解锁并提示核对数据，无结果/无自动invoke/recent不变→用户主动新UUID重试成功→结果展示且recent仅新增一次，收藏不变。原生截图1442×931浅色已实际检查，WebView视口1440×900。

丢弃响应是验收故障注入，不是自然网络事故；Host原调用确实成功，恢复证明没有把它伪装成失败或取消。两条控制台资源错误分别对应注入的invoke网络失败和预期call-status HTTP409，重试零控制台错误。正常关闭后10个采样自有进程剩余0；本轮生产Worker没有单独管道事件，不将上轮3/3测试证据混作本轮原生证据。临时夹具2文件1029B已清除，源和证据保留。

此项只验收Windows夹具状态恢复，未验WASI、其他OS/主题、跨Host旧任务结束证明、真实写入事故/结果保存、独立复制分发目录或154工具算法。原有首次Worker启动观察超时仍保留待诊断。
