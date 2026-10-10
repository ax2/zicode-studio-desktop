# 插件 View 的公开错误字段

本轮SDK新增可选的`Error.code`，是现有API的兼容补充。失败仍拒绝Promise并保留Error.message字符串，成功结果与业务错误envelope不变。旧插件无需修改；新插件可优先读取code，旧Host缺失code时回退通用提示。只匹配固定码，不解析服务原始消息。

| code | 含义 | 界面处理 |
| --- | --- | --- |
| worker_fuel_exhausted | Worker计算预算耗尽 | 保留输入；说明工具预算不足，不只建议重复重试 |
| worker_memory_trap / worker_stack_exhausted | guest内存访问或栈预算拒绝 | 保留输入；提示本次处理未完成 |
| worker_timeout | Host Worker截止 | 说明执行超时；不能据此声称写入已回滚 |
| worker_cancelled | Worker取消 | 说明取消；不显示成功结果 |
| worker_protocol_error | 结果结构不符合能力声明或Worker协议异常 | 保留输入，不返回异常结果 |
| result_too_large | 结果超过全局或能力字节预算 | 保留输入；显示结果超限，不显示成功 |
| payload_too_large | 输入超过Host请求预算 | 保留输入；提示缩小请求 |
| plugin_capability_timeout | 父窗能力请求等待超时 | Host任务是否停止仍需单独确认 |
| plugin_view_timeout | iframe SDK等待超时 | 同上，不能当作Host已取消 |
| plugin_view_busy | SDK或父窗并发额度已满 | 避免继续提交重复请求 |
| plugin_disabled | 插件已禁用 | 引导用户到管理界面检查 |
| plugin_request_failed | 未分类/未知错误 | 通用失败提示，不显示原服务消息 |

其他固定Worker和资源码见实现白名单`plugin-view-errors.js`，未知code/message一律归为plugin_request_failed。原有资源`[固定码]`字符串保留，并补code；不把任意括号文本或原报告当错误码。父窗响应字段保留error字符串并补errorCode；注入SDK把字段转换为Error.code。code只表示本次调用错误类别，不承诺整个工具已接入或跨平台支持。

```js
try {
  const result = await window.zicode.capabilities.invoke(capabilityId, input);
  if (!result.ok) {
    // 这是工具业务结果，如INVALID_REPORT；与Promise拒绝分开处理。
    showKnownBusinessError(result.error.code);
  } else {
    showReport(result.data.text);
  }
} catch (error) {
  const code = typeof error?.code === "string" ? error.code : "plugin_request_failed";
  showKnownHostError(code); // 使用插件自己的固定本地化文案，保留输入。
}
```

用户报告、路径、凭据、解析器异常和堆栈不得作为UI错误消息或日志。上述show函数为示例占位，不是新增Host API。SDKcode和工具profile分开协商；这项补充不发布diagnostics proposal或resource draft支持。

验证：父窗线协议及白名单专项、完整前端1598项/230文件、check通过；实际隔离Windows提供方诊断iframe调用收到worker_fuel_exhausted和固定message，下一调用恢复。提供方原View未修改，仍使用笼统catch，尚未消费新code。完整测试首次缺失旧的“Plugin is disabled”固定提示失败，补回安全映射后重跑通过，失败日志保留。预算原生证明发生在这条无关兼容映射补充之前，不冒称原生测试覆盖所有错误类别。

Windows plugin-contracts 阶段原生验证发现 result_too_large 被白名单降级，现补齐该码及
payload_too_large 的固定安全映射。最终完整前端1598/230与check通过，实际新运行目录
已验证 invalid_parameters、worker_protocol_error、result_too_large 各拒绝后恢复及独立文本工具执行。
payload_too_large 本轮为单元回归覆盖，不冒称其原生超大输入边界已验收。
