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

### Programming

```yaml
shell: approval
workspace_write: allow
delete: approval
network: approval
extensions: trusted
```

### Finance

```yaml
shell: deny
workspace_write: approval
delete: deny
network: allowlist
extensions: builtin_only
source_attribution: required
```

### Writing

```yaml
shell: deny
workspace_write: allow
delete: approval
network: approval
extensions: trusted
```

这些默认值可以在自定义场景中收紧；放宽金融场景限制时必须显示风险确认。

## 5. 凭证隔离

Provider 配置保存：

```json
{
  "credentialRef": "pi-desktop/provider/<provider-id>"
}
```

目标方案是将密钥值保存在 Windows Credential Manager，并由 Rust Credential
Broker 注入。当前实现为兼容 Pi，使用场景隔离的 `auth.json`，密钥不会进入
`models.json`、普通日志或 Scene JSON；Credential Manager 迁移列为后续安全
里程碑。
