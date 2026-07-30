# 产品需求

## 1. 产品定位

ZiCode Studio Desktop 将 Pi Coding Agent 交付为普通 Windows 桌面程序。用户无需打开终端即可选择工作区、选择业务场景、配置模型、创建会话、审阅工具调用和恢复历史任务。

首个正式支持范围：

- Windows 10/11 x64。
- Windows 11 ARM64 在 CI 中构建，发布前需要真实设备验证。
- 单用户本地应用。
- 在线模型、本地 OpenAI 兼容模型和企业代理渠道。

## 2. 开箱即用

安装包必须包含或可靠安装：

| 组件 | 要求 |
| --- | --- |
| Pi Runtime | 固定版本，随应用打包 |
| Git | 内置 Portable Git |
| Bash | 使用内置 Git Bash |
| Node/npm | 仅在允许动态 npm 扩展时内置受控版本 |
| WebView2 | 离线安装兜底或固定 Runtime |
| 默认场景 | 编程、金融、创作 |
| License | 包含第三方许可证和版本清单 |

干净 Windows 虚拟机在未安装 Node、Git、Pi、Rust 或 WSL 时必须能够安装、启动并完成一次真实任务。

## 3. 自定义模型渠道

应用必须预置不可删除的 QVeris Model Gateway，`base_url` 固定为
`https://aigateway.qveris.ai`；用户可以为该渠道添加模型和凭证，也可以继续创建其他
自定义渠道。

每个渠道至少保存：

- 稳定 ID、显示名称和渠道类型。
- `base_url`。
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
- API Key 使用 Windows Credential Manager 或 DPAPI 保护。
- 所有路径在 Rust 侧 canonicalize 并验证授权根目录。
- 危险工具操作必须生成审批请求和审计记录。
- 日志不得包含密钥、Authorization Header 或完整敏感输入。
- 金融等高风险场景可以禁用 Shell 和任意扩展。

## 7. 发布与文档

- 推送 `v*` tag 自动构建并创建 GitHub Release。
- Release 至少包含一个经过验证、携带全部离线依赖的 Windows x64 NSIS EXE。
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

## 9. 验收

完成状态需要以下证据：

- 单元和集成测试通过。
- Rust `cargo check`、Clippy 和格式检查通过。
- MkDocs 严格构建通过。
- Release Workflow 成功生成安装包。
- 干净 Windows 虚拟机断网安装验证。
- 无可见子进程控制台窗口。
- 多场景、多实例并行运行和目录隔离验证。
