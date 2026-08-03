# 场景与实例隔离

## 1. 两类对象

`SceneProfile` 是可复用配置；`RuntimeInstance` 是一次正在运行或可恢复的执行实例。两者不能混为同一对象。

```ts
interface SceneProfile {
  id: string
  name: string
  kind: "programming" | "finance" | "writing" | "custom"
  providerProfileId: string
  modelId: string
  systemPrompt: string
  skills: string[]
  extensions: string[]
  toolPolicy: ToolPolicy
  workspacePolicy: WorkspacePolicy
  networkPolicy: NetworkPolicy
}

interface RuntimeInstance {
  id: string
  sceneId: string
  workspaceId: string
  sessionId: string
  processId?: number
  state: RuntimeState
  createdAt: string
}
```

## 2. 隔离矩阵

| 资源 | 同一场景不同实例 | 不同场景 |
| --- | --- | --- |
| Pi 进程 | 不共享 | 不共享 |
| Agent 配置目录 | 场景共享 | 不共享 |
| Session | 不共享 | 不共享 |
| Runtime 日志 | 不共享 | 不共享 |
| 临时文件 | 不共享 | 不共享 |
| Skills/Extensions | 场景策略决定 | 默认不共享 |
| Provider 凭证 | 引用可复用 | 必须显式授权 |
| 工具策略 | 场景共享 | 不共享 |
| 工作区授权 | 按实例/场景授权 | 不共享 |

## 3. 标识与路径安全

外部传入的 Scene、Workspace 和 Instance ID 不能直接拼接成路径。Rust 使用 ID 的 SHA-256 摘要生成稳定目录名，并在访问前 canonicalize。

任何以下情况必须拒绝：

- 空 ID。
- 未登记的 Scene 或 Instance。
- 解析后路径逃逸应用数据根目录。
- 工作区不在实例授权集合。
- Scene 策略禁止的工具或网络目标。

## 4. 场景默认策略

设置页的选择作用于下一个新会话。自定义场景可配置名称、说明、系统指令和
工具白名单。工具白名单由 Pi 扩展在 `tool_call` 执行前拦截，不依赖模型
自觉遵守。

主界面顶部和空白会话开始页显示的是**当前运行实例的实际场景**，数据来自
`RuntimeTarget.sceneId`，不是设置页中“下一个新会话”的待选值。点击场景标识可直接
跳转到场景设置。

执行链路如下：

1. 新建会话把所选 `sceneId` 发送给 Rust Host。
2. Host 为场景分配独立 Agent 目录，为实例分配独立 Session、日志和临时目录。
3. Pi 启动前，Host 注入 `PI_DESKTOP_SCENE_PROMPT` 和
   `PI_DESKTOP_ALLOWED_TOOLS`。
4. 内置 `picot-bridge` 扩展在 `before_agent_start` 中追加场景系统指令，并在
   `tool_call` 中强制执行工具白名单。

### Programming

- 完整工程工具可用，适合读写代码、运行构建和测试。
- 要求先检查相关实现，再进行最小且完整的修改。
- 要求保留无关改动，执行聚焦验证，并明确未验证风险。

### Finance

- 本地通用工具仅允许 `read`、`grep`、`find` 和 `ls`；此外允许内置的
  `qveris_status`、`qveris_discover`、`qveris_inspect`、`qveris_call`、
  `qveris_usage` 和
  `finance_backtest`、`finance_normalize_ohlcv`、`finance_screen`、
  `finance_market_data`、`finance_paper_account`、
  `finance_paper_order`、`finance_paper_limit_order`。
- `bash`、写文件和其他未列入白名单的工具会在执行前被阻止。
- 模拟交易工具只能写入当前 Finance 场景的专用账本，不具有真实券商连接能力。
- 数字必须明确币种、单位、期间和数据日期；衍生值需展示计算方法。
- 必须区分事实、计算、假设、情景和不确定性，不得伪造行情或来源。
- 不提供个性化金融、税务或法律建议，也不建议执行具体交易。

### Creation

- 完整创作工具可用，适合写作、构思、视觉方向和内容制作。
- 先确定受众、格式、目标和语气，再交付具体草稿或可制作方案。
- 修改时保持术语、语气、角色和视觉语言一致，并说明关键创作选择。

自定义场景可通过工具白名单进一步收紧权限。内置场景不可在设置中覆盖；需要不同
策略时应创建新的自定义场景。

## 5. 凭证隔离

Provider 配置保存：

```json
{
  "credentialRef": "pi-desktop/provider/<provider-id>"
}
```

密钥值由 Rust Credential Broker 保存到 Windows Credential Manager（其他平台使用
系统 Keychain/Secret Service）。非敏感索引只保存 Scene、Provider 和不透明账号引用。
Pi 启动时 Broker 短暂生成场景隔离的兼容 `auth.json`；模型注册表初始化后扩展将其删除，
QVeris Key 仅保留在进程内运行时缓存。密钥不会进入 `models.json`、普通日志、项目文档
或 Scene JSON；旧版 `auth.json` 会在启动时迁移。
