# HTTP 插件 View 确认等待预算对齐

## 发现

`service.http.get.v1` 的 Host grant 和可信确认弹窗最多等待 60 秒，Host 发起请求后的网络预算最多 8 秒，但通用 View 桥此前在请求开始后 30 秒触发本地超时并发送取消。因此用户仍在有效的确认弹窗中阅读目标时，候选 Spring View 可能先收到 `plugin_view_timeout`。这与真实确认窗口的预算不一致。

## 修改

只将 `httpGet` View 请求等待预算设为 75 秒，覆盖确认 60 秒、网络 8 秒并留出准备和结果传递余量；其他 View 请求维持 30 秒，模型请求维持 255 秒。到期仍发送 Host 取消请求并以本地 `plugin_view_timeout` 结束，不能据此宣称 Host 已终止；确认 grant 仍由 Host 在 60 秒失效，网络安全预算不变。合同文档同步更新。

## 验证与边界

View 桥定向测试断言 HTTP 超时为 75 秒且到期发送取消；取消/确认 Host 测试和确认弹窗测试合计 27/27 通过。`bun run check` 通过，Biome 报告工作树中既有提示，设计检查与嵌入 Pi SDK 对齐检查通过。尚未在 Windows 原生弹窗中实际等待 30–60 秒核验；这项修正不改变 Spring 候选的无签名状态或 DevTools 154 项完整接受数。
