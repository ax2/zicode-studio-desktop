# 自动更新

ZiCode Studio Desktop 集成了 Tauri v2 updater 插件。仓库已公开，但签名自动更新尚未验收，
`createUpdaterArtifacts` 暂时设为 `false`。现阶段发布流程构建 Windows NSIS、
macOS Apple Silicon 与 Intel DMG，以及 Linux AppImage/DEB 安装包，采用手动安装升级。

## 当前状态

- 稳定更新地址预留为：
  `https://github.com/ax2/zicode-studio-desktop/releases/latest/download/latest.json`
- Beta 更新地址预留为：
  `https://github.com/ax2/zicode-studio-desktop/releases/download/beta/latest.json`
- 已公开的 Release 安装包可匿名下载；尚未提供可用的签名更新清单。
- `.github/workflows/release.yml` 当前构建 Windows NSIS、两种 macOS DMG 和 Linux
  AppImage/DEB，但不生成 `latest.json` 或签名更新包。

因此，当前版本通过 GitHub Release 手动下载安装包升级。应用内更新入口只有在未来
启用签名产物并完成更新分发验证后才能正式开放。
未启用自动更新时，设置页的按钮会打开 GitHub Releases 列表供手动下载。

## 启用条件

正式启用自动更新前需要同时完成：

1. ~~为 Tauri updater 生成独立签名密钥。~~ **已完成（2026-08-12）**：
   新 minisign 密钥对已生成并保存在 `~/.tauri/zicode-studio-desktop.key`
   （私钥）与 `~/.tauri/zicode-studio-desktop.key.pub`（公钥），密码
   在 `~/.tauri/zicode-studio-desktop.key.password`；私钥与密码文件
   ACL 已限制为仅本机用户 + SYSTEM + Administrators，**绝不提交到
   Git、文档或日志**。
2. ~~将公钥写入 `src-tauri/tauri.conf.json` 的
   `plugins.updater.pubkey`。~~ **已完成（2026-08-12）**：配置中的
   公钥已替换为新密钥对匹配的公钥。
3. 将私钥和密码保存为 GitHub Actions secrets：
   `TAURI_SIGNING_PRIVATE_KEY` 和
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
   （私钥内容与密码文件均在本机 `~/.tauri/` 下，按需读取。）
4. 将 `bundle.createUpdaterArtifacts` 改为 `true`。
   当前 Release 草稿只允许五个安装包，`prepare-release` 会在创建草稿前拒绝
   该开关打开；先扩展发布资产清单与签名校验，再修改配置。
5. 在 Release workflow 中注入签名变量并验证生成的 `.sig` 与
   `latest.json`。`release.yml` 的
   tauri-action 已注入 `TAURI_SIGNING_PRIVATE_KEY` 与
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（secrets 为空时无副作用），
   并准备在签名 secrets 配置后上传 `.sig` 与 `latest.json` 到草稿
   Release。真实构建、产物路径和多平台更新清单合并均未验证；
   启用前需确认三个平台的签名与清单完整，不能依靠单个平台覆盖同名清单。
6. 验证公开 Release 资产和更新清单可以匿名下载。
7. 用旧版本到新版本完成一次真实的下载、签名校验、安装和重启测试。

私钥不得提交到 Git、文档、安装包或日志。

## Release tag

当前发布入口仍然是：

```bash
bun run release 0.1.0
```

脚本会同步更新应用版本、创建 `v0.1.0` tag 并推送。Desktop Release workflow
随后校验 tag 与全部版本源，以草稿状态构建并上传各平台安装包，仅在全部平台成功后
公开 Release。不要提前在 GitHub 网页中手动创建 Release。
发版前，本地脚本要求 `origin` 与 `scripts/release-repository.json` 一致；CI 也要求
`GITHUB_REPOSITORY` 与该配置一致。`upstream` 仅用于跟踪上游，不是发布目标。

## 相关文件

| 文件 | 职责 |
|---|---|
| `src-tauri/tauri.conf.json` | 产品标识、更新地址和 updater 公钥 |
| `src-tauri/src/main.rs` | updater 插件和 Beta 更新命令 |
| `public/native/features/app-updater.js` | 更新设置与前端交互 |
| `.github/workflows/release.yml` | Windows、macOS、Linux 测试、打包和 Release 发布 |
| `scripts/release.sh` | 版本号、提交和 tag 管理 |
