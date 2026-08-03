# 模型与 API Key

模型配置位于“设置 → Configuration”。页面顶部的场景标签说明当前配置写入哪个场景。

## 设置 API Key

在 Authentication 列表中找到提供商，点击“Set key”或“Update”。密钥由桌面 Host 保存到操作系统凭据库，场景配置仅保留非敏感引用，不写入 `models.json`、日志或文档。

## QVeris 模型目录

为 QVeris 设置 Key 后，ZiCode 会请求：

```text
GET https://aigateway.qveris.ai/v1/models
```

返回的聊天模型会同步到当前场景的 QVeris Model Gateway。嵌入模型不会出现在聊天下拉框。

可在“自定义模型渠道”中的 QVeris 行点击“刷新模型”重新同步；点击“编辑”可修改模型
网关 Base URL。QVeris 的 Provider ID 固定为 `qveris`，避免已有模型引用失效。

模型凭据和目录按场景隔离。在 Finance 中配置的 Key 不会自动出现在 Programming；请先
确认页面顶部“正在编辑当前场景”与目标对话场景一致。

## 模型能力

同步过程保留模型的上下文窗口、视觉输入、推理能力和每百万 Token 价格。模型下拉框只显示当前凭据可用且未被隐藏的模型。
