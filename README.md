# ZiCode Studio Desktop

ZiCode Studio Desktop 定位于全方位、跨平台的开发者个人平台，基于 Tauri 2 和 Pi 构建，面向
Windows、macOS 和 Linux。所有平台均内置 Pi Runtime；Windows 安装包还内置
PortableGit（Git + Bash）和 Microsoft WebView2 离线安装器，最终用户不需要预装
Node.js、Bun、Pi 或 WSL。Windows 用户也不需要预装 Git 或 Bash；当前 macOS 和 Linux
构建仍使用操作系统提供的 Shell 与 Git 工具。

以个人项目为中心，贯通代码开发、AI 协作、知识积累、任务自动化和成果交付，
支持自定义模型渠道以及彼此隔离的场景、实例和会话。平台正在持续建设，
能力边界和后续验收见[开发者个人平台推进计划](docs/developer-platform.md)。

Zi DevTools接入目标为通过独立插件体系覆盖全部工具；逐项接入状态与暂不能接入的原因见
[全部工具接入目标和清单](docs/plugins/devtools-all-tools.md)，首批五能力不代表整体完成。

> 当前版本为早期开发版本，仓库已公开。已发布安装包见
> [v0.4.2 安装包](https://github.com/ax2/zicode-studio-desktop/releases/tag/v0.4.2)（Windows、macOS、Linux）。源码主分支包含发布后的开发进展，安装包对应固定发布标签；插件全集接入仍在推进，不能视为全部工具已验收。

## 主要能力

- **自包含运行环境**：所有平台内置锁定版本的 Pi；Windows 另内置 Git、Bash 和
  WebView2 安装器。
- **无终端窗口**：Windows 后台子进程统一以无控制台模式启动。
- **自定义模型渠道**：配置 `base_url`、API 协议、模型列表和 API Key。
- **可选模型目录适配**：按需添加自己的 QVeris 兼容网关渠道，并手动刷新模型目录；
  新场景不会自动创建渠道或向外部网关发起目录请求。
- **中文优先界面**：默认简体中文，可切换 English；默认使用明亮白色主题。
- **Agent Inbox**：通过官方长连接接入飞书和企业微信智能机器人，不提供个人微信或
  Telegram 接入。
- **多场景工作台**：内置编程、金融、创作场景，并可创建自定义场景。
- **场景隔离**：每个场景拥有独立的模型、凭据、扩展、系统指令和工具策略。
- **实例隔离**：每个实例拥有独立的进程、会话、日志和临时目录。
- **安全策略**：金融场景默认使用只读工具白名单，自定义场景可限制工具范围。
- **自动发布**：推送 `v*` tag 后自动构建 Windows NSIS、macOS DMG、Linux
  AppImage/DEB，并在全部成功后公开 GitHub Release。
- **工程文档**：使用 MkDocs Material 维护需求、架构、ADR、打包和方案评审。

## 架构概览

```text
Tauri WebView
    │ WebSocket / Tauri IPC
    ▼
Rust Host
    ├── SceneProfileStore
    ├── MetadataStore
    └── NativePiManager
            │ JSONL over stdin/stdout
            ▼
        Embedded Pi Runtime
            ├── Provider and model configuration
            ├── Scene policy
            ├── Isolated agent directory
            └── Isolated session directory

Platform resources
    ├── Windows bundle: PortableGit (Git + Bash) and WebView2 offline installer
    └── macOS/Linux: operating-system Git and shell tools
```

详细设计见 [架构方案](docs/architecture.md) 和
[场景与实例隔离](docs/scenes-and-isolation.md)。

## 开发环境

- Windows 10/11 x64、macOS 或 Linux（各系统还需安装 Tauri 2 对应的原生构建依赖）
- Bun 1.3.14 与 Rust stable
- Windows 需要 Microsoft Visual Studio Build Tools（Desktop development with C++）
- Python 3.11+ 仅用于构建 MkDocs 文档

```powershell
git clone https://github.com/ax2/zicode-studio-desktop.git
cd zicode-studio-desktop
bun install --frozen-lockfile
bun run dev
```

`bun run dev` 使用当前系统的路径分隔符补充 Cargo 工具目录。Tauri 启动前会
准备对应平台的运行时资源、扩展和 React 页面；macOS/Linux 仍需系统 Git 与 Shell。

升级内置 Pi 到上游最新版并验证本机 RPC：

```powershell
bun run update:pi
```

升级到指定版本：

```powershell
bun run update:pi -- 0.83.0
```

该命令会从 `earendil-works/pi-mono` Release 读取六个平台资源的 GitHub
SHA-256 摘要，原子更新 `scripts/pi-version.json`，下载当前平台二进制并执行
RPC 冒烟测试。每日检查工作流使用同一套锁文件生成逻辑，避免只改版本号却遗留旧摘要。

## 验证

```powershell
bun run check
bun run test
.\src-tauri\resources\portable-git\bin\bash.exe scripts/check-rust.sh
python -m mkdocs build --strict
```

完整的 Windows 安装包构建：

```powershell
bun run build
```

构建产物位于 `target/release/bundle/nsis/`。

## 发布

不要在 GitHub 网页中手动创建 tag 或 Release。只有有意发布新版本时才使用发布脚本，
将 `VERSION` 替换为尚未使用的版本号；日常开发保持当前版本不变：

```bash
bun run release VERSION
```

[Desktop release workflow](.github/workflows/release.yml) 会先校验 tag 与
`package.json`、Tauri、Cargo 版本完全一致，创建不可见的草稿 Release，然后并行：

1. 构建 Windows x64 NSIS（内置 Pi、PortableGit、WebView2）；
2. 构建 macOS Apple Silicon DMG（内置 Pi）；
3. 构建 macOS Intel DMG（内置 Pi）；
4. 构建 Linux x64 AppImage 和 DEB（内置 Pi）；
5. 运行平台验证并校验上传产物的版本、架构、大小与 SHA-256；
6. 仅在全部平台成功且五个安装包齐全后公开 Release。

发布工作流与应用标签分别绑定固定提交。若只需修复草稿的发布校验工具，可在 `main`
运行 Desktop release 的 `workflow_dispatch` 并指定已有标签；应用仍从原标签构建，
完整检查与资产大小、SHA-256 校验仍全部执行，不移动标签或额外增加应用版本号。

若草稿仅缺 Intel Mac 产物，可选择 `platform=macos-intel` 定向重建；该平台完整检查、
最终 DMG 验证和上传摘要校验仍执行，但不会自动公开 Release。恢复发布前必须核对
其他平台同一应用标签的成功证据、最终五资产清单和摘要。也可使用 Verify existing
release DMGs 单独验证已有 DMG，避免因校验工具问题重复编译。

当前版本的证据与验收边界见 [v0.4.2 验证与交付记录](docs/releases/v0.4.2-verification.md)。

macOS 和 Linux 当前使用系统 Shell/Git；macOS 包采用 ad-hoc 签名，尚未进行 Apple
Developer ID 签名与公证。发布和签名说明见
[Windows 打包文档](docs/windows-packaging.md)。

## 数据与凭据

- 应用数据统一保存在操作系统的 `zicode` 专用本地数据目录，不读取或
  写入用户主目录下的 `~/.pi`。
- Windows 下元数据、日志和 WebView 数据统一位于 `%LOCALAPPDATA%\zicode`；
  旧版元数据库首次启动时只复制迁移，原文件保留作为备份。
- 模型密钥不会写入 `models.json`、日志或项目文档。
- 模型密钥由 Rust Credential Broker 存入操作系统凭据库；Pi 启动时只短暂生成兼容
  `auth.json`，模型注册表加载后立即删除。
- 每个运行实例使用独立的 Session、日志和临时目录。
- Windows 使用 Credential Manager；其他桌面平台使用 `keyring` 对应的系统凭据服务。
- Host 服务仅监听 `127.0.0.1`；局域网访问在完整鉴权和加密传输实现前保持禁用。
- 当前尚未启用签名自动更新产物，桌面端不会在启动时请求无效更新源；
  新版本通过 GitHub Releases 手动安装。

内部仍保留少量 `picot-*` 协议名、存储键和 `picot.sqlite3` 文件名。这些是历史
兼容标识，不是当前产品品牌；保留它们可以避免破坏已有扩展、会话和本地数据。

## 文档

文档入口为 [docs/index.md](docs/index.md)。本地预览：

```powershell
python -m pip install -r requirements-docs.txt
python -m mkdocs serve
```

## 项目来源与许可证

本项目最初参考了 [Picot](https://github.com/shixin-guo/picot) 对 Pi 进行桌面封装的架构思路，
没有直接 fork Picot，后续也未持续跟进其开发。本项目独立维护，当前定位为跨平台开发者个人平台，
不应描述为“直接基于 Picot”的项目。

根据项目维护者提供的历史背景，Picot 本身 fork 自 [Tau](https://github.com/deflating/tau)。
截至 2026-10-11，Picot 原地址已无法公开访问，无法重新核实其历史仓库元数据；Tau 已声明停止维护。
本仓库保留的历史提交、兼容标识和既有版权声明不代表仍在同步这些项目，
也不代表所有历史内容均为本项目原创。既有 MIT 版权声明继续保留；详情见
[NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目使用 [MIT License](LICENSE)。
