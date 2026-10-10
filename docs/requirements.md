# 产品需求

## 1. 产品定位

ZiCode Studio Desktop 是本地优先的跨平台开发者个人平台。用户无需打开终端即可管理项目、选择工作区和场景、配置模型、创建会话、审阅工具调用、运行项目任务并恢复历史工作。

目标交付范围：

- Windows 10/11 x64：NSIS 安装包，内置 Pi、Portable Git、Git Bash 和 WebView2 离线安装器。
- macOS Apple Silicon：DMG，内置 Pi，使用系统 Shell 与 Git；正式分发仍需签名和公证方案。
- macOS Intel x64：DMG，内置 Pi，使用系统 Shell 与 Git；正式分发仍需签名和公证方案。
- Linux x64：AppImage 和 DEB，内置 Pi，使用系统 Shell 与 Git。
- 单用户本地应用。
- 用户自选的在线模型、本地 OpenAI 兼容模型及代理渠道；核心项目工作流不能依赖特定服务商或公司运行环境。

构建矩阵仅说明预期产物。每个平台仍需分别验证安装、启动、项目任务、模型调用、升级和卸载；未取得证据前不声明该平台已正式验收。

## 2. 开箱即用

安装包必须包含或可靠安装：

| 组件 | 要求 |
| --- | --- |
| Pi Runtime | 固定版本，随应用打包 |
| Git | Windows 内置 Portable Git；macOS/Linux 使用系统 Git |
| Shell | Windows 内置 Git Bash 并使用系统 PowerShell；macOS/Linux 使用系统 Shell |
| Node/npm | 仅在允许动态 npm 扩展时内置受控版本 |
| WebView2 | Windows 提供离线安装兜底；macOS/Linux 使用系统 WebView |
| 默认场景 | 编程、金融、创作 |
| License | 包含第三方许可证和版本清单 |

干净 Windows 虚拟机在未安装 Node、Git、Pi、Rust 或 WSL 时必须能够安装、启动并完成一次真实任务。macOS/Linux 需在声明的系统依赖下完成等价的安装和任务验证，不能借用 Windows 检查结果作为跨平台证据。

## 3. 自定义模型渠道

模型渠道由用户显式创建、编辑、禁用和删除。空配置不得隐式添加或联网同步任何服务商；目录发现和健康检查由用户主动触发。QVeris 可以作为用户选择的兼容渠道，现有本地代理仅为该渠道的兼容路径，不构成平台默认依赖。其他兼容渠道也应能使用同一套项目与模型工作流。

每个渠道至少保存：

- 稳定 ID、显示名称和渠道类型。
- 用户配置的 `base_url`，不得为通用渠道隐式回退到特定服务商地址。
- Pi API 类型，例如 `openai-responses`、`openai-completions`、`anthropic-messages`。
- 凭证引用，不在普通 JSON 中保存明文密钥。
- 可选 Headers、兼容性参数、代理和超时。
- 模型 ID、显示名称、上下文窗口、最大输出和价格元数据。
- 健康检查结果和最后检查时间。

必须支持新增、编辑、复制、禁用、删除、连接测试和高级 JSON 模式。

## 4. 多场景

内置场景：

### 编程

- 允许选定工作区内读写。
- Git、构建、测试工具可用。
- 删除、跨工作区写入和网络发布需要审批。

### 金融

- 默认只读文件策略。
- Shell 默认关闭。
- 网络使用域名白名单。
- 强制显示数据来源、时间和免责声明。
- 凭证和导出操作必须审计。

### 创作

- 允许指定素材目录。
- 支持研究、写作和媒体扩展。
- 代码执行默认关闭。
- 发布和上传动作需要确认。

用户可以复制内置场景并创建自定义场景。

## 5. 实例隔离

每个运行实例必须隔离：

- Pi OS 进程。
- `PI_CODING_AGENT_DIR`。
- Session 目录。
- 扩展、Skills 和 Package 目录。
- 日志和临时目录。
- 工具与网络策略。
- 工作区授权。

