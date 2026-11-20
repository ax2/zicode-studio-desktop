# 软件更新

在 Windows x64 上打开「设置 → 软件更新」，可以查看当前 Studio 和内嵌 Pi 版本。稳定通道使用 GitHub 公开发行的完整 Windows 安装包。

## 当前可用入口

1. 点「立即检查」。有新版本时，查看目标版本和发行说明，点「下载更新」。下载期间可以取消，失败后可重试。
2. 等待显示「安装包已校验」，保存正在编辑的内容，再点「安装并退出」。安装结果在下次打开 Studio 的更新设置时显示。
3. 如果仍使用 v0.5.3 等缺少此入口的版本，从[最新稳定发行](https://github.com/ax2/zicode-studio-desktop/releases/latest)下载 Windows x64 安装包，保存工作并从托盘退出，再覆盖安装。保留原安装位置和资料目录。[资料保留说明](desktop-persistent-data.md)

稳定通道从该仓库的公开发行记录读取版本、安装包和 SHA-256。Tauri 签名更新清单与 Beta 通道沿用独立的发布配置。

## 默认构建与发布范围

默认**只构建和发布 Windows x64**，先验证 Windows 更新路径。macOS 和 Linux 仅在用户明确要求时构建，不因其他平台未验收而阻挡 Windows 手动升级交付。

`.github/workflows/release.yml` 的标签触发和手动触发均默认选择 `windows`；`platform: all` 是显式请求，保留的 `macos-intel` 也是特定修复选项。发布资产清单按实际选定平台核对，不再默认要求五个跨平台安装包或三个平台更新清单全部通过。

从 GitHub Actions 手动运行时选择 main 并填写已有版本标签。默认仅构建并验证 Windows 候选，勾选 publish 后才会在安装器验收通过后公开发布。手动运行使用所选主分支提交中的发布器和校验程序，版本标签提供应用代码、该版本的说明与 Issue 快照。Windows 构建还需要标签内的安装器配置和候选导出脚本。缺少这些输入时会在构建前停止。

## 将来启用签名更新的条件

若将来发行 Tauri 签名更新清单，还需要完成以下工作。

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

脚本同步应用版本并创建、推送对应 `v` 标签。Desktop release workflow 核对源码和全部版本来源，默认只构建 Windows。标签推送会先验证实际安装包并核对完整附件，在同一次工作流中公开发行及对应 Issues。手动选择仅构建时，安装包只保存在 Actions artifacts，不创建 GitHub Release。具体责任与快速迭代规则见[项目执行规则](agents/project-management.md)。

正式发行直接创建公开页面（不创建 Draft）；附件传输期间页面显示「安装包正在上传」，不会将稳定更新入口 `/releases/latest` 切向未完整校验的版本。所有附件的远端 SHA-256 和大小都匹配后才结束上传，并按版本提升稳定版。失败时重跑原 Actions run 的失败发布 job，保留原 Release ID、已校验的同名文件及原说明；不覆盖手工发行、其他 run 的发行或不同摘要的附件。此流程要求仓库允许公开发行后追加附件，不适用于强制 immutable releases 的仓库。

发版前，本地脚本要求 `origin` 与 `scripts/release-repository.json` 一致；CI 要求 `GITHUB_REPOSITORY` 与该配置一致。`upstream` 仅用于跟踪上游，不是发布目标。不提前手工创建公开 Release。

## 相关文件

| 文件 | 职责 |
|---|---|
| `src-tauri/tauri.conf.json` | 产品标识、自动更新开关、地址及公钥 |
| `src-tauri/src/desktop_updates.rs` | 原生更新检查、安装及重启桥接 |
| `frontend/src/features/settings/UpdatesTab.tsx` | 已安装版本和手动稳定发行入口 |
| `frontend/src/features/settings/updaterStore.ts` | 更新状态、过期请求和安装互斥 |
| `.github/workflows/release.yml` | 默认 Windows 的构建、实物验证与发行流程 |
| `scripts/release.sh` | 版本号、提交和标签管理 |
