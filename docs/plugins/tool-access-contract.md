# 常用工具偏好协议

标识：`zicode.tool-access/1`。Studio宿主与自身UI之间的协议，不是插件执行能力或Pi工具目录协议。

通过已认证桌面的`/v2/ws`发送`host_request`，复用原有`requestId`响应/错误与断线处理。远程客户端不能访问Host控制命名空间。本接口没有新增Tauri命令，不向插件View提供直接入口。

```json
{
  "type": "host_request",
  "requestId": "host-1",
  "operation": "tool_access_mutate",
  "schemaVersion": 1,
  "sceneId": "programming",
  "workspaceId": "registered-workspace-id",
  "mutation": { "kind": "favoriteSet", "id": "com.zicode.devtools.text:open", "enabled": true }
}
```

读取使用`tool_access_read`，不传`mutation`。允许的写入只有`favoriteSet`、`recentRecord`和`recentClear`；后两者分别传`id`和不传额外字段。未知写入字段拒绝，不能写入输入、凭据、名称或任意JSON。每次读取/写入重新检查已注册工作区。

成功响应的`access`包含`schemaVersion:1`、安全整数`revision`、`favorites:string[]`及`recent:[{id,usedAt}]`。使用时间由宿主生成，单位为Unix毫秒；最新项在前，按ID去重，最多40项。收藏最多512项，ID非空、不含控制字符、UTF-8长度不超过256字节。ID是UI入口标识，不冒充提供方独立工具版本。

收藏写入明确的`enabled`状态，不接受整份替换快照；SQLite即时事务在读取最新值后应用单项操作，并原子提交。不同窗口添加不同项不互相覆盖，同项的最后一次成功明确操作生效。修订为可观察元数据，不要求客户端重传旧快照。

保存位置为Studio现有metadata数据库的preferences表，键由协议版本和JSON场景/工作区元组构成，不依赖HTTP端口或浏览器origin。只保存标识与时间；不在工作区源码中生成文件。未知schema、超限或损坏数据库记录拒绝读取/覆盖，展示失败并允许重试。

UI在打开面板时捕获作用域，动作异步完成后仍写入该作用域。只有存在实际action、未禁用、成功resolve且没有返回`false`时才记录最近。历史保存失败与工具执行失败分别反馈。插件禁用/卸载后收藏标识保留并显示暂不可用；可手动移除，恢复相同稳定ID后重现。

偏好不包含授权。收藏或恢复入口不能自动启用插件、给Pi开放能力、绕过包完整性或执行限制。

完整桌面、其他系统、千项有界DOM、Pi按需目录与模型自主调用需分别验收，不能由偏好存储测试替代。
