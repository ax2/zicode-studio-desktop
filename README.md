# ZiCode Studio Desktop

ZiCode Studio Desktop 是基于 Tauri 2 和 Pi 构建的开箱即用 Windows AI
工作台。它将 Pi Runtime、PortableGit（Git + Bash）和 Microsoft WebView2
离线安装器一并打入安装包，最终用户不需要预装 Node.js、Bun、Git、Bash、Pi 或
WSL。

项目面向编程、金融、创作和自定义工作流，支持自定义模型渠道以及彼此隔离的场景、
实例和会话。

> 当前版本为早期开发版本。仓库暂时保持私有，发布包仅供已授权的协作者使用。

## 主要能力

- **自包含运行环境**：内置锁定版本的 Pi、Git、Bash 和 WebView2 安装器。
- **无终端窗口**：Windows 后台子进程统一以无控制台模式启动。
- **自定义模型渠道**：配置 `base_url`、API 协议、模型列表和 API Key。
- **多场景工作台**：内置编程、金融、创作场景，并可创建自定义场景。
- **场景隔离**：每个场景拥有独立的模型、凭据、扩展、系统指令和工具策略。
- **实例隔离**：每个实例拥有独立的进程、会话、日志和临时目录。
- **安全策略**：金融场景默认使用只读工具白名单，自定义场景可限制工具范围。
- **自动发布**：推送 `v*` tag 后自动测试、构建 NSIS 安装包并创建 GitHub Release。
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

推送形如 `v0.1.0` 的 tag 后，
[Windows release workflow](.github/workflows/release.yml) 会：

1. 下载并校验锁定版本的 Pi、PortableGit 和 WebView2；
2. 验证 `pi.exe`、`git.exe` 和 `bash.exe`；
3. 运行前端、权限、Windows 子进程和 Rust 检查；
4. 构建包含离线依赖的 NSIS EXE；
5. 将安装包发布到当前仓库的 GitHub Release。

发布和签名说明见 [Windows 打包文档](docs/windows-packaging.md)。

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
