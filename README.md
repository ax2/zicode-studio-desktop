# Pi Windows Desktop

基于 Tauri + Pi 的开箱即用 Windows 桌面 Agent。安装包固定并携带 Pi Runtime、Git for Windows PortableGit（Git + Bash）以及 WebView2 离线安装器，不要求用户预装 Node.js、Bun、Git、Bash 或 Pi。

项目源自 MIT 许可的 [Picot](https://github.com/shixin-guo/picot)，并针对 Windows 分发、模型渠道、场景和实例隔离进行了重构。上游归属见 [NOTICE](NOTICE)。

## 当前能力

- Tauri 原生桌面壳与内置 Pi RPC 进程。
- Windows 子进程统一隐藏，不弹出短暂命令行窗口。
- 结构化自定义模型渠道：`base_url`、API 协议、模型列表、API Key。
- 内置编程、金融、创作场景，并支持创建自定义场景。
- 场景隔离配置、凭据、扩展和模型渠道。
- 实例隔离进程、会话、日志和临时目录。
- 金融场景使用只读工具白名单；自定义场景可设置工具白名单和系统指令。
- `v*` tag 自动测试、构建 NSIS EXE，并创建 GitHub Release。
- MkDocs Material 产品、架构和交付文档。

## 开发

需要 Bun 1.3.14、Rust stable 和 Windows 构建工具。运行：

```powershell
bun install --frozen-lockfile
bun run fetch:pi
bun run fetch:portable-git
bun run fetch:webview2
bun run build:extensions
bun run tauri dev
```

校验：

```powershell
bun run test
bun run check
.\src-tauri\resources\portable-git\bin\bash.exe scripts/check-rust.sh
python -m mkdocs build --strict
```

## 发布

推送形如 `v0.1.0` 的 tag 后，[Windows release workflow](.github/workflows/release.yml) 会在干净的 Windows runner 上：

1. 下载锁定版本的 Pi 和 PortableGit；
2. 校验官方 SHA-256；
3. 验证 `pi.exe`、`git.exe`、`bash.exe`；
4. 运行前端与 Rust 检查；
5. 构建包含全部离线依赖的 NSIS EXE；
6. 发布到当前私有仓库的 GitHub Release。

详细说明见 [项目文档](docs/index.md) 和 [Windows 打包](docs/windows-packaging.md)。

## 安全与凭据

模型密钥不会写入 `models.json`、日志或文档。每个场景使用独立的 Pi agent 目录；当前版本沿用 Pi 的本地 `auth.json` 存储机制，迁移到 Windows Credential Manager 已列入后续安全工作。

## License

本项目使用 MIT License。第三方组件及归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
