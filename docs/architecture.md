# 架构方案

## 本地数据根目录

Rust Host 通过系统本地数据目录创建 `zicode` 根目录。场景配置位于
`scenes/<scene-key>/agent`，实例运行状态位于 `instances/<instance-key>`，Agent
Inbox 工作区位于 `workspaces/agent-inbox`。所有子进程显式接收
`PI_DESKTOP_DATA_DIR`、`PI_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_SESSION_DIR`，
不依赖 `~/.pi`。

## 1. 进程模型

```text
Tauri WebView
    │ 受限 WebSocket / Tauri IPC
    ▼
Rust Host
    ├── SceneProfileStore
    ├── MetadataStore
    └── NativePiManager
            │ stdin/stdout JSONL
            ▼
        pi.exe --mode rpc
            ├── picot-config extension (provider/auth)
            ├── picot-bridge extension (scene policy)
            ├── scene agent directory
            ├── instance session directory
            ├── bundled Git Bash
            └── authorized workspace
```

React 或其他前端框架不参与系统权限边界。当前 Picot 基线使用 Vanilla JS；在功能边界稳定前继续沿用，避免为框架迁移延误 Windows 交付。

## 2. Rust Host 职责

- 窗口和应用生命周期。
- 场景、实例和工作区注册。
- Pi 子进程启动、健康检查、退出和恢复。
- 严格 LF JSONL RPC 编解码。
- 路径授权和工具审批。
- 自动更新和诊断报告。

## 3. Pi Runtime 边界

Pi 继续负责：

- 模型目录和 Provider 适配。
- Session 语义。
- Agent 循环。
- Tools、Skills、Prompt、Extension 和 Package。
- Token 与费用数据。

桌面应用不重新实现 Pi Agent。桌面层只提供产品配置、隔离、安全策略和 UI。

## 4. 存储

```text
%LOCALAPPDATA%\zicode\
├── scene-profiles.json
├── metadata\picot.sqlite3
├── logs\
├── webview\
├── scenes\
│   └── <sha256(scene-id)>\agent\
│       ├── models.json
│       └── settings.json
├── instances\
│   └── <sha256(instance-id)>\
│       ├── runtime.json
│       ├── sessions\
│       ├── logs\
│       └── tmp\
```

旧版本位于 `%APPDATA%\com.zicode.studio.desktop\picot.sqlite3` 的元数据会在首次
启动时复制到新目录；旧文件保留作为迁移备份。`picot.sqlite3` 沿用上游文件名以避免
无必要的格式迁移。API Key 由系统凭据库保存，Pi 启动时仅使用短生命周期的场景隔离
`auth.json` 完成兼容加载，随后删除；密钥不会进入 `models.json`、日志或文档。

Host HTTP/WebSocket 服务仅监听 `127.0.0.1`。在为所有路由补齐设备鉴权和加密传输前，
局域网二维码与远程访问入口保持禁用。

## 5. 启动环境

每个 Pi 进程至少设置：

```text
PI_CODING_AGENT_DIR=<scene>/agent
PI_CODING_AGENT_SESSION_DIR=<instance>/sessions
PI_DESKTOP_SCENE_ID=<scene-id>
PI_DESKTOP_SCENE_NAME=<scene-name>
PI_DESKTOP_SCENE_PROMPT=<scene-system-instructions>
PI_DESKTOP_ALLOWED_TOOLS=<json-tool-allowlist, optional>
PI_DESKTOP_INSTANCE_ID=<instance-id>
PI_DESKTOP_LOG_DIR=<instance>/logs
PATH=<bundled-git>;<controlled-runtime>;<minimal-system-path>
```

场景的 `settings.json` 固定设置内置 Git Bash：

```json
{
  "shellPath": "<install-dir>\\portable-git\\bin\\bash.exe"
}
```

## 6. 内置 Help 文档

应用内 Help 使用 `public/help/` 作为独立内容目录：

- `manifest.json` 定义中文分组与页面顺序，`en/manifest.json` 定义英文目录；
- Markdown 文件保存用户指南，不与聊天消息硬编码；
- `public/native/features/help-center.js` 把文档目录挂载到应用功能区，把正文和页内目录
  挂载到主视图；
- 功能区提供关键词筛选和可折叠目录树，正文提供章节元信息、页内目录与前后篇导航；
- Help 与 Settings 均通过 Activity Bar 切换，不使用覆盖层或独立窗口；
- 桌面端采用 MkDocs 风格内容布局，窄窗口折叠页内目录。

## 7. QVeris 模型目录

每个场景的 QVeris Key 由 Credential Broker 保存在操作系统凭据库。内置模型渠道
使用场景中可编辑的 Gateway 地址，设置 Key 后通过 OpenAI 兼容的 `GET /v1/models`
同步模型目录；Pi 启动时仅短暂物化兼容认证文件，并在注册表加载后删除。
同步只导入带 `chat` 能力的模型，并将视觉、推理、上下文窗口和分层价格映射到 Pi
的 `models.json` 模型格式。

## 8. 故障边界

- Pi 崩溃不能关闭 Tauri 窗口。
- Runtime 恢复使用已持久化 Session，不自动重放未知结果的工具调用。
- 同一实例限制重启频率。
- 协议不兼容时拒绝启动并提供可导出诊断。
- 退出应用时清理整个子进程树。

## 9. 应用插件平台

应用插件位于 Pi Runtime 之上，由 Rust Host 和应用 Shell 共同承载：

```text
Application Shell
  ├── Activity Bar / Sidebar Views / Command Palette / Main View Router
  ├── Chat Core Plugin
  └── sandboxed Plugin Views
             │ Plugin Host API
             ▼
Rust Plugin Host
  ├── registry / package / permission / data / secret / audit
  └── command / capability / Pi tool broker
             │ authenticated loopback bridge
             ▼
Pi + one bundled zicode-plugin-broker extension
```

安装应用插件不会直接向 Pi 增加任意 `--extension`。当前 Scene 中已启用且已获授权的
`piTools` 由一个稳定的内置代理注册，调用经 Rust Host 转发到插件 Capability。
Chat 使用相同的 Capability Registry 调用插件。

Chat 本身作为不可卸载的核心插件接入 Main View Router。切换 Notes、Finance 等插件
时，当前 Main View 独占内容区域，Chat 保存 Session、草稿和滚动状态但退出布局与焦点
树。没有 Main View 的轻量插件可以只贡献 Command 和可选快捷键。插件不向顶部工具栏
或应用菜单注入入口。

远程手机客户端另外把未发送文字与有界图片按 Workspace/Session 分别加密保存到同源
IndexedDB：浏览器生成不可导出的 AES-GCM 256 位 `CryptoKey`，文字变化只更新小型文字
密文，附件变化才重写图片密文；草稿七天过期、成功提交后删除。该层只用于
设备端重载/进程回收恢复，不参与 Host 会话历史、桌面同步或云同步。

远程断线提交复用该草稿层，并另外保存 24 小时有效的 AES-GCM 待发送标记。标记不包含
提示词，只表达当前会话曾由用户主动选择“等待重连”；连接恢复只解锁本地确认条，必须再次
点击“立即发送”才会创建 Runtime 请求，从架构上禁止隐式自动重放。

完整决策、Manifest、API、安全边界和路线图见：

- [ADR 0005](adr/0005-application-plugin-platform.md)
- [应用插件平台总览](plugins/overview.md)
- [Plugin Host API](plugins/host-api.md)
- [内置插件与实施路线图](plugins/built-ins-and-roadmap.md)
