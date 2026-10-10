# 2026-09-29 通用模型目录发现调研

状态：完成当前代码与锁定 Pi 版本的接口核对；后续实现记录见同日的通用目录发现日志。

## 目标与现状

ZiCode Studio Desktop 要允许个人开发者自行配置模型服务。当前设置页支持 OpenAI、Anthropic、Google 兼容渠道及手填模型 ID，但只有 Provider ID 为 `qveris` 的渠道显示“刷新模型”。通用渠道没有在线发现路径。

`extensions/picot-config.ts` 的 `list_provider_channels` 仅给 `qveris` 标记 `catalogSync`；`sync_qveris_models` 读取当前场景渠道 URL 和专用凭据，再直接更新 `models.json`。设置页仅在用户点击按钮后调用它。现有通用渠道保存流程要求至少一个模型 ID，因而不能先建空渠道再发现目录。

## 本轮核对的运行时接口

- 本仓锁定 Pi 版本为 `0.84.2`，内嵌文档 `src-tauri/resources/pi/docs/extensions.md` 明确 `ctx.modelRegistry.getProviderAuth(id)` 可解析渠道认证和请求配置，不依赖已加载模型。
- 核对上游 `earendil-works/pi-mono` 标签 `v0.84.2` 的 `packages/coding-agent/src/core/model-registry.ts`：`getProviderAuth(provider)` 返回运行时认证结果；`getApiKeyForProvider(provider)` 从同一运行时解析 API Key。无需将密钥传到 WebView，也无需自行读取操作系统凭据库。
- 当前 `CatalogRegistry` 局部类型只声明目录和认证状态，尚未声明上述接口；若实现发现，应从运行时解析并在扩展进程内使用密钥，错误与日志不得包含凭据或上游响应正文。

## 实施边界与决策

1. 先支持明确使用 OpenAI 兼容协议、且用户已配置 URL 的渠道；Anthropic/Google 的目录协议需分别调查，不能假设它们提供 OpenAI `/models`。
2. 目录请求应在扩展进程内完成，限制超时、响应大小和候选数量。免鉴权本地服务无需密钥；启用鉴权的渠道从 Pi 运行时取当前密钥。
3. 将网络发现与配置提交分成两步：界面展示候选 ID，用户确认后再合并，保留已有模型的上下文、能力和价格等手填字段。发现失败或空响应不能清空现有列表。
4. 写入前重读渠道配置并核对请求时的 URL、协议和模型列表，防止用户在请求期间修改或删除渠道后被旧结果覆盖。
5. 空模型渠道的创建要与发现流程一并设计；避免只有专用渠道允许空模型的产品偏差。界面、帮助文档和中英文文案需同时更新。

## 验证与风险

本轮只做只读代码和锁定上游接口核对，未运行测试、网络模型请求或跨平台实机。运行时凭据接口的存在只证明通用发现可按现有架构接入，不证明第三方服务的目录格式、模型类型筛选或能力元数据一致。后续实现必须用真实服务及 Windows/macOS/Linux 验收；本轮没有代码或界面变更、截图和发布产物。
