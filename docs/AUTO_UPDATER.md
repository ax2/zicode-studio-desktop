# 自动更新

ZiCode Studio Desktop 集成了 Tauri v2 updater 插件，但当前仓库为私有仓库，
`createUpdaterArtifacts` 暂时设为 `false`。现阶段发布流程只生成并上传完整 NSIS
安装包，不向未认证客户端提供自动更新。

## 当前状态

- 稳定更新地址预留为：
  `https://github.com/ax2/zicode-studio-desktop/releases/latest/download/latest.json`
- Beta 更新地址预留为：
  `https://github.com/ax2/zicode-studio-desktop/releases/download/beta/latest.json`
- 私有仓库的 Release 资产需要 GitHub 授权，普通桌面客户端无法匿名下载。
- `.github/workflows/release.yml` 当前构建 Windows NSIS、macOS DMG 和 Linux
  AppImage/DEB，但不生成 `latest.json` 或签名更新包。

因此，当前版本通过 GitHub Release 手动下载安装包升级。应用内更新入口只有在未来
启用签名产物并提供可授权的更新分发服务后才能正式开放。

## 启用条件

正式启用自动更新前需要同时完成：

1. 为 Tauri updater 生成独立签名密钥。
2. 将公钥写入 `src-tauri/tauri.conf.json` 的
   `plugins.updater.pubkey`。
3. 将私钥和密码保存为 GitHub Actions secrets：
   `TAURI_SIGNING_PRIVATE_KEY` 和
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
4. 将 `bundle.createUpdaterArtifacts` 改为 `true`。
5. 在 Release workflow 中注入签名变量并验证生成的 `.sig` 与
   `latest.json`。
6. 为私有仓库实现受控下载代理，或者在产品公开后允许匿名访问 Release 资产。
7. 用旧版本到新版本完成一次真实的下载、签名校验、安装和重启测试。

生成密钥示例：

```bash
bun run tauri signer generate -- -w ~/.tauri/zicode-studio-desktop.key
```

私钥不得提交到 Git、文档、安装包或日志。

## Release tag

当前发布入口仍然是：

```bash
bun run release 0.1.0
```

脚本会同步更新应用版本、创建 `v0.1.0` tag 并推送。Desktop Release workflow
随后校验 tag 与全部版本源，以草稿状态构建并上传各平台安装包，仅在全部平台成功后
公开 Release。不要提前在 GitHub 网页中手动创建 Release。

## 相关文件

| 文件 | 职责 |
|---|---|
| `src-tauri/tauri.conf.json` | 产品标识、更新地址和 updater 公钥 |
| `src-tauri/src/main.rs` | updater 插件和 Beta 更新命令 |
| `public/native/features/app-updater.js` | 更新设置与前端交互 |
| `.github/workflows/release.yml` | Windows、macOS、Linux 测试、打包和 Release 发布 |
| `scripts/release.sh` | 版本号、提交和 tag 管理 |
