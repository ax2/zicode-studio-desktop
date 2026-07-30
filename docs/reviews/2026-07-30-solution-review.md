# 2026-07-30 方案 Review

## 结论

采用 Tauri 2 + Rust Host + Pi RPC Sidecar。以 Picot 作为 MIT 工程基线是合理的，但上游版本不能原样交付。

## 已确认的可复用能力

- Pi Runtime 已作为 Bun 编译的 `pi.exe` 打包。
- Rust Host 管理独立 Pi RPC 进程。
- 严格 JSONL RPC 桥接。
- 会话、工作区、模型、Skills、Package、成本面板和自动更新已有基础。
- Release tag Workflow 已有多平台构建框架。

## Review 发现

### Windows 弹出两个终端

启动时两个前端模块分别请求 `workspace_info`。Rust 每次执行一次未设置 `CREATE_NO_WINDOW` 的 `git rev-parse --abbrev-ref HEAD`，与用户观察到两个立即退出的终端窗口一致。

### 依赖不完整

Tauri Resources 只有前端、扩展和 Pi。Git、Bash、Node/npm 和离线 WebView2 没有完整交付证据。Pi Windows Runtime 明确仍需要 Bash。

### 自定义模型

Pi 和 Picot 已支持 `models.json`/`baseUrl`，但 UI 主要是原始 JSON 编辑器。需要结构化 Provider Profile 和安全凭证存储。

### 隔离不足

现有代码实现每会话独立 Pi 进程，但仍共享 `~/.pi/agent` 下的配置、凭证、扩展和 Package。需要使用 `PI_CODING_AGENT_DIR` 和自定义 Session 目录建立场景/实例隔离。

## 决策

- 保留上游 Pi RPC 和 Runtime 管理。
- Windows 版本内置 Portable Git Bash。
- 新增 SceneProfile 和 ProviderProfile。
- 实例采用进程、配置、会话、扩展、日志、临时目录和策略多层隔离。
- 密钥迁出普通 `auth.json`，由 Windows Credential Broker 管理。
- Release 仅在测试、Rust 检查、MkDocs 和依赖校验全部通过后发布。

## 风险

- Portable Git 显著增加安装体积。
- 任意 npm Extension 需要受控 Node/npm Runtime，不能仅靠单文件 Pi。
- 目录隔离不是 OS 沙箱；金融或无人值守场景仍需更强执行边界。
- 私有仓库的 Release/Updater 访问策略需要在分发前确定。

