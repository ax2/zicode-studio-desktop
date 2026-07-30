# 实现状态

更新时间：2026-07-30

## 已实现

- Windows GUI subsystem 与统一 `CREATE_NO_WINDOW` 子进程工厂。
- Pi `0.83.0` x64/arm64 官方资产 SHA-256 锁定。
- PortableGit `2.55.0.3` x64/arm64 官方资产 SHA-256 锁定。
- Release 构建缺少 Pi、Git 或 Bash 时直接失败。
- Rust Host 与 Pi 子进程都优先使用内置 PortableGit。
- 固定 SHA-256 的 WebView2 离线安装器与 NSIS 安装钩子。
- 结构化模型渠道：渠道 ID、`baseUrl`、API 类型、模型 ID 和 API Key。
- 编程、金融、创作内置场景，以及自定义场景编辑器。
- 场景提示词与工具白名单在 Pi `tool_call` 前执行；格式损坏时 fail closed。
- 场景级 Pi agent 目录；实例级 session、log 和 tmp 目录。
- ID 经 SHA-256 映射为目录名，不能用路径字符逃逸。
- 历史会话兼容旧目录和新实例目录，并恢复原场景。
- `v*` tag 自动测试、构建 NSIS EXE 和创建 GitHub Release。
- MkDocs Material 严格构建与 GitHub Pages artifact workflow。

## 验证项目

- JavaScript/TypeScript lint 与设计规范检查。
- Vitest 全量测试和 Windows 子进程静态守卫。
- `cargo check --all-targets`。
- Clippy warnings-as-errors。
- Rust 格式检查。
- MkDocs `--strict` 构建。
- Pi、Git、Bash 本地资源版本命令。

## 本地交付证据

以下是改名前完成的安装包验证，文件仍使用历史产品名，不作为当前品牌发布包：

- NSIS：`Pi Windows Desktop_0.1.0_x64-setup.exe`
- 大小：311,788,643 bytes
- SHA-256：`4500ab72ea5b1092a790d5341165ffbda2092eb702ef2670fa1d45901e12024a`
- 包内复核：Pi `0.83.0`、Git `2.55.0.windows.3`、Bash `5.3.15`。
- 包内 WebView2 SHA-256 与 `scripts/webview2-version.json` 一致。
- Release EXE 已在 Windows 上实际启动，标题、连接状态和欢迎界面检查通过。

改名后的代码已通过前端、Rust 和文档检查；名为
`ZiCode Studio Desktop_0.1.0_x64-setup.exe` 的安装包尚未重新构建，将由下一次
本地完整构建或 `v*` Release tag 生成并重新记录哈希与启动验证。

## 发布前外部事项

- 私有仓库为 `ax2/zicode-studio-desktop`，默认分支为 `main`。
- 正式对外分发前建议配置 Windows Authenticode 代码签名。
- 私有仓库 Release 不适合匿名自动更新；当前以安装包下载为交付方式。

## 后续安全增强

当前 API Key 继续使用 Pi 兼容的场景隔离 `auth.json`，不会写入
`models.json`。迁移到 Windows Credential Manager 需要同时为 Pi 提供受控的
运行时凭据适配层，不能只删除兼容文件；该项是后续安全里程碑。
