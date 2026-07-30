# ZiCode Studio Desktop

ZiCode Studio Desktop 是基于 Tauri 2 和 Pi 构建的桌面 AI 工作台，支持
Windows、macOS 和 Linux。所有平台均内置 Pi Runtime；Windows 安装包还内置
PortableGit（Git + Bash）和 Microsoft WebView2 离线安装器，最终用户不需要预装
Node.js、Bun、Git、Bash、Pi 或 WSL。当前 macOS 和 Linux 构建仍使用操作系统提供的
Shell 与 Git 工具。

项目面向编程、金融、创作和自定义工作流，支持自定义模型渠道以及彼此隔离的场景、
实例和会话。

> 当前版本为早期开发版本。仓库暂时保持私有，发布包仅供已授权的协作者使用。

## 主要能力

- **自包含运行环境**：所有平台内置锁定版本的 Pi；Windows 另内置 Git、Bash 和
  WebView2 安装器。
- **无终端窗口**：Windows 后台子进程统一以无控制台模式启动。
- **自定义模型渠道**：配置 `base_url`、API 协议、模型列表和 API Key。
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
            ├── Isolated session directory
            └── Bundled Git Bash
```

详细设计见 [架构方案](docs/architecture.md) 和
[场景与实例隔离](docs/scenes-and-isolation.md)。

## 开发环境

- Windows 10/11 x64
- Bun 1.3.14
- Rust stable
- Microsoft Visual Studio Build Tools（Desktop development with C++）
- Python 3.11+（仅用于构建 MkDocs 文档）

```powershell
git clone https://github.com/ax2/zicode-studio-desktop.git
cd zicode-studio-desktop
bun install --frozen-lockfile
bun run fetch:pi
bun run fetch:portable-git
bun run fetch:webview2
bun run build:extensions
bun run tauri dev
```

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

不要在 GitHub 网页中手动创建 tag 或 Release。使用发布脚本同步全部版本源并推送：

```bash
bun run release 0.1.0
```

[Desktop release workflow](.github/workflows/release.yml) 会先校验 tag 与
`package.json`、Tauri、Cargo 版本完全一致，创建不可见的草稿 Release，然后并行：

1. 构建 Windows x64 NSIS（内置 Pi、PortableGit、WebView2）；
2. 构建 macOS Apple Silicon DMG（内置 Pi）；
3. 构建 Linux x64 AppImage 和 DEB（内置 Pi）；
4. 运行平台验证并上传所有产物；
5. 仅在全部构建成功后公开 Release。

macOS 和 Linux 当前使用系统 Shell/Git；macOS 包采用 ad-hoc 签名，尚未进行 Apple
Developer ID 签名与公证。发布和签名说明见
[Windows 打包文档](docs/windows-packaging.md)。

## 数据与凭据

- 模型密钥不会写入 `models.json`、日志或项目文档。
- 每个场景使用独立的 Pi agent 目录和 `auth.json`。
- 每个运行实例使用独立的 Session、日志和临时目录。
- Windows Credential Manager 集成仍是后续安全工作。

内部仍保留少量 `picot-*` 协议名、存储键和 `picot.sqlite3` 文件名。这些是上游
兼容标识，不是当前产品品牌；保留它们可以避免破坏已有扩展、会话和本地数据。

## 文档

文档入口为 [docs/index.md](docs/index.md)。本地预览：

```powershell
python -m pip install -r requirements-docs.txt
python -m mkdocs serve
```

## 上游与许可证

本项目基于 MIT 许可的
[Picot](https://github.com/shixin-guo/picot)，并针对 Windows 自包含分发、模型渠道、
多场景与实例隔离进行了扩展。上游版权和第三方依赖信息见
[NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目使用 [MIT License](LICENSE)。
