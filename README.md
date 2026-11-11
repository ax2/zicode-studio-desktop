# ZiCode Studio Desktop

ZiCode Studio Desktop 是一款面向 Windows、macOS 和 Linux 的本地优先开发者桌面应用。它把浏览器、笔记、AI 协作和开发工具放在同一个工作台中，使用 Tauri 2、Rust Host、React 和内嵌 [Pi](https://github.com/earendil-works/pi)。

## 下载与安装

在 [GitHub Releases](https://github.com/ax2/zicode-studio-desktop/releases/latest) 下载对应系统的安装包。[v0.5.6 发布说明](https://github.com/ax2/zicode-studio-desktop/releases/tag/v0.5.6)记录了浏览器下载管理、书签导入导出和网页剪藏等改进。

| 平台 | 安装包 | 运行环境 |
| --- | --- | --- |
| Windows 10/11 x64 | NSIS `.exe` | 内置 Pi、Bun、PortableGit（Git 与 Bash）和 WebView2 离线安装器 |
| macOS | Apple Silicon 和 Intel `.dmg` | 内置 Pi、Bun，使用系统 Git 与 Shell |
| Linux x64 | `.AppImage` 或 `.deb` | 内置 Pi、Bun，使用系统 Git 与 Shell |

签名自动更新仍待配置，正式版本通过 GitHub 安装包更新。开发源码的内嵌 Pi 版本见 [Pi 版本锁](scripts/pi-version.json)，安装包使用对应发布标签锁定的运行时。

## 主要功能

- **浏览器** · Windows 默认进入浏览器，也可在设置中选择工作台。支持多标签、网站图标、地址栏搜索、书签与 HTML 导入导出、历史、下载、页面查找、缩放和恢复标签。浏览器网页在单独的 WebView2 中运行。macOS 和 Linux 的内置网页引擎仍待交付。[浏览器需求与验收](docs/browser/requirements.md)
- **笔记** · 通过笔记本整理文稿、附件和网页剪藏。剪藏保留来源网址和采集信息，笔记资料随工作区保存。
- **AI 协作** · 使用内嵌 Pi 管理对话和工具调用，支持自定义模型渠道、API 地址和协议。可以先审阅网页正文、选区和多标签内容，再放入对话草稿。Agent Inbox 支持飞书和企业微信智能机器人的官方长连接。
- **工具与桌面入口** · 常用工具可从主界面和 Windows 托盘快速打开。工具中心支持独立插件、文件校验与导出。ZiDevTools 逐项接入和验收范围以清单为准。[ZiDevTools 接入清单](docs/plugins/devtools-all-tools.md)
- **工作台** · 默认工作区提供会话、文件、任务、终端和产物管理。日常界面使用简化导航，内部保留工作区、会话和权限边界。

视觉资产中心是与浏览器、笔记并列的长期核心模块，目前在开发。阶段计划覆盖本地图库、版本与备份、加工导出、角色与生成工作流。[视觉资产中心架构决定](docs/adr/0008-visual-asset-studio.md)

## 数据与凭据

应用数据与安装位置分开。Windows 默认将运行资料放在 `%LOCALAPPDATA%\zicode`，系统资料放在 `%USERPROFILE%\.zicode`。笔记和附件位于工作区自己的 `.zicode` 目录。安装升级沿用同一资料选择，开发验证可通过 `--isolated-profile <绝对路径>` 使用单独的测试资料。[固定数据目录与升级](docs/desktop-persistent-data.md)

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

使用 Bun 和 Rust stable。Windows 构建需要 Visual Studio Build Tools 的 C++ 桌面开发组件。macOS 和 Linux 需要安装对应的 Tauri 原生构建依赖。[开发环境](docs/windows-packaging.md)

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

将 `VERSION` 替换为目标版本。版本锁记录上游发布的六个平台 SHA-256 摘要，扩展 SDK 与内嵌运行时使用同一版本。

```text
bun run update:pi:lock -- VERSION
bun add -d -E @earendil-works/pi-coding-agent@VERSION @earendil-works/pi-tui@VERSION
bun run check:pi-sdk-alignment
bun run typecheck:extensions-source
bun run build:extensions
bun run fetch:pi
bun run smoke:pi-rpc:update
bun run smoke:pi-rpc
```

RPC 冒烟测试在隔离目录运行，验证二进制版本、命令发现和扩展执行。版本锁、依赖锁和对应的 RPC 契约记录在仓库中，平台二进制由构建钩子准备。[维护说明](AGENTS.md#bumping-the-embedded-pi-version)

### 发布

正式发布使用 `bun run release VERSION`。发布脚本在干净的发布工作树校验版本并推送标签。[GitHub Actions 发布流程](.github/workflows/release.yml)构建 Windows、两种 macOS 架构和 Linux 安装包，核对五个产物后发布 Release。

## 文档与许可

- [项目文档](docs/index.md) · 产品计划、架构、开发与交付记录。
- [插件平台](docs/plugins/host-api.md) · Host 接口与权限范围。
- [桌面入口](docs/plugins/explorer-folder-entry.md) · Windows 资源管理器与工作区入口。

本项目最初参考 [Picot](https://github.com/shixin-guo/picot) 的 Pi 桌面封装思路，现独立维护。历史 `picot-*` 协议名和存储标识继续用于兼容已有扩展与资料。[MIT License](LICENSE) · [NOTICE](NOTICE) · [第三方声明](THIRD_PARTY_NOTICES.md)