同一场景可以共享场景配置，但不同实例不能共享运行状态。不同场景默认不共享模型配置、Memory、扩展和会话。凭证由系统凭证存储统一管理，只共享引用和明确授权。

## 6. 安全

- 前端不能直接启动任意进程。
- Rust Host 是唯一系统能力入口。
- API Key 使用当前操作系统的凭据存储保护；跨平台验收应分别检查读取、更新和删除。
- 所有路径在 Rust 侧 canonicalize 并验证授权根目录。
- 危险工具操作必须生成审批请求和审计记录。
- 日志不得包含密钥、Authorization Header 或完整敏感输入。
- 金融等高风险场景可以禁用 Shell 和任意扩展。

## 7. 发布与文档

- 推送 `v*` tag 自动构建并创建 GitHub Release。
- Release 至少包含经过对应平台验证的 Windows x64 NSIS EXE、macOS Apple Silicon 与 Intel DMG、Linux x64 AppImage 和 DEB；各平台依赖边界按第 2 节执行。
- Updater manifest 必须签名。
- MkDocs 使用 `--strict` 构建。
- 架构、需求、ADR、阶段日志和验证记录随代码提交。

## 8. 桌面体验与外部消息

- 默认语言为简体中文，至少支持简体中文与英文切换。
- 默认主题为明亮白色；外观设置使用下拉框显示主题名称，不展示颜色样本。
- 应用数据必须使用操作系统本地数据根目录下的 `zicode`，不得使用
  `~/.pi`。
- Agent Inbox 支持飞书开放平台和企业微信智能机器人的官方 WebSocket 长连接。
- 不支持 Telegram；“微信”特指企业微信智能机器人，个人微信没有官方机器人接口。

## 9. 应用插件平台

应用插件必须独立于 Pi Extension，并由桌面 Host 统一管理：

- 左侧提供 Activity Bar 和可折叠的 Sidebar Views；
- Chat 是内置、不可卸载的默认插件；
- 插件可以占用 Main View；激活后 Chat 界面不可见但会话状态保留；
- 插件通过权限化 Host API 调用 Pi，不获得原始 RPC 或任意 Tauri IPC；
- Chat 和 Pi 可以通过 Capability/Pi Tool Broker 调用插件；
- 插件可以贡献 Command、Setting 和 Keybinding，不要求每个插件都有 Activity；
- 应用插件不贡献顶部 Toolbar 或应用 Menu；轻量插件通过 Command Palette、快捷键、
  上下文动作或插件界面内的局部动作使用；
- 安装、启用、禁用、更新、回滚、权限、卸载和数据保留都可以在 Plugin Manager 中
  管理；
- 内置插件至少包括 Chat、Notes 和 Finance，并规划 Artifacts 与自动化能力；
- Notes 使用本地可读 Markdown 作为内容真相，并维护 Astro Content Collection 兼容
  目录，为同步、多端和独立客户端保留稳定 ID 与变更协议；
- 第三方插件在默认分发前必须具备包签名和可信的后台沙箱，不能把 iframe 或 Web Worker
  宣称为操作系统安全边界。

Manifest、Host API、UI、安全和实施阶段见[应用插件平台文档](plugins/overview.md)。

## 10. 验收

完成状态需要以下证据：

- 单元和集成测试通过。
- Rust `cargo check`、Clippy 和格式检查通过。
- MkDocs 严格构建通过。
- Release Workflow 成功生成安装包。
- 干净 Windows 虚拟机断网安装验证。
- macOS 和 Linux 分别完成原生安装、启动、项目任务、模型调用、升级及卸载验证。
- 无可见子进程控制台窗口。
- 多场景、多实例并行运行和目录隔离验证。
- 插件按场景启停、权限撤销、Main View 切换、Chat/Pi Capability 调用和卸载数据保留
  验证。
