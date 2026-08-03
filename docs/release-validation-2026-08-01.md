# 2026-08-01 本地发布验证

本记录对应产品化路线图 M0–M6 完成后的 Windows x64 本地候选构建。验证不创建远程
Release、不发布公共插件仓库，也不启用云同步。

## 自动化门禁

| 门禁 | 结果 |
| --- | --- |
| `bun run check` | 通过；Biome 与设计 Token 检查无错误 |
| `bun run test` | 101 个测试文件、411 项测试全部通过 |
| `bun run check:rust` | 90 项中 89 通过；Astro 网络集成测试按设计忽略；Clippy 与格式检查通过 |
| `python -m mkdocs build --strict` | 通过 |
| `git diff --check` | 通过；仅报告 Windows 行尾提示 |

忽略的 Astro 测试会下载锁定版本依赖，不纳入日常离线门禁；本轮曾单独运行该测试并
确认生成 `dist/index.html`。Notes 正式发布命令使用随包 Bun 1.3.14，并对 `package.json`
构建脚本、超时、日志和输出文件执行校验。

## 交互走查

- 桌面视口确认 Help 与 Settings 都使用导航、功能区、主视图三栏结构。
- Help 中文目录包含 13 篇文章，目录筛选、文章 Hero、页内目录和前后篇导航可用。
- 720×900 窄屏下隐藏次要页内目录，功能区与正文仍可滚动和阅读。
- Notes 笔记以笔记本为父节点展示，笔记作为子节点，支持展开、当前项高亮和筛选。
- Configuration 实际展示 QVeris Model Gateway 的 24 个模型，并提供刷新与编辑入口。
- 通用设置中的主题和语言标签保持横向布局。

## 凭据迁移

- 已注册场景的旧 `auth.json` 在启动时迁移到操作系统凭据库。
- Pi 在 `session_start` 后删除短生命周期兼容认证文件。
- 不属于任何注册场景的孤立明文认证文件会被清理。
- 最终 release EXE 启动后扫描结果为 `AuthFileCount = 0`；未读取或记录任何密钥值。

## Windows 产物

| 产物 | 大小 | SHA-256 |
| --- | ---: | --- |
| `target/release/zicode-studio-desktop.exe` | 31.95 MiB | `547DF70B15F581F501F4FD615FCA488E3CAC7C9CEF36C551A7E9BDA113A4814A` |
| `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe` | 327.34 MiB | `22AC35C7EE1727B9DA777CA368E8A71966611A170106592BAFE44CF4BE45201F` |

独立启动 release EXE 后 `/health` 返回 `status=ok`、协议版本 2、Pi 0.83.0。安装资源包含
Pi、Portable Git、WebView2、Bun 1.3.14、前端与扩展；`target/release/bundle` 未生成 ZIP。

!!! warning "签名状态"

    本地 NSIS 候选包未做 Authenticode 签名。对外分发前仍需在受控发布流水线中配置
    Windows 代码签名证书；本记录只证明本机构建、结构和运行健康。
