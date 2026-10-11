# 资源工具调用状态查询（draft1）

2026-10-11，Studio Host 的候选扩展。提供方无需修改包，现有资源输入与 Worker ABI 不变。

## 接口

`POST /v2/plugin-resources/call-status`，只接受当前桌面身份，不接受插件 bearer token。

```json
{
  "schemaVersion": 1,
  "owner": {
    "runtimeId": "current-runtime",
    "sessionId": "current-session",
    "pluginId": "plugin-id",
    "capabilityId": "capability-id"
  },
  "toolCallId": "UUID",
  "hostInstanceId": "optional-UUID-captured-before-invocation"
}
```

未知字段拒绝。作用域包含 runtime、session、plugin、capability 和调用 UUID；查询不使用资源路径、输入内容或原资源授权。
允许文件授权/插件权限已撤销后的生命周期查询，但 runtime/session 必须仍有效。

响应为 `schemaVersion:1`、`profile:resource.call.status.draft1`，原样回显 owner 和 toolCallId，包含：

| 字段 | 含义 |
| --- | --- |
| hostInstanceId | 本次 Host 资源执行管理器的随机 UUID，重启后不同 |
| phase | `unknown`、`cancel_pending`、`active` 或 `finished` |
| executionFinished | 仅 `finished` 为 true |
| cancellationRequested | 当前调用取消标记，不能代替结束证明 |
| persistent | 始终 false |
| retentionSeconds | 60，既有终态/待取消记录的自然保留期；容量压力可能更早淘汰终态 |
| resultAvailable | 始终 false，接口不恢复输入、结果或资源 |

`finished` 仅证明该次执行作用域已释放，不代表算法成功、Worker 清理成功、保存成功或输出仍可用。
`cancel_pending` 仅表示存在取消墓碑，延迟请求仍可能到达。`unknown` 可能尚未到达、从未执行、已过期或容量淘汰，**不能证明未执行或安全重试**。
活动记录不会自然过期。查询不创建记录、不取消、不执行、不刷新保留时间、不读文件，也不持久化。

调用前先查询并保留 hostInstanceId；后续查询携带该值。Host 更换返回 `resource_call_host_changed`，不把新 Host 中缺失记录当成旧执行结束。
未携带原实例值时，接口只能描述当前 Host，不能提供跨重启证据。runtime 停止返回 `runtime_stopped`，同样不能推断执行状态。
严格实例比较不是延迟 invoke 的防重放机制：既有 invoke 协议仍可能复用已结束 UUID，调用方不得如此重试。

### 执行请求的实例校验

`invoke-view` 可附带 `hostInstanceId`（UUID）。Host 在获取 Worker 槽位和调用 lease 前校验，实例不符返回 `resource_call_host_changed`，不启动 Worker、不创建调用记录。
这是原 Host 身份的栅栏，不是一次性调用凭据，也不改变提供方 Worker ABI。旧 iframe 调用不带此字段仍沿用原路径。

## 接入与验收边界

2026-10-11 已接入 Studio 目录资源工具和跨工具接力的可信父界面：

- 调用前只读捕获 Host 身份，要求未知 UUID，执行请求携带原实例；不支持查询的旧 Host 在执行前拒绝。
- 执行请求失败或结果协议不合法时保留 owner、UUID、Host 实例和 busy，自动请求一次取消；不把该请求当成结束证明，不自动重试。
- 用户点击“查询执行状态”才核对；未知、活动、Host更换、读取/协议错误都保留限制。只在原 Host 返回匹配作用域的 finished 时解除执行/参数/目录关闭限制，明确提示原结果没有恢复。
- Host 的 `resource_worker_busy` 在调用 lease 创建前直接拒绝，是确定的未准入错误，保留输入并解除限制，不创建取消墓碑；不自动重试。
- 接力窗口在不确定状态下明确关闭会取消计算并撤销该共享引用，不删除已批准保存的文件。
- 标签使用“待确认结束”，不会把响应丢失称为确定运行中。核对不保存、接力、读取文件或写入最近使用。

未向插件 iframe 暴露此恢复接口；旧 iframe UI 不自动获得上述恢复能力。状态记录仅保留在当前控制器内，正常销毁/页面重载后的调用恢复尚未完成。
跨重启、延迟请求封存、原子准入和结果恢复仍缺独立协议；未知记录可能长期无法解锁，不能用等待超时来替代结束证据。完整 DevTools 工具验收数量不变。

验证记录：技术博客档案 `iterations/resource-call-status-2026-10-11/` 与 `iterations/resource-call-recovery-ui-2026-10-11/`。
