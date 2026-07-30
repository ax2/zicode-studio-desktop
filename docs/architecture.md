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
│       ├── auth.json
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
无必要的格式迁移。当前 API Key 使用 Pi
兼容的场景隔离 `auth.json`，不会进入 `models.json`、日志或文档。Windows
Credential Manager 适配属于后续安全里程碑，详见“实现状态”。

Host HTTP/WebSocket 服务仅监听 `127.0.0.1`。在为所有路由补齐设备鉴权和加密传输前，
局域网二维码与远程访问入口保持禁用。

## 5. 启动环境

每个 Pi 进程至少设置：

```text
PI_CODING_AGENT_DIR=<scene>/agent
PI_CODING_AGENT_SESSION_DIR=<instance>/sessions
PI_DESKTOP_SCENE_ID=<scene-id>
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

## 6. 故障边界

- Pi 崩溃不能关闭 Tauri 窗口。
- Runtime 恢复使用已持久化 Session，不自动重放未知结果的工具调用。
- 同一实例限制重启频率。
- 协议不兼容时拒绝启动并提供可导出诊断。
- 退出应用时清理整个子进程树。
