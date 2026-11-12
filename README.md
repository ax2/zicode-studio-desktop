# ZiCode Studio Desktop

ZiCode Studio Desktop 是一款面向 Windows、macOS 和 Linux 的本地优先开发者桌面应用。它把浏览器、笔记、AI 协作和开发工具放在同一个工作台中，使用 Tauri 2、Rust Host、React 和内嵌 [Pi](https://github.com/earendil-works/pi)。

## 下载与安装

在 [GitHub Releases](https://github.com/ax2/zicode-studio-desktop/releases/latest) 下载对应系统的安装包。[v0.5.9 发布说明](https://github.com/ax2/zicode-studio-desktop/releases/tag/v0.5.9)包含视觉资产中心入口和浏览器下载状态、键盘操作改进。本版只提供 Windows x64 安装包；macOS 和 Linux 用户可继续使用此前版本。

| 平台 | 安装包 | 运行环境 |
| --- | --- | --- |
| Windows 10/11 x64 | NSIS `.exe` | 内置 Pi、Bun、PortableGit（Git 与 Bash）和 WebView2 离线安装器 |
| macOS | Apple Silicon 和 Intel `.dmg` | 内置 Pi、Bun，使用系统 Git 与 Shell |
| Linux x64 | `.AppImage` 或 `.deb` | 内置 Pi、Bun，使用系统 Git 与 Shell |

通过 GitHub 安装包升级。签名自动更新尚未启用。Studio 安装包已包含 Pi，无需另外安装。

在 Studio 的「设置 → 软件更新」中可查看当前安装的 **Pi 版本**和 **Studio 版本**。

| 使用方式 | 内嵌 Pi |
| --- | --- |
| 从当前源码构建 | [Pi 1.5.2](https://github.com/earendil-works/pi/releases/tag/v1.5.2)（[源码版本锁](scripts/pi-version.json)） |
| 安装 GitHub Release 的 Studio v0.5.9 | Pi 1.5.2（[发布标签版本锁](https://github.com/ax2/zicode-studio-desktop/blob/v0.5.9/scripts/pi-version.json)） |

## 开始使用

1. Windows 默认打开浏览器。可在浏览器设置中改为启动时打开工作台。
2. 用左侧入口打开笔记、工具或 AI 会话。Windows 托盘也可直接打开已设为快捷入口的工具。
3. 使用 AI 前，在设置中配置模型渠道。将网页内容加入 AI 对话时，可以先检查草稿，再决定是否发送。

## 主要功能

- **浏览器** · Windows 使用独立的 WebView2 网页视图。支持多标签、地址栏搜索、书签与 HTML 导入导出、历史、下载、页面查找、缩放和会话恢复。macOS 和 Linux 的内置网页引擎仍待交付。[浏览器需求与验收](docs/browser/requirements.md)
- **笔记** · 通过笔记本整理 Markdown 笔记、附件和网页剪藏。剪藏保留来源网址，笔记存放在工作区。加密云同步仍在开发。[笔记同步进度](docs/iterations/2026-11-04-notes-vault-sync.md)
- **AI 协作** · 使用内嵌 Pi 管理对话和工具调用，支持自定义模型渠道、API 地址和协议。可以先审阅网页正文、选区和多标签内容，再放入对话草稿。Agent Inbox 支持飞书和企业微信智能机器人的官方长连接。
- **工具与桌面入口** · 常用工具可从主界面和 Windows 托盘快速打开。工具中心支持独立插件、文件校验与导出。ZiDevTools 逐项接入和验收范围以清单为准。[ZiDevTools 接入清单](docs/plugins/devtools-all-tools.md)
- **工作台** · 默认工作区提供会话、文件、任务、终端和产物管理。日常界面使用简化导航，内部保留工作区、会话和权限边界。

视觉资产中心作为长期核心模块随 Windows 版提供，可从笔记下方的“视觉资产”入口打开本地图库，导入图片、查看缩略图和预览。角色生成、文稿模型审核等高级流程仍按开发记录逐项验收，入口可用不代表全部规划已完成。[视觉资产中心开发记录](docs/visual-assets/development.md)

## 数据与凭据

应用数据保存在独立于安装包和版本号的位置。Windows 默认运行资料位于 `%LOCALAPPDATA%\zicode`，系统资料位于 `%USERPROFILE%\.zicode`，笔记和附件位于工作区的 `.zicode\notes`。升级后继续使用原配置和工作区。开发验证可传入 `--isolated-profile <绝对路径>`，使用独立的测试资料。[固定数据目录与升级](docs/desktop-persistent-data.md)

备份时保留工作区及配置目录。只复制安装包或 EXE 不会备份笔记。

模型凭据通过 Rust Credential Broker 和系统凭据库管理。Pi 的会话、日志和临时目录按运行实例隔离。[数据与进程架构](docs/architecture.md)

## 架构

```text
Studio Shell（Tauri + React）
  ├─ 浏览器界面 → Rust 浏览器模块 → Windows WebView2 网页视图
  ├─ 笔记、产物、工具 → Rust Host → 本地数据库与文件
  └─ AI 会话 → Rust Host → 内嵌 Pi（JSONL RPC）
```

Rust Host 管理窗口、资料、权限、插件能力与 Pi 生命周期。网页视图通过浏览器模块呈现，Studio 的 Tauri 命令由可信界面调用。[架构文档](docs/architecture.md) · [浏览器引擎边界](docs/adr/0007-browser-engine-boundary.md)

## 本地开发

使用 Bun 和 Rust stable，并安装对应平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 Visual Studio Build Tools 的「使用 C++ 的桌面开发」组件，详见 [Windows 构建与打包](docs/windows-packaging.md)。

```text
git clone https://github.com/ax2/zicode-studio-desktop.git
cd zicode-studio-desktop
bun install --frozen-lockfile
bun run dev
```

`bun run dev` 准备当前平台的运行时和前端资源。需要独立调试 EXE 时使用 `bun run build:local`，产物位于 `target/debug`。正式 Windows 安装包使用 `bun run build`，NSIS 产物位于 `target/release/bundle/nsis/`。

```text
bun run check
bun run test
bun run check:rust:static
```

### 更新内嵌 Pi

先在 [Pi Releases](https://github.com/earendil-works/pi/releases/latest) 确认目标稳定版，将 `VERSION` 替换为版本号（不带 `v`）。版本锁记录上游发布的六个目标平台和架构的 SHA-256 摘要；内嵌二进制与扩展 SDK 必须使用同一版本。

```text
bun run update:pi:lock -- VERSION
bun add -d -E @earendil-works/pi-coding-agent@VERSION @earendil-works/pi-tui@VERSION
bun run check:pi-sdk-alignment
bun run typecheck:extensions-source
bun run build:extensions
bun run fetch:pi
```

用 `bun run smoke:pi-rpc:update` 生成新版本的 [RPC 契约](tests/fixtures/pi-rpc)，与前一版本对照，确认命令、状态字段和事件仍兼容，再运行 `bun run smoke:pi-rpc`。这项测试使用隔离目录，验证二进制版本、命令发现和扩展执行。最后启动 Studio 检查版本，并提交 `scripts/pi-version.json`、`package.json`、`bun.lock` 与新契约；下载的二进制不入库。[维护说明](AGENTS.md#bumping-the-embedded-pi-version)

### 发布

正式发布使用 `bun run release VERSION`。发布脚本在干净的发布工作树校验版本并推送标签。[GitHub Actions 发布流程](.github/workflows/release.yml)默认只构建并核对 Windows 安装包后发布 Release。仅在用户明确要求时手动选择 `all`，才构建 macOS 和 Linux；开发平台 CI 同样默认只检查 Windows。

## 文档与许可

- [项目文档](docs/index.md) · 产品计划、架构、开发与交付记录。
- [插件平台](docs/plugins/host-api.md) · Host 接口与权限范围。
- [桌面入口](docs/plugins/explorer-folder-entry.md) · Windows 资源管理器与工作区入口。

本项目最初参考 [Picot](https://github.com/shixin-guo/picot) 的 Pi 桌面封装思路，现独立维护。历史 `picot-*` 协议名和存储标识继续用于兼容已有扩展与资料。[MIT License](LICENSE) · [NOTICE](NOTICE) · [第三方声明](THIRD_PARTY_NOTICES.md)
