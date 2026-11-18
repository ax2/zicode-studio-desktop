# 软件更新

ZiCode Studio Desktop 当前通过 GitHub Release 的 Windows NSIS 安装包手动升级。设置页显示已安装的 Studio 版本和内嵌 Pi 版本；版本读取失败时显示“不可用”。没有检查公开发行信息时，不把本机版本当作“最新版本”。

## 当前可用入口

- 「设置 → 软件更新 → 使用 GitHub Releases」打开[最新稳定发行](https://github.com/ax2/zicode-studio-desktop/releases/latest)，可查看该版本号、发行说明及 Windows 安装包。草稿和预发行不作为这个手动稳定入口的目标。
- 手动入口不会调用自动更新清单、下载安装或重启 Studio。用户核对版本后自行下载安装包；升级继续使用原来的固定资料目录，见[数据保留说明](desktop-persistent-data.md)。
- Tauri v2 updater 插件已集成，但 `bundle.createUpdaterArtifacts` 仍为 `false`。尚未交付可用的签名自动更新清单，当前不能把自动更新的下载、验证、安装或失败恢复流程标为已验收。
- 稳定清单预留地址为 `https://github.com/ax2/zicode-studio-desktop/releases/latest/download/latest.json`；Beta 预留地址为 `https://github.com/ax2/zicode-studio-desktop/releases/download/beta/latest.json`。这些是未来协议地址，不是当前手动安装包入口或可用性承诺。

## 默认构建与发布范围

默认**只构建和发布 Windows x64**，先验证 Windows 更新路径。macOS 和 Linux 仅在用户明确要求时构建，不因其他平台未验收而阻挡 Windows 手动升级交付。

`.github/workflows/release.yml` 的标签触发和手动触发均默认选择 `windows`；`platform: all` 是显式请求，保留的 `macos-intel` 也是特定修复选项。发布资产清单按实际选定平台核对，不再默认要求五个跨平台安装包或三个平台更新清单全部通过。

## 将来启用签名更新的条件

以下事项仍由 [#32](https://github.com/ax2/zicode-studio-desktop/issues/32) 跟踪，本轮没有开启开关、读取密钥或生成凭据：

1. 核对实际使用的签名配置和公钥，私钥与口令仅由批准的凭据存储提供。2026-08-12 的历史记录说明本机曾生成密钥并配置公钥，不证明当前 Actions secrets 已配置或签名链已验收；历史提交保留供追溯。
2. 启用前先扩展发行资产清单和签名验证，再将 `bundle.createUpdaterArtifacts` 改为 `true`。现有 `prepare-release` 会拒绝在安装包清单尚未扩展时打开该开关。
3. 使用受控的 Actions secrets `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，核对实际产出的签名、安装包和 `latest.json`。不得把密钥或口令提交到 Git、文档、安装包或日志。
4. 验证 Windows 公开发行资产和清单可匿名获取，版本、目标平台、摘要与签名一致。其它平台只在明确纳入后验证；多平台发布时需正确合并清单，不能相互覆盖。
5. 在隔离资料中验证旧版到新版的下载、校验、安装、重启、取消/失败恢复和固定资料保留。复用适用于具体改动的已有收据；不安排主会话例行发版后复验。

前端检查会清除旧的可安装版本和发行说明；失败不显示“已是最新”，禁用自动更新或切换渠道后的旧响应不得恢复旧安装入口。这些前端防护不替代 Rust/Tauri 签名和实际安装链路验证。

## Release tag

经版本计划授权后，由发布负责人使用现有入口，`VERSION` 替换为实际版本号：

```text
bun run release VERSION
```

脚本同步应用版本并创建、推送对应 `v` 标签。Desktop release workflow 核对源码和全部版本来源，默认生成 Windows 草稿安装包；只有选定候选的必要检查和实际产物证据完成后才公开。默认不自动公开，也不为其它平台追加隐含构建。具体责任与快速迭代规则见[项目执行规则](agents/project-management.md)。

发版前，本地脚本要求 `origin` 与 `scripts/release-repository.json` 一致；CI 要求 `GITHUB_REPOSITORY` 与该配置一致。`upstream` 仅用于跟踪上游，不是发布目标。不提前手工创建公开 Release。

## 相关文件

| 文件 | 职责 |
|---|---|
| `src-tauri/tauri.conf.json` | 产品标识、自动更新开关、地址及公钥 |
| `src-tauri/src/desktop_updates.rs` | 原生更新检查、安装及重启桥接 |
| `frontend/src/features/settings/UpdatesTab.tsx` | 已安装版本和手动稳定发行入口 |
| `frontend/src/features/settings/updaterStore.ts` | 更新状态、过期请求和安装互斥 |
| `.github/workflows/release.yml` | 默认 Windows 的构建与草稿发布流程 |
| `scripts/release.sh` | 版本号、提交和标签管理 |
